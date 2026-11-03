import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { ConnBadge, fmt, Leaderboard, rankPlayers, Timer } from "../components/bits";
import { Globe, type GlobeResultLine } from "../components/Globe";
import { getCountry } from "../lib/countries";
import { navigate } from "../lib/router";
import { useCountdown, useParty } from "../lib/useParty";

/** The teacher's screen — designed to be projected for the class. */
export function HostParty({ code }: { code: string }) {
  const conn = useParty(`/api/host/party/${code}/ws`);
  const { state, send } = conn;
  const seconds = useCountdown(state?.endsAt ?? null, conn.clockOffset);
  const joinUrl = `${location.origin}/join/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 360 }).then(setQr);
  }, [joinUrl]);

  const results: GlobeResultLine[] = useMemo(
    () => state?.reveal?.results.map((r) => ({ guess: r.guess, score: r.score })) ?? [],
    [state?.reveal],
  );
  const roundScores = useMemo(
    () => new Map(state?.reveal?.results.map((r) => [r.playerId, r.score]) ?? []),
    [state?.reveal],
  );

  if (!state)
    return (
      <div className="center-page">
        <ConnBadge status={conn.status} />
        {conn.status === "reconnecting" ? <p>Can't connect to game {code}. Is it yours, and still open?</p> : <p>Connecting…</p>}
        <button className="btn" onClick={() => navigate("/host")}>Back to dashboard</button>
      </div>
    );

  const phase = state.phase;
  const answered = state.players.filter((p) => p.answered).length;
  const locked = state.players.filter((p) => p.locked).length;
  const host = location.host;
  const confirmEnd = () => confirm("End the game now? Scores so far will be saved.") && send({ t: "finish" });

  if (phase === "lobby")
    return (
      <div className="host-lobby">
        <ConnBadge status={conn.status} />
        <div className="join-panel">
          <p className="eyebrow">Join at <strong>{host}</strong></p>
          <div className="code" aria-label={`Game code ${code.split("").join(" ")}`}>{code}</div>
          {qr && <img className="qr" src={qr} alt={`QR code for ${joinUrl}`} />}
        </div>
        <div className="lobby-side">
          <div className="lobby-head">
            <h2>{state.players.length} player{state.players.length === 1 ? "" : "s"}</h2>
            <label className="toggle">
              <input type="checkbox" checked={state.locked} onChange={(e) => send({ t: "setLocked", locked: e.target.checked })} />
              Lock room
            </label>
          </div>
          <ul className="chips">
            {state.players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "offline"}>
                {p.name}
                <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => confirm(`Remove ${p.name}?`) && send({ t: "kick", playerId: p.id })}>×</button>
              </li>
            ))}
            {state.players.length === 0 && <li className="muted placeholder">Waiting for students…</li>}
          </ul>
          <p className="muted">{state.totalRounds} rounds · {state.timerSeconds}s each</p>
          <button className="btn btn-primary btn-xl" onClick={() => send({ t: "start" })} disabled={state.players.length === 0}>
            Start game
          </button>
        </div>
      </div>
    );

  if (phase === "final") {
    const ranked = rankPlayers(state.players);
    const podium = ranked.slice(0, 3);
    return (
      <div className="host-final">
        <h1>Final results</h1>
        <div className="podium">
          {[podium[1], podium[0], podium[2]].map((r, i) =>
            r ? (
              <div key={r.p.id} className={`step step-${r.rank}`} style={{ order: i }}>
                <div className="pname">{r.p.name}</div>
                <div className="pscore">{fmt(r.p.score)}</div>
                <div className="block">{r.rank}</div>
              </div>
            ) : <div key={i} className="step empty" />,
          )}
        </div>
        <Leaderboard players={state.players} />
        <div className="row-actions center">
          <button className="btn" onClick={() => navigate("/host")}>Back to dashboard</button>
        </div>
      </div>
    );
  }

  const answer = state.reveal ? getCountry(state.reveal.countryId) : undefined;
  return (
    <div className="host-game">
      <ConnBadge status={conn.status} />
      <header className="host-bar">
        <div className="round">Round {state.roundIndex + 1} / {state.totalRounds}</div>
        <div className="prompt">
          <span className="find">Find</span> <strong>{state.country?.name}</strong>
        </div>
        <div className="host-bar-right">
          {phase === "question" && <Timer seconds={seconds} total={state.timerSeconds} />}
          <span className="code-small">{code}</span>
        </div>
      </header>

      <div className="host-main">
        <Globe
          className="host-globe"
          heat={phase === "heatmap" || phase === "reveal" ? state.heat : null}
          answerId={state.reveal?.countryId}
          results={phase === "reveal" ? results : undefined}
          focus={phase === "heatmap" || phase === "reveal" ? state.heat : null}
          resetKey={phase === "question" ? state.roundIndex : undefined}
        />
        <aside className="host-side">
          {phase === "question" && (
            <>
              <div className="stat"><span className="n">{answered}</span>/{state.players.length} pinned · {locked} locked in</div>
              <ul className="chips small">
                {state.players.map((p) => (
                  <li key={p.id} className={`${p.locked ? "done" : p.answered ? "pinned" : ""} ${p.connected ? "" : "offline"}`}>{p.name}</li>
                ))}
              </ul>
              <button className="btn" onClick={() => send({ t: "endRound" })}>End round now</button>
            </>
          )}
          {phase === "heatmap" && (
            <>
              <h2>Where did we guess?</h2>
              <p className="muted">{state.heat?.length ?? 0} guesses. Discuss, then reveal the answer.</p>
              <button className="btn btn-primary btn-xl" onClick={() => send({ t: "reveal" })}>Reveal answer</button>
            </>
          )}
          {phase === "reveal" && (
            <>
              <h2>It's {answer?.properties.name ?? state.country?.name}!</h2>
              {answer && <p className="muted">{answer.properties.continent}</p>}
              <Leaderboard players={state.players} roundScores={roundScores} limit={10} />
              <button className="btn btn-primary btn-xl" onClick={() => send({ t: "next" })}>
                {state.roundIndex + 1 >= state.totalRounds ? "Final results" : "Next round"}
              </button>
            </>
          )}
          <button className="btn btn-ghost" onClick={confirmEnd}>End game</button>
        </aside>
      </div>
    </div>
  );
}
