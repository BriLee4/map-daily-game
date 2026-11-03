import { DurableObject } from "cloudflare:workers";
import { scoreGuess, type CountryGeometry, type Position } from "../shared/geo";
import {
  LIMITS,
  type ClientMessage,
  type GameSettings,
  type Phase,
  type PublicPlayer,
  type PublicState,
  type RoundResult,
  type ServerMessage,
  type YouState,
} from "../shared/protocol";

/** One party (classroom game) per Durable Object, addressed by its join code. */

interface RoundCountry {
  id: string;
  name: string;
  geometry: CountryGeometry;
}

interface PlayerRound {
  guess: Position;
  locked: boolean;
  /** filled when the round closes */
  km?: number;
  score?: number;
  nearest?: Position;
}

interface Player {
  id: string;
  /** secret per-device key kept in the student's localStorage; never broadcast */
  key: string;
  name: string;
  joinedAt: number;
  rounds: Record<number, PlayerRound>;
}

interface GameState {
  gameId: string;
  code: string;
  ownerEmail: string;
  createdAt: number;
  settings: GameSettings;
  phase: Phase;
  locked: boolean;
  roundIndex: number;
  endsAt: number | null;
  players: Record<string, Player>;
  bannedKeys: string[];
  savedToD1: boolean;
}

interface Attachment {
  role: "host" | "player";
  key: string | null; // player key
}

export interface InitParams {
  code: string;
  ownerEmail: string;
  settings: GameSettings;
  countries: RoundCountry[];
}

const LOBBY_TTL_MS = 12 * 60 * 60 * 1000; // an unfinished game is cleaned up after 12h
const FINISHED_TTL_MS = 6 * 60 * 60 * 1000; // live state kept 6h after the game ends (results are in D1)
const GUESS_GRACE_MS = 750; // network slack after the timer hits zero
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;

export class Party extends DurableObject<Env> {
  private state: GameState | null = null;
  private countries: RoundCountry[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs again every time the object wakes from hibernation.
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<GameState>("state")) ?? null;
    });
  }

  // ---------------------------------------------------------------- RPC (called by the Worker)

  /** Create the game. Returns false if this code is already in use. */
  async init(p: InitParams): Promise<boolean> {
    if (this.state) return false;
    const now = Date.now();
    this.state = {
      gameId: `${p.code}-${now.toString(36)}`,
      code: p.code,
      ownerEmail: p.ownerEmail.toLowerCase(),
      createdAt: now,
      settings: p.settings,
      phase: "lobby",
      locked: false,
      roundIndex: -1,
      endsAt: null,
      players: {},
      bannedKeys: [],
      savedToD1: false,
    };
    this.countries = p.countries;
    await this.ctx.storage.put("countries", p.countries);
    await this.save();
    await this.ctx.storage.setAlarm(now + LOBBY_TTL_MS);
    await this.env.DB.prepare(
      `INSERT INTO games (id, code, owner_email, created_at, mode, timer_seconds, country_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(this.state.gameId, p.code, this.state.ownerEmail, now, p.settings.mode,
        p.settings.timerSeconds, JSON.stringify(p.settings.countryIds))
      .run();
    return true;
  }

  async summary(): Promise<{ exists: boolean; ownerEmail?: string; phase?: Phase; locked?: boolean }> {
    if (!this.state) return { exists: false };
    return { exists: true, ownerEmail: this.state.ownerEmail, phase: this.state.phase, locked: this.state.locked };
  }

  // ---------------------------------------------------------------- WebSocket entry

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const s = this.state;
    if (!s) return new Response("No such game", { status: 404 });

    const role = request.headers.get("X-GG-Role") === "host" ? "host" : "player";
    let key: string | null = null;
    if (role === "host") {
      // The Worker only sets X-GG-Role after verifying the Access JWT; double-check ownership.
      if (request.headers.get("X-GG-Email")?.toLowerCase() !== s.ownerEmail)
        return new Response("Not your game", { status: 403 });
    } else {
      key = new URL(request.url).searchParams.get("k");
      if (!key || !KEY_RE.test(key)) return new Response("Bad key", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, key } satisfies Attachment);

    if (role === "player" && s.bannedKeys.includes(key!)) {
      this.send(server, { t: "rejected", message: "The teacher removed you from this game." });
      server.close(4001, "kicked");
    } else if (role === "player" && !this.playerByKey(key!)) {
      if (s.locked || s.phase === "final") {
        this.send(server, { t: "rejected", message: s.phase === "final" ? "This game has ended." : "The teacher has locked this game." });
        server.close(4003, "locked"); // the client also closes on "rejected"
      } else {
        this.send(server, { t: "needName" });
      }
    } else {
      // Known player reconnecting, or host: everyone's "connected" status may change.
      this.broadcast();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 2000) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;
    try {
      if (att.role === "host") await this.onHost(msg);
      else await this.onPlayer(ws, att.key!, msg);
    } catch (err) {
      this.send(ws, { t: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
    this.broadcast();
  }

  async webSocketError(): Promise<void> {
    this.broadcast();
  }

  // ---------------------------------------------------------------- alarm: round timer + cleanup

  async alarm(): Promise<void> {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    if (s.phase === "question" && s.endsAt && now >= s.endsAt - 50) {
      await this.closeRound();
      return;
    }
    const expires = this.expiresAt();
    if (now >= expires) {
      if (Object.keys(s.players).length === 0) {
        // abandoned lobby: don't clutter the teacher's history
        await this.env.DB.prepare(`DELETE FROM games WHERE id = ?`).bind(s.gameId).run();
      } else if (s.phase !== "final") {
        await this.finish(); // persist whatever was played
      }
      for (const ws of this.ctx.getWebSockets()) ws.close(4000, "expired");
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    await this.ctx.storage.setAlarm(s.phase === "question" && s.endsAt ? s.endsAt : expires);
  }

  private expiresAt(): number {
    const s = this.state!;
    return s.phase === "final" ? (s.endsAt ?? Date.now()) + FINISHED_TTL_MS : s.createdAt + LOBBY_TTL_MS;
  }

  // ---------------------------------------------------------------- host actions

  private async onHost(msg: ClientMessage): Promise<void> {
    const s = this.state!;
    switch (msg.t) {
      case "start":
        if (s.phase !== "lobby") return;
        await this.startRound(0);
        return;
      case "endRound":
        if (s.phase === "question") await this.closeRound();
        return;
      case "reveal":
        if (s.phase !== "heatmap") return;
        s.phase = "reveal";
        await this.save();
        this.broadcast();
        return;
      case "next":
        if (s.phase !== "reveal") return;
        if (s.roundIndex + 1 >= s.settings.countryIds.length) await this.finish();
        else await this.startRound(s.roundIndex + 1);
        return;
      case "finish":
        if (s.phase === "final") return;
        if (s.phase === "question") await this.closeRound(false);
        await this.finish();
        return;
      case "kick": {
        const p = s.players[msg.playerId];
        if (!p) return;
        delete s.players[p.id];
        s.bannedKeys.push(p.key);
        for (const ws of this.socketsForKey(p.key)) {
          this.send(ws, { t: "kicked" });
          ws.close(4001, "kicked");
        }
        await this.save();
        await this.maybeAutoClose();
        this.broadcast();
        return;
      }
      case "setLocked":
        s.locked = !!msg.locked;
        await this.save();
        this.broadcast();
        return;
    }
  }

  private async startRound(i: number): Promise<void> {
    const s = this.state!;
    s.phase = "question";
    s.roundIndex = i;
    s.endsAt = Date.now() + s.settings.timerSeconds * 1000;
    await this.save();
    await this.ctx.storage.setAlarm(s.endsAt);
    this.broadcast();
  }

  /** Close guessing and score every guess (scores become visible on reveal). */
  private async closeRound(broadcast = true): Promise<void> {
    const s = this.state!;
    if (s.phase !== "question") return;
    const country = (await this.getCountries())[s.roundIndex];
    for (const p of Object.values(s.players)) {
      const r = p.rounds[s.roundIndex];
      if (!r) continue;
      const scored = scoreGuess(r.guess, country.geometry);
      r.km = scored.km;
      r.score = scored.score;
      r.nearest = scored.nearest;
    }
    s.phase = "heatmap";
    s.endsAt = null;
    await this.save();
    await this.ctx.storage.setAlarm(this.expiresAt());
    if (broadcast) this.broadcast();
  }

  private async finish(): Promise<void> {
    const s = this.state!;
    s.phase = "final";
    s.endsAt = Date.now(); // reused as "finished at" for the TTL
    await this.save();
    await this.ctx.storage.setAlarm(this.expiresAt());
    this.broadcast();
    await this.saveResults();
  }

  private async saveResults(): Promise<void> {
    const s = this.state!;
    if (s.savedToD1) return;
    const board = this.leaderboard();
    const rounds = s.settings.countryIds.length;
    const stmts = [
      this.env.DB.prepare(`UPDATE games SET finished_at = ?, player_count = ? WHERE id = ?`).bind(
        s.endsAt, board.length, s.gameId),
      this.env.DB.prepare(`DELETE FROM game_players WHERE game_id = ?`).bind(s.gameId),
      ...board.map(({ player, score, rank }) =>
        this.env.DB.prepare(
          `INSERT INTO game_players (game_id, rank, player_name, total_score, round_scores) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          s.gameId, rank, player.name, score,
          JSON.stringify(Array.from({ length: rounds }, (_, i) => {
            const r = player.rounds[i];
            return r && r.score !== undefined ? { score: r.score, km: r.km } : null;
          })),
        ),
      ),
    ];
    await this.env.DB.batch(stmts);
    s.savedToD1 = true;
    await this.save();
  }

  // ---------------------------------------------------------------- player actions

  private async onPlayer(ws: WebSocket, key: string, msg: ClientMessage): Promise<void> {
    const s = this.state!;
    let p = this.playerByKey(key);

    if (msg.t === "join") {
      if (p) return this.broadcast();
      if (s.locked) throw new Error("The teacher has locked this game.");
      if (s.phase === "final") throw new Error("This game has ended.");
      if (Object.keys(s.players).length >= LIMITS.maxPlayers) throw new Error("This game is full.");
      const name = this.uniqueName(cleanName(msg.name));
      if (!name) throw new Error("Please enter a nickname.");
      p = { id: crypto.randomUUID().slice(0, 8), key, name, joinedAt: Date.now(), rounds: {} };
      s.players[p.id] = p;
      await this.save();
      this.broadcast();
      return;
    }
    if (!p) return this.send(ws, { t: "needName" });

    if (msg.t === "guess") {
      if (s.phase !== "question" || !s.endsAt || Date.now() > s.endsAt + GUESS_GRACE_MS) return;
      const lng = Number(msg.lng), lat = Number(msg.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 540) return;
      const existing = p.rounds[s.roundIndex];
      if (existing?.locked) return;
      const normLng = ((((lng + 180) % 360) + 360) % 360) - 180;
      p.rounds[s.roundIndex] = { guess: [round4(normLng), round4(lat)], locked: false };
      await this.save();
      // Only the first guess changes what others see ("answered" count); re-pins just echo back.
      if (!existing) this.broadcast();
      else this.sendState(ws);
      return;
    }

    if (msg.t === "lock") {
      if (s.phase !== "question") return;
      const r = p.rounds[s.roundIndex];
      if (!r || r.locked) return;
      r.locked = true;
      await this.save();
      if (!(await this.maybeAutoClose())) this.broadcast();
    }
  }

  /** When every connected player has locked in, end the round early. */
  private async maybeAutoClose(): Promise<boolean> {
    const s = this.state!;
    if (s.phase !== "question") return false;
    const connected = this.connectedKeys();
    const active = Object.values(s.players).filter((p) => connected.has(p.key));
    if (active.length === 0) return false;
    if (active.every((p) => p.rounds[s.roundIndex]?.locked)) {
      await this.closeRound();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- state helpers

  private async save(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private async getCountries(): Promise<RoundCountry[]> {
    this.countries ??= (await this.ctx.storage.get<RoundCountry[]>("countries")) ?? [];
    return this.countries;
  }

  private playerByKey(key: string): Player | undefined {
    return Object.values(this.state!.players).find((p) => p.key === key);
  }

  private uniqueName(name: string): string {
    if (!name) return "";
    const taken = new Set(Object.values(this.state!.players).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, LIMITS.maxNameLength - 3)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private socketsForKey(key: string): WebSocket[] {
    return this.ctx.getWebSockets("player").filter((ws) => (ws.deserializeAttachment() as Attachment).key === key);
  }

  private connectedKeys(): Set<string> {
    const keys = new Set<string>();
    for (const ws of this.ctx.getWebSockets("player")) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const k = (ws.deserializeAttachment() as Attachment).key;
      if (k) keys.add(k);
    }
    return keys;
  }

  /** Score that is visible right now: rounds are only counted once revealed. */
  private visibleScore(p: Player): number {
    const s = this.state!;
    let total = 0;
    for (const [i, r] of Object.entries(p.rounds)) {
      const idx = Number(i);
      const revealed = idx < s.roundIndex || (idx === s.roundIndex && (s.phase === "reveal" || s.phase === "final"));
      if (revealed && r.score !== undefined) total += r.score;
    }
    return total;
  }

  private leaderboard(): { player: Player; score: number; rank: number }[] {
    const rows = Object.values(this.state!.players)
      .map((player) => ({ player, score: this.visibleScore(player), rank: 0 }))
      .sort((a, b) => b.score - a.score || a.player.joinedAt - b.player.joinedAt);
    rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1));
    return rows;
  }

  private publicState(role: "host" | "player", countryName: string | null, countryId: string | null): PublicState {
    const s = this.state!;
    const connected = this.connectedKeys();
    const ri = s.roundIndex;
    const board = this.leaderboard();
    const players: PublicPlayer[] = board.map(({ player: p, score }) => ({
      id: p.id,
      name: p.name,
      score,
      connected: connected.has(p.key),
      answered: !!p.rounds[ri],
      locked: !!p.rounds[ri]?.locked,
    }));
    const afterQuestion = s.phase === "heatmap" || s.phase === "reveal";
    const heat = afterQuestion
      ? Object.values(s.players).flatMap((p) => (p.rounds[ri] ? [p.rounds[ri].guess] : []))
      : null;
    let reveal: PublicState["reveal"] = null;
    if (s.phase === "reveal" && countryId) {
      const results: RoundResult[] =
        role === "host"
          ? board.flatMap(({ player: p }) => {
              const r = p.rounds[ri];
              return r && r.score !== undefined
                ? [{ playerId: p.id, name: p.name, guess: r.guess, km: r.km!, score: r.score }]
                : [];
            })
          : [];
      reveal = { countryId, results };
    }
    return {
      code: s.code,
      phase: s.phase,
      locked: s.locked,
      roundIndex: ri,
      totalRounds: s.settings.countryIds.length,
      timerSeconds: s.settings.timerSeconds,
      endsAt: s.endsAt && s.phase === "question" ? s.endsAt : null,
      serverNow: Date.now(),
      country: countryName && s.phase !== "lobby" && s.phase !== "final" ? { name: countryName } : null,
      players,
      heat,
      reveal,
    };
  }

  private youState(p: Player, rank: number, score: number): YouState {
    const s = this.state!;
    const r = p.rounds[s.roundIndex];
    const revealed = s.phase === "reveal";
    return {
      id: p.id,
      name: p.name,
      score,
      guess: r?.guess ?? null,
      locked: !!r?.locked,
      last: revealed && r && r.score !== undefined ? { km: r.km!, score: r.score, nearest: r.nearest! } : null,
      rank,
    };
  }

  private sendState(ws: WebSocket): void {
    // Single-socket variant of broadcast (used for a player's own re-pin).
    this.broadcast([ws]);
  }

  private broadcast(only?: WebSocket[]): void {
    const s = this.state;
    if (!s) return;
    // Country info for the current round comes from the cached list (sync if already loaded).
    const c = this.countries?.[s.roundIndex];
    if (s.roundIndex >= 0 && !this.countries) {
      void this.getCountries().then(() => this.broadcast(only));
      return;
    }
    const hostState = this.publicState("host", c?.name ?? null, c?.id ?? null);
    const playerState = this.publicState("player", c?.name ?? null, c?.id ?? null);
    const board = this.leaderboard();
    for (const ws of only ?? this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      if (att.role === "host") {
        this.send(ws, { t: "state", state: hostState, you: null, role: "host" });
        continue;
      }
      const row = board.find((b) => b.player.key === att.key);
      if (!row) continue; // hasn't joined yet (waiting on nickname)
      this.send(ws, { t: "state", state: playerState, you: this.youState(row.player, row.rank, row.score), role: "player" });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }
}

function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxNameLength);
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
