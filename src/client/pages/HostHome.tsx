import { useEffect, useMemo, useState } from "react";
import { LIMITS } from "../../shared/protocol";
import { fmt } from "../components/bits";
import { allCountries, getCountry, loadCountries, type CountryFeature } from "../lib/countries";
import { navigate } from "../lib/router";

const TIMERS = [15, 20, 30, 45, 60, 90, 120];

interface PastGame {
  id: string;
  code: string;
  created_at: number;
  finished_at: number | null;
  mode: string;
  timer_seconds: number;
  country_ids: string;
  player_count: number;
}

export function HostHome() {
  const [me, setMe] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/host/me")
      .then(async (r) => (r.ok ? setMe((await r.json()).email) : setAuthError((await r.json()).error ?? "Not signed in")))
      .catch(() => setAuthError("Couldn't reach the server"));
  }, []);

  if (authError)
    return (
      <div className="page"><div className="card"><h2>Teacher sign-in required</h2><p>{authError}</p></div></div>
    );
  if (!me) return <div className="center-page">Loading…</div>;

  return (
    <div className="page host-home">
      <header className="host-head">
        <h1>Daily Map Quiz <span className="muted">· Teacher</span></h1>
        <span className="muted">{me}</span>
      </header>
      <div className="host-grid">
        <CreateGame />
        <PastGames />
      </div>
    </div>
  );
}

function CreateGame() {
  const [mode, setMode] = useState<"random" | "custom">("random");
  const [rounds, setRounds] = useState(5);
  const [timer, setTimer] = useState(30);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/host/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, rounds, timerSeconds: timer, countryIds: picked }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Couldn't create the game");
      navigate(`/host/party/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const valid = mode === "random" ? rounds >= 1 : picked.length >= 1;
  return (
    <section className="card create">
      <h2>New game</h2>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === "random"} className={mode === "random" ? "on" : ""} onClick={() => setMode("random")}>Random countries</button>
        <button role="tab" aria-selected={mode === "custom"} className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>Pick countries</button>
      </div>

      {mode === "random" ? (
        <label className="field">
          <span>Rounds: <strong>{rounds}</strong></span>
          <input type="range" min={LIMITS.minRounds} max={LIMITS.maxRounds} value={rounds} onChange={(e) => setRounds(+e.target.value)} />
        </label>
      ) : (
        <CountryPicker picked={picked} setPicked={setPicked} />
      )}

      <label className="field">
        <span>Time per round</span>
        <select value={timer} onChange={(e) => setTimer(+e.target.value)}>
          {TIMERS.map((t) => <option key={t} value={t}>{t} seconds</option>)}
        </select>
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" disabled={!valid || busy} onClick={submit}>
        {busy ? "Creating…" : `Create game · ${mode === "random" ? rounds : picked.length} round${(mode === "random" ? rounds : picked.length) === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}

function CountryPicker({ picked, setPicked }: { picked: string[]; setPicked: (f: (p: string[]) => string[]) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => void loadCountries().then(() => setLoaded(true)), []);
  const matches = useMemo(() => {
    if (!loaded) return [] as CountryFeature[];
    const s = q.trim().toLowerCase();
    return allCountries()
      .filter((c) => !picked.includes(c.properties.id))
      .filter((c) => !s || c.properties.name.toLowerCase().includes(s) || c.properties.continent.toLowerCase().startsWith(s))
      .slice(0, 8);
  }, [q, loaded, picked]);

  const move = (i: number, d: number) =>
    setPicked((p) => {
      const a = [...p];
      const j = i + d;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });

  return (
    <div className="picker">
      <input
        placeholder={loaded ? "Search countries (or a continent)…" : "Loading countries…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0] && picked.length < LIMITS.maxRounds) {
            setPicked((p) => [...p, matches[0].properties.id]);
            setQ("");
          }
        }}
        aria-label="Search countries"
      />
      {q && (
        <ul className="matches">
          {matches.map((c) => (
            <li key={c.properties.id}>
              <button disabled={picked.length >= LIMITS.maxRounds} onClick={() => { setPicked((p) => [...p, c.properties.id]); setQ(""); }}>
                {c.properties.name} <span className="muted">{c.properties.continent}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">No matches</li>}
        </ul>
      )}
      <ol className="picked">
        {picked.map((id, i) => (
          <li key={id}>
            <span>{i + 1}. {getCountry(id)?.properties.name ?? id}</span>
            <span className="row-actions">
              <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>↑</button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === picked.length - 1}>↓</button>
              <button className="icon-btn" onClick={() => setPicked((p) => p.filter((x) => x !== id))} aria-label="Remove">×</button>
            </span>
          </li>
        ))}
        {picked.length === 0 && <li className="muted">Each country you add becomes one round, in order.</li>}
      </ol>
    </div>
  );
}

function PastGames() {
  const [games, setGames] = useState<PastGame[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/host/games").then(async (r) => setGames(r.ok ? (await r.json()).games : []));
  }, []);
  return (
    <section className="card past">
      <h2>Past games</h2>
      {!games && <p className="muted">Loading…</p>}
      {games?.length === 0 && <p className="muted">No games yet.</p>}
      <ul className="past-list">
        {games?.map((g) => (
          <li key={g.id}>
            <div className="past-row">
              <div>
                <strong>{new Date(g.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</strong>
                <div className="muted">
                  {plural(JSON.parse(g.country_ids).length, "round")} · {plural(g.player_count, "player")} · {g.finished_at ? "finished" : "not finished"}
                </div>
              </div>
              <div className="row-actions">
                {!g.finished_at && <button className="btn btn-sm" onClick={() => navigate(`/host/party/${g.code}`)}>Open</button>}
                {g.finished_at && <button className="btn btn-sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "Hide" : "Results"}</button>}
                {g.finished_at && <a className="btn btn-sm" href={`/api/host/games/${g.id}.csv`}>CSV</a>}
              </div>
            </div>
            {open === g.id && <GameResults id={g.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GameResults({ id }: { id: string }) {
  const [data, setData] = useState<{ game: { countries: string[] }; players: { rank: number; player_name: string; total_score: number }[] } | null>(null);
  useEffect(() => {
    fetch(`/api/host/games/${id}`).then(async (r) => r.ok && setData(await r.json()));
  }, [id]);
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="game-results">
      <p className="muted">{data.game.countries.join(" · ")}</p>
      <ol className="leaderboard compact">
        {data.players.map((p) => (
          <li key={p.player_name}><span className="rank">{p.rank}</span><span className="name">{p.player_name}</span><span className="score">{fmt(p.total_score)}</span></li>
        ))}
      </ol>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
