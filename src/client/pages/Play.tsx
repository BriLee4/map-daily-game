import { useEffect, useMemo, useState } from "react";
import type { Position } from "../../shared/geo";
import { LIMITS } from "../../shared/protocol";
import { ConnBadge, fmt, km, Leaderboard, ordinal, Timer } from "../components/bits";
import { Globe, type GlobeResultLine } from "../components/Globe";
import { lastName, playerKey, rememberName } from "../lib/identity";
import { navigate } from "../lib/router";
import { useCountdown, useParty } from "../lib/useParty";

export function Play({ code }: { code: string }) {
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`/api/party/${code}`).then((r) => setExists(r.ok)).catch(() => setExists(false));
  }, [code]);

  if (exists === null) return <Center>Finding game {code}…</Center>;
  if (!exists)
    return (
      <Center>
        <h2>No game with code {code}</h2>
        <p>Check the code on the board and try again.</p>
        <button className="btn" onClick={() => navigate("/")}>Back</button>
      </Center>
    );
  return <PlayInner code={code} />;
}

function PlayInner({ code }: { code: string }) {
  const conn = useParty(`/api/party/${code}/ws?k=${encodeURIComponent(playerKey())}`);
  const { state, you, send } = conn;
  const seconds = useCountdown(state?.endsAt ?? null, conn.clockOffset);
  // optimistic pin so taps feel instant
  const [localPin, setLocalPin] = useState<Position | null>(null);
  useEffect(() => setLocalPin(null), [state?.roundIndex, state?.phase]);

  const results: GlobeResultLine[] = useMemo(
    () => (you?.last && you.guess ? [{ guess: you.guess, nearest: you.last.nearest, score: you.last.score, mine: true }] : []),
    [you?.last, you?.guess],
  );

  if (conn.fatal) return <Center><h2>{conn.fatal}</h2><button className="btn" onClick={() => navigate("/")}>Home</button></Center>;
  if (conn.needName) return <NameForm onSubmit={(name) => send({ t: "join", name })} error={conn.error} />;
  if (!state || !you) return <Center>Connecting…</Center>;

  const phase = state.phase;
  const canGuess = phase === "question" && !you.locked && seconds > 0;
  const pin = localPin ?? you.guess;

  if (phase === "lobby")
    return (
      <Center>
        <ConnBadge status={conn.status} />
        <p className="eyebrow">You're in!</p>
        <h1 className="big-name">{you.name}</h1>
        <p>Waiting for your teacher to start…</p>
        <p className="muted">{state.players.length} player{state.players.length === 1 ? "" : "s"} joined</p>
      </Center>
    );

  if (phase === "final") {
    return (
      <div className="page final-student">
        <p className="eyebrow">Game over</p>
        <h1>You finished {ordinal(you.rank)}</h1>
        <p className="big-score">{fmt(you.score)} pts</p>
        <Leaderboard players={state.players} highlightId={you.id} limit={5} />
        <button className="btn" onClick={() => navigate("/")}>Done</button>
      </div>
    );
  }

  return (
    <div className="play">
      <ConnBadge status={conn.status} />
      <header className="play-bar">
        <div className="round">Round {state.roundIndex + 1}/{state.totalRounds}</div>
        <div className="prompt">
          <span className="find">Find</span> <strong>{state.country?.name}</strong>
        </div>
        {phase === "question" ? <Timer seconds={seconds} total={state.timerSeconds} /> : <div className="score-chip">{fmt(you.score)}</div>}
      </header>

      <Globe
        className="play-globe"
        onPick={canGuess ? (p) => { setLocalPin(p); send({ t: "guess", lng: p[0], lat: p[1] }); } : undefined}
        pin={phase === "reveal" ? null : pin}
        heat={phase === "heatmap" || phase === "reveal" ? state.heat : null}
        answerId={state.reveal?.countryId}
        results={results}
        focus={phase === "heatmap" ? state.heat : phase === "reveal" && you.guess ? [you.guess] : null}
        resetKey={phase === "question" ? state.roundIndex : undefined}
      />

      <footer className="play-foot">
        {phase === "question" && !you.locked && (
          pin ? (
            <button className="btn btn-primary btn-lg" onClick={() => send({ t: "lock" })}>Lock in guess</button>
          ) : (
            <p className="hint">Tap the globe to drop your pin</p>
          )
        )}
        {phase === "question" && you.locked && <p className="hint">Locked in! Waiting for the others…</p>}
        {phase === "heatmap" && <p className="hint">{you.guess ? "Here's where everyone guessed. Waiting for the reveal…" : "Time's up! Here's where everyone guessed."}</p>}
        {phase === "reveal" && (
          <div className="result-card">
            {you.last ? (
              <>
                <strong>{km(you.last.km)}</strong>
                <span>+{fmt(you.last.score)} pts</span>
              </>
            ) : (
              <strong>No guess this round</strong>
            )}
            <span className="muted">You're {ordinal(you.rank)} · {fmt(you.score)} total</span>
          </div>
        )}
      </footer>
    </div>
  );
}

function NameForm({ onSubmit, error }: { onSubmit: (name: string) => void; error: string | null }) {
  const [name, setName] = useState(lastName());
  return (
    <Center>
      <form
        className="card name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          rememberName(name.trim());
          onSubmit(name.trim());
        }}
      >
        <h2>Pick a nickname</h2>
        <p className="muted">Use your first name or a fun nickname — not your full name.</p>
        <input
          autoFocus
          value={name}
          maxLength={LIMITS.maxNameLength}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nickname"
          aria-label="Nickname"
        />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-lg" type="submit">Join</button>
      </form>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="center-page">{children}</div>;
}
