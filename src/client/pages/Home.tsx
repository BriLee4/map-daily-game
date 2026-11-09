import { lazy, Suspense, useState } from "react";
import { navigate } from "../lib/router";

// The globe (MapLibre + country shapes) loads after the join form, so typing a code is never held up.
const HomeGlobe = lazy(() => import("../components/HomeGlobe"));

export function Home() {
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return (
    <div className="center-page home">
      <Suspense fallback={<div className="home-globe" aria-hidden="true" />}>
        <HomeGlobe />
      </Suspense>
      <h1 className="logo">Globe Guess</h1>
      <p className="muted">Find the country on the globe. Closest guess wins.</p>
      <form
        className="card join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length === 6) navigate(`/play/${clean}`);
        }}
      >
        <label htmlFor="code">Game code</label>
        <input
          id="code"
          className="code-input"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          value={clean}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABC123"
        />
        <button className="btn btn-primary btn-lg" disabled={clean.length !== 6}>Join game</button>
      </form>
      <a className="teacher-link" href="/host">I'm a teacher →</a>
    </div>
  );
}
