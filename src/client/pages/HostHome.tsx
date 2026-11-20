import { useEffect, useMemo, useState } from "react";
import { LIMITS } from "../../shared/protocol";
import { fmt } from "../components/bits";
import { allCountries, getCountry, loadCountries, type CountryFeature } from "../lib/countries";
import { navigate } from "../lib/router";

const TIMERS = [15, 20, 30, 45, 60, 90, 120];

interface CountrySet {
  id: string;
  name: string;
  country_ids: string;
  created_at: number;
}

/** What "New game" is set to; lifted here so a past game can be reused from the history list. */
interface Draft {
  mode: "random" | "custom";
  picked: string[];
}

interface PastGame {
  id: string;
  code: string;
  label: string | null;
  created_at: number;
  finished_at: number | null;
  mode: string;
  timer_seconds: number;
  country_ids: string;
  player_count: number;
}

export function HostHome() {
  const [draft, setDraft] = useState<Draft>({ mode: "random", picked: [] });
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
        <CreateGame draft={draft} setDraft={setDraft} />
        <PastGames
          onReuse={(ids) => {
            setDraft({ mode: "custom", picked: ids.slice(0, LIMITS.maxRounds) });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
    </div>
  );
}

function CreateGame({ draft, setDraft }: { draft: Draft; setDraft: (f: (d: Draft) => Draft) => void }) {
  const { mode, picked } = draft;
  const setMode = (m: Draft["mode"]) => setDraft((d) => ({ ...d, mode: m }));
  const setPicked = (f: (p: string[]) => string[]) => setDraft((d) => ({ ...d, picked: f(d.picked) }));
  const [rounds, setRounds] = useState(5);
  const [timer, setTimer] = useState(30);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/host/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, rounds, timerSeconds: timer, countryIds: picked, label }),
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
  const count = mode === "random" ? rounds : picked.length;
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
        <>
          <SavedSets picked={picked} load={(ids) => setPicked(() => ids)} />
          <CountryPicker picked={picked} setPicked={setPicked} />
        </>
      )}

      <label className="field">
        <span>Time per round</span>
        <select value={timer} onChange={(e) => setTimer(+e.target.value)}>
          {TIMERS.map((t) => <option key={t} value={t}>{t} seconds</option>)}
        </select>
      </label>

      <label className="field">
        <span>Label <span className="muted">(optional, only you see it)</span></span>
        <input value={label} maxLength={60} placeholder="e.g. Period 3" onChange={(e) => setLabel(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" disabled={!valid || busy} onClick={submit}>
        {busy ? "Creating…" : `Create game · ${plural(count, "round")}`}
      </button>
    </section>
  );
}

/** Load a saved country list into the picker, or save the current one. */
function SavedSets({ picked, load }: { picked: string[]; load: (ids: string[]) => void }) {
  const [sets, setSets] = useState<CountrySet[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/host/sets").then(async (r) => setSets(r.ok ? (await r.json()).sets : []));
  }, []);

  const save = async () => {
    setError(null);
    const r = await fetch("/api/host/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, countryIds: picked }),
    });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? "Couldn't save the set");
    setSets((s) => [body.set, ...(s ?? [])]);
    setSaving(false);
    setName("");
  };

  const remove = async (set: CountrySet) => {
    if (!confirm(`Delete the saved set "${set.name}"?`)) return;
    const r = await fetch(`/api/host/sets/${set.id}`, { method: "DELETE" });
    if (r.ok) setSets((s) => s?.filter((x) => x.id !== set.id) ?? null);
  };

  return (
    <div className="sets">
      {sets && sets.length > 0 && (
        <ul className="set-list" aria-label="Saved sets">
          {sets.map((set) => (
            <li key={set.id}>
              <button className="set-load" onClick={() => load(JSON.parse(set.country_ids))} title="Load into the list below">
                {set.name} <span className="muted">{plural(JSON.parse(set.country_ids).length, "country", "countries")}</span>
              </button>
              <button className="icon-btn" onClick={() => remove(set)} aria-label={`Delete saved set ${set.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {saving ? (
        <form className="set-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input autoFocus value={name} maxLength={60} placeholder="Name this set, e.g. Unit 2: Africa" onChange={(e) => setName(e.target.value)} aria-label="Set name" />
          <button className="btn btn-sm" disabled={!name.trim()}>Save</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSaving(false); setError(null); }}>Cancel</button>
        </form>
      ) : (
        picked.length > 0 && <button className="btn btn-sm" onClick={() => setSaving(true)}>Save this list as a set</button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CountryPicker({ picked, setPicked }: { picked: string[]; setPicked: (f: (p: string[]) => string[]) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => void loadCountries().then(() => setLoaded(true)), []);
  const s = q.trim().toLowerCase();

  // Typing a continent ("afr", "south am") offers to add all of its countries at once.
  const continents = useMemo(() => {
    if (!loaded || s.length < 2) return [];
    const by = new Map<string, string[]>();
    for (const c of allCountries()) {
      // only the random-pool countries: skips tiny territories most classes won't be quizzed on
      if (c.properties.pool) by.set(c.properties.continent, [...(by.get(c.properties.continent) ?? []), c.properties.id]);
    }
    return [...by]
      .filter(([name]) => name.toLowerCase().split(" ").some((w) => w.startsWith(s)) || name.toLowerCase().startsWith(s))
      .map(([name, ids]) => ({ name, ids: ids.filter((id) => !picked.includes(id)) }))
      .filter((c) => c.ids.length > 0);
  }, [s, loaded, picked]);

  const matches = useMemo(() => {
    if (!loaded) return [] as CountryFeature[];
    return allCountries()
      .filter((c) => !picked.includes(c.properties.id))
      .filter((c) => !s || c.properties.name.toLowerCase().includes(s))
      .slice(0, 8);
  }, [s, loaded, picked]);

  const room = LIMITS.maxRounds - picked.length;
  const addOne = (id: string) => { setPicked((p) => [...p, id]); setQ(""); setNote(null); };
  const addContinent = (name: string, ids: string[]) => {
    // shuffled so the rounds don't run alphabetically
    const chosen = shuffle(ids).slice(0, room);
    setPicked((p) => [...p, ...chosen]);
    setQ("");
    setNote(chosen.length < ids.length
      ? `${name} has ${ids.length} countries, but a game is at most ${LIMITS.maxRounds} rounds, so ${chosen.length} were picked at random.`
      : `Added ${plural(chosen.length, "country", "countries")} from ${name}, in random order.`);
  };

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
        placeholder={loaded ? "Search a country or continent…" : "Loading countries…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || room <= 0) return;
          if (continents[0]) addContinent(continents[0].name, continents[0].ids);
          else if (matches[0]) addOne(matches[0].properties.id);
        }}
        aria-label="Search countries or continents"
      />
      {q && (
        <ul className="matches">
          {continents.map((c) => (
            <li key={c.name}>
              <button className="continent" disabled={room <= 0} onClick={() => addContinent(c.name, c.ids)}>
                <span>Add all of <strong>{c.name}</strong></span> <span className="muted">{plural(c.ids.length, "country", "countries")}</span>
              </button>
            </li>
          ))}
          {matches.map((c) => (
            <li key={c.properties.id}>
              <button disabled={room <= 0} onClick={() => addOne(c.properties.id)}>
                {c.properties.name} <span className="muted">{c.properties.continent}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && continents.length === 0 && <li className="muted">No matches</li>}
        </ul>
      )}
      {note && <p className="muted picker-note">{note}</p>}
      {picked.length > 0 && (
        <div className="picked-head">
          <span className="muted">{picked.length} / {LIMITS.maxRounds} rounds</span>
          <button className="btn btn-sm btn-ghost" onClick={() => { setPicked(() => []); setNote(null); }}>Clear all</button>
        </div>
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

function PastGames({ onReuse }: { onReuse: (countryIds: string[]) => void }) {
  const [games, setGames] = useState<PastGame[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/host/games").then(async (r) => setGames(r.ok ? (await r.json()).games : []));
  }, []);

  const rename = async (g: PastGame, label: string) => {
    setError(null);
    const r = await fetch(`/api/host/games/${g.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? "Couldn't rename the game");
    setGames((gs) => gs?.map((x) => (x.id === g.id ? { ...x, label: body.label || null } : x)) ?? null);
    setEditing(null);
  };

  const remove = async (g: PastGame) => {
    if (!confirm(`Delete "${title(g)}" and its results? This can't be undone.`)) return;
    setError(null);
    const r = await fetch(`/api/host/games/${g.id}`, { method: "DELETE" });
    if (!r.ok) return setError((await r.json()).error ?? "Couldn't delete the game");
    setGames((gs) => gs?.filter((x) => x.id !== g.id) ?? null);
  };

  return (
    <section className="card past">
      <h2>Past games</h2>
      {error && <p className="error">{error}</p>}
      {!games && <p className="muted">Loading…</p>}
      {games?.length === 0 && <p className="muted">No games yet.</p>}
      <ul className="past-list">
        {games?.map((g) => {
          const ids = JSON.parse(g.country_ids) as string[];
          return (
            <li key={g.id}>
              <div className="past-row">
                <div className="past-info">
                  {editing === g.id ? (
                    <LabelEditor initial={g.label ?? ""} onSave={(l) => rename(g, l)} onCancel={() => setEditing(null)} />
                  ) : (
                    <strong>{title(g)}</strong>
                  )}
                  <div className="muted">
                    {g.label && <>{date(g)} · </>}
                    {plural(ids.length, "round")} · {plural(g.player_count, "player")} · {g.finished_at ? "finished" : "not finished"}
                  </div>
                </div>
                <div className="row-actions">
                  {!g.finished_at && <button className="btn btn-sm" onClick={() => navigate(`/host/party/${g.code}`)}>Open</button>}
                  {g.finished_at && <button className="btn btn-sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "Hide" : "Results"}</button>}
                  {g.finished_at && <a className="btn btn-sm" href={`/api/host/games/${g.id}.csv`}>CSV</a>}
                  <button className="btn btn-sm" onClick={() => onReuse(ids)} title="Start a new game with the same countries">Reuse</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(g.id)}>Rename</button>
                  {g.finished_at && <button className="btn btn-sm btn-ghost danger" onClick={() => remove(g)}>Delete</button>}
                </div>
              </div>
              {open === g.id && <GameResults id={g.id} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LabelEditor({ initial, onSave, onCancel }: { initial: string; onSave: (label: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <form className="label-edit" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <input autoFocus value={v} maxLength={60} placeholder="e.g. Period 3 (empty = show the date)" aria-label="Game label"
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button className="btn btn-sm">Save</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
    </form>
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

const date = (g: PastGame) => new Date(g.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const title = (g: PastGame) => g.label || date(g);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
