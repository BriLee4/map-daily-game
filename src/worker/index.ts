import countriesData from "../shared/countries.json";
import type { CountryGeometry } from "../shared/geo";
import { LIMITS, type GameSettings } from "../shared/protocol";
import { authenticateTeacher } from "./auth";
import type { InitParams } from "./party";

export { Party } from "./party";

interface CountryFeature {
  properties: { id: string; name: string; continent: string; pool: boolean };
  geometry: CountryGeometry;
}
const COUNTRIES = (countriesData as unknown as { features: CountryFeature[] }).features;
const BY_ID = new Map(COUNTRIES.map((f) => [f.properties.id, f]));
const POOL = COUNTRIES.filter((f) => f.properties.pool);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const err = (message: string, status = 400) => json({ error: message }, status);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ----------------------------------------------------------- student (public) routes
      let m = path.match(/^\/api\/party\/([A-Za-z0-9]{6})(\/ws)?$/);
      if (m) {
        const code = m[1].toUpperCase();
        if (!CODE_RE.test(code)) return err("Unknown game code", 404);
        const stub = env.PARTY.getByName(code);
        if (m[2]) return stub.fetch(forward(request, "player"));
        const info = await stub.summary();
        if (!info.exists) return err("No game with that code", 404);
        return json({ code, phase: info.phase, locked: info.locked });
      }

      // ----------------------------------------------------------- teacher routes (Access-protected)
      if (path.startsWith("/api/host/")) {
        // Block cross-site use of the teacher's sign-in cookie (CSRF and cross-site WebSocket
        // hijacking) before anything else: see sameOriginOk.
        if (!sameOriginOk(request, url)) return err("Cross-site request refused", 403);
        const auth = await authenticateTeacher(request, env);
        if (!auth.ok) return err(auth.message, auth.status);
        const email = auth.email;

        if (path === "/api/host/me") return json({ email });

        if (path === "/api/host/games" && request.method === "POST") return createGame(request, env, email);

        if (path === "/api/host/games" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            `SELECT id, code, created_at, finished_at, mode, timer_seconds, country_ids, player_count
             FROM games WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100`,
          ).bind(email).all();
          return json({ games: results });
        }

        m = path.match(/^\/api\/host\/games\/([A-Za-z0-9-]+)(\.csv)?$/);
        if (m && request.method === "GET") return gameDetail(env, email, m[1], !!m[2]);

        m = path.match(/^\/api\/host\/party\/([A-Za-z0-9]{6})\/ws$/);
        if (m) {
          const stub = env.PARTY.getByName(m[1].toUpperCase());
          const info = await stub.summary();
          if (!info.exists) return err("No game with that code", 404);
          if (info.ownerEmail !== email) return err("This game belongs to another teacher", 403);
          return stub.fetch(forward(request, "host", email));
        }
        return err("Not found", 404);
      }

      if (path === "/api/countries/pool-size") return json({ pool: POOL.length, all: COUNTRIES.length });
      return err("Not found", 404);
    } catch (e) {
      console.error(e);
      return err("Server error", 500);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Teacher routes are authorised by the Cloudflare Access cookie, which browsers may attach to
 * requests started by other websites (Access leaves its SameSite attribute unset by default, and
 * WebSocket upgrades are not covered by CORS). So:
 * - anything that changes state or opens a live connection (non-GET, or a WebSocket upgrade) must
 *   carry an Origin header equal to this site's origin. Browsers always send Origin on these.
 * - a plain GET is refused only when it names a different Origin (same-site navigations and
 *   downloads, like the CSV link, may send none).
 */
function sameOriginOk(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  const changesState = request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (changesState) return origin === url.origin;
  return origin === null || origin === url.origin;
}

/** Re-create the request for the Durable Object with only the headers we vouch for. */
function forward(request: Request, role: "host" | "player", email?: string): Request {
  const headers = new Headers();
  for (const h of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("X-GG-Role", role);
  if (email) headers.set("X-GG-Email", email);
  return new Request(request.url, { method: "GET", headers });
}

async function createGame(request: Request, env: Env, email: string): Promise<Response> {
  let body: { mode?: string; countryIds?: unknown; rounds?: unknown; timerSeconds?: unknown };
  // A JSON content type can't be sent by a plain cross-site HTML form (defence in depth).
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return err("Expected a JSON request", 415);
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON");
  }
  const timerSeconds = Math.round(Number(body.timerSeconds));
  if (!(timerSeconds >= LIMITS.minTimer && timerSeconds <= LIMITS.maxTimer))
    return err(`Timer must be ${LIMITS.minTimer}–${LIMITS.maxTimer} seconds`);

  let countryIds: string[];
  if (body.mode === "custom") {
    if (!Array.isArray(body.countryIds)) return err("Pick at least one country");
    countryIds = body.countryIds.map(String);
    if (countryIds.length < LIMITS.minRounds || countryIds.length > LIMITS.maxRounds)
      return err(`Pick ${LIMITS.minRounds}–${LIMITS.maxRounds} countries`);
    const unknown = countryIds.find((id) => !BY_ID.has(id));
    if (unknown) return err(`Unknown country id ${unknown}`);
  } else if (body.mode === "random") {
    const rounds = Math.round(Number(body.rounds));
    if (!(rounds >= LIMITS.minRounds && rounds <= LIMITS.maxRounds))
      return err(`Rounds must be ${LIMITS.minRounds}–${LIMITS.maxRounds}`);
    countryIds = sample(POOL, rounds).map((f) => f.properties.id);
  } else {
    return err("mode must be 'random' or 'custom'");
  }

  const settings: GameSettings = { mode: body.mode, countryIds, timerSeconds };
  const countries = countryIds.map((id) => {
    const f = BY_ID.get(id)!;
    return { id, name: f.properties.name, geometry: f.geometry };
  });

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const params: InitParams = { code, ownerEmail: email, settings, countries };
    if (await env.PARTY.getByName(code).init(params)) return json({ code }, 201);
  }
  return err("Couldn't allocate a game code, try again", 503);
}

async function gameDetail(env: Env, email: string, id: string, csv: boolean): Promise<Response> {
  const game = await env.DB.prepare(`SELECT * FROM games WHERE id = ? AND owner_email = ?`).bind(id, email).first<{
    id: string; code: string; created_at: number; country_ids: string;
  }>();
  if (!game) return err("Not found", 404);
  const { results: players } = await env.DB.prepare(
    `SELECT rank, player_name, total_score, round_scores FROM game_players WHERE game_id = ? ORDER BY rank, player_name`,
  ).bind(id).all<{ rank: number; player_name: string; total_score: number; round_scores: string }>();
  const countryNames = (JSON.parse(game.country_ids) as string[]).map((c) => BY_ID.get(c)?.properties.name ?? c);

  if (!csv) return json({ game: { ...game, countries: countryNames }, players });

  const q = (v: unknown) => {
    const s = String(v ?? "");
    // quote, and neutralise spreadsheet formula injection from nicknames
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  };
  const header = ["Rank", "Nickname", "Total", ...countryNames.flatMap((n, i) => [`R${i + 1} ${n} score`, `R${i + 1} km`])];
  const lines = [header.map(q).join(",")];
  for (const p of players) {
    const rounds = JSON.parse(p.round_scores) as ({ score: number; km: number } | null)[];
    lines.push([p.rank, p.player_name, p.total_score, ...rounds.flatMap((r): (string | number)[] => (r ? [r.score, r.km] : ["", ""]))].map(q).join(","));
  }
  const date = new Date(game.created_at).toISOString().slice(0, 10);
  return new Response(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="daily-map-quiz-${date}-${game.code}.csv"`,
    },
  });
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
