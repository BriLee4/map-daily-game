import type { PublicPlayer } from "../../shared/protocol";

export function Timer({ seconds, total }: { seconds: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (seconds / total) * 100) : 0;
  const urgent = seconds <= 5;
  return (
    <div className={`timer ${urgent ? "urgent" : ""}`} role="timer" aria-label={`${seconds} seconds left`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="timer-track" cx="18" cy="18" r="15.9" />
        <circle className="timer-fill" cx="18" cy="18" r="15.9" strokeDasharray={`${pct} 100`} />
      </svg>
      <span>{seconds}</span>
    </div>
  );
}

export function Leaderboard({
  players,
  highlightId,
  limit,
  roundScores,
  onKick,
}: {
  players: PublicPlayer[];
  highlightId?: string;
  limit?: number;
  roundScores?: Map<string, number>;
  onKick?: (p: PublicPlayer) => void;
}) {
  const ranked = rankPlayers(players);
  let rows = limit ? ranked.slice(0, limit) : ranked;
  // always include the highlighted player
  if (limit && highlightId && !rows.some((r) => r.p.id === highlightId)) {
    const me = ranked.find((r) => r.p.id === highlightId);
    if (me) rows = [...rows, me];
  }
  return (
    <ol className="leaderboard">
      {rows.map(({ p, rank }) => (
        <li key={p.id} className={p.id === highlightId ? "me" : ""}>
          <span className="rank">{rank}</span>
          <span className="name">
            {p.name}
            {!p.connected && <span className="offline" title="Disconnected"> ·offline</span>}
          </span>
          {roundScores && <span className="delta">{roundScores.has(p.id) ? `+${fmt(roundScores.get(p.id)!)}` : "—"}</span>}
          <span className="score">{fmt(p.score)}</span>
          {onKick && (
            <button className="icon-btn" onClick={() => onKick(p)} aria-label={`Remove ${p.name}`} title="Remove">
              ×
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

export function rankPlayers(players: PublicPlayer[]) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const out: { p: PublicPlayer; rank: number }[] = [];
  sorted.forEach((p, i) => out.push({ p, rank: i > 0 && sorted[i - 1].score === p.score ? out[i - 1].rank : i + 1 }));
  return out;
}

export const fmt = (n: number) => n.toLocaleString();
export const km = (n: number) => (n === 0 ? "Inside!" : `${n.toLocaleString()} km away`);

export function ConnBadge({ status }: { status: string }) {
  if (status === "open") return null;
  return <div className="conn-badge">{status === "closed" ? "Disconnected" : "Connecting…"}</div>;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
