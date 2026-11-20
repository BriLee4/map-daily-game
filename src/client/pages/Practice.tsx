import { useEffect, useMemo, useState } from "react";
import { scoreGuess, type Position, type ScoredGuess } from "../../shared/geo";
import { DEFAULT_AVATAR } from "../../shared/protocol";
import { fmt, km } from "../components/bits";
import { Globe, type GlobeResultLine } from "../components/Globe";
import { allCountries, getCountry, loadCountries } from "../lib/countries";
import { lastAvatar } from "../lib/identity";
import { navigate } from "../lib/router";

/**
 * Solo practice: no sign-in, no server. Countries come from the same random pool the live game
 * uses, scoring is the same function, and nothing leaves the browser (only a best score per
 * region is kept in localStorage).
 */

const WORLD = "World";
const ROUND_CHOICES = [5, 10, 20];

interface Round {
  id: string;
  guess: Position | null;
  result: ScoredGuess | null;
}

export function Practice() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => void loadCountries().then(() => setLoaded(true)), []);
  const [game, setGame] = useState<{ region: string; rounds: Round[] } | null>(null);

  if (!loaded) return <div className="center-page">Loading the globe…</div>;
  if (!game) return <Setup onStart={(region, n) => setGame({ region, rounds: pick(region, n).map((id) => ({ id, guess: null, result: null })) })} />;
  return <Game key={game.rounds.map((r) => r.id).join()} region={game.region} initial={game.rounds} onRestart={() => setGame(null)} />;
}

function regions(): { name: string; count: number }[] {
  const by = new Map<string, number>();
  for (const c of allCountries()) if (c.properties.pool) by.set(c.properties.continent, (by.get(c.properties.continent) ?? 0) + 1);
  const list = [...by].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  return [{ name: WORLD, count: list.reduce((s, r) => s + r.count, 0) }, ...list];
}

function pick(region: string, n: number): string[] {
  const ids = allCountries()
    .filter((c) => c.properties.pool && (region === WORLD || c.properties.continent === region))
    .map((c) => c.properties.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, n);
}

function Setup({ onStart }: { onStart: (region: string, rounds: number) => void }) {
  const list = useMemo(regions, []);
  const [region, setRegion] = useState(() => {
    const saved = safeGet("gg-practice-region");
    return list.some((r) => r.name === saved) ? saved! : WORLD;
  });
  const [rounds, setRounds] = useState(10);
  const best = getBest(region, rounds);
  return (
    <div className="center-page">
      <div className="card practice-setup">
        <p className="eyebrow">Practice</p>
        <h1>Practice on your own</h1>
        <p className="muted">No code or sign-in needed. Find each country on the globe and see how close you get.</p>

        <fieldset className="practice-field">
          <legend>Where?</legend>
          <div className="choice-grid">
            {list.map((r) => (
              <button key={r.name} type="button" className={r.name === region ? "on" : ""} aria-pressed={r.name === region} onClick={() => setRegion(r.name)}>
                {r.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="practice-field">
          <legend>How many countries?</legend>
          <div className="choice-grid three">
            {ROUND_CHOICES.map((n) => (
              <button key={n} type="button" className={n === rounds ? "on" : ""} aria-pressed={n === rounds} onClick={() => setRounds(n)}>
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        {best !== null && <p className="muted">Your best here: <strong>{fmt(best)}</strong> pts</p>}
        <button className="btn btn-primary btn-lg" onClick={() => { safeSet("gg-practice-region", region); onStart(region, rounds); }}>
          Start practice
        </button>
        <a className="teacher-link" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>← Back</a>
      </div>
    </div>
  );
}

function Game({ region, initial, onRestart }: { region: string; initial: Round[]; onRestart: () => void }) {
  const [rounds, setRounds] = useState(initial);
  const [i, setI] = useState(0);
  const [pin, setPin] = useState<Position | null>(null);
  const avatar = useMemo(() => lastAvatar() ?? DEFAULT_AVATAR, []);
  const total = rounds.reduce((s, r) => s + (r.result?.score ?? 0), 0);
  const done = i >= rounds.length;

  if (done) return <Summary region={region} rounds={rounds} total={total} onRestart={onRestart} />;

  const round = rounds[i];
  const country = getCountry(round.id)!;
  const checked = round.result !== null;

  const check = () => {
    if (!pin) return;
    const result = scoreGuess(pin, country.geometry);
    setRounds((rs) => rs.map((r, j) => (j === i ? { ...r, guess: pin, result } : r)));
  };
  const next = () => { setPin(null); setI(i + 1); };

  const results: GlobeResultLine[] = checked
    ? [{ guess: round.guess!, nearest: round.result!.nearest, score: round.result!.score, mine: true, avatar }]
    : [];

  return (
    <div className="play">
      <header className="play-bar">
        <div className="round">Practice · {i + 1}/{rounds.length}</div>
        <div className="prompt"><span className="find">Find</span> <strong>{country.properties.name}</strong></div>
        <div className="score-chip">{fmt(total)}</div>
      </header>

      <Globe
        className="play-globe"
        onPick={checked ? undefined : setPin}
        pin={checked ? null : pin}
        pinAvatar={avatar}
        answerId={checked ? round.id : null}
        results={results}
        focus={checked ? [round.guess!] : null}
        resetKey={checked ? undefined : i}
      />

      <footer className="play-foot">
        {!checked && (pin
          ? <button className="btn btn-primary btn-lg" onClick={check}>Check my guess</button>
          : <p className="hint">Tap the globe to drop your pin</p>)}
        {checked && (
          <div className="practice-result">
            <div className="result-card">
              <strong>{km(round.result!.km)}</strong>
              <span>+{fmt(round.result!.score)} pts</span>
            </div>
            <button className="btn btn-primary btn-lg" onClick={next} autoFocus>
              {i + 1 >= rounds.length ? "See my results" : "Next country"}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

function Summary({ region, rounds, total, onRestart }: { region: string; rounds: Round[]; total: number; onRestart: () => void }) {
  const [prevBest] = useState(() => getBest(region, rounds.length));
  useEffect(() => {
    if (prevBest === null || total > prevBest) setBest(region, rounds.length, total);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const max = rounds.length * 5000;
  return (
    <div className="page final-student practice-summary">
      <p className="eyebrow">Practice · {region}</p>
      <h1>{fmt(total)} pts</h1>
      <p className="muted">
        out of {fmt(max)}
        {prevBest === null ? "" : total > prevBest ? " · new personal best!" : ` · your best is ${fmt(prevBest)}`}
      </p>
      <ol className="practice-rounds">
        {rounds.map((r) => (
          <li key={r.id}>
            <span>{getCountry(r.id)?.properties.name}</span>
            <span className="muted">{r.result ? km(r.result.km) : "skipped"}</span>
            <strong>{fmt(r.result?.score ?? 0)}</strong>
          </li>
        ))}
      </ol>
      <button className="btn btn-primary btn-lg" onClick={onRestart}>Practice again</button>
      <button className="btn" onClick={() => navigate("/")}>Home</button>
    </div>
  );
}

// ---- per-device best scores (a convenience; may be unavailable in private windows)
function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
const bestKey = (region: string, n: number) => `gg-practice-best:${region}:${n}`;
function getBest(region: string, n: number): number | null {
  const v = safeGet(bestKey(region, n));
  return v === null || Number.isNaN(+v) ? null : +v;
}
function setBest(region: string, n: number, score: number) {
  safeSet(bestKey(region, n), String(score));
}
