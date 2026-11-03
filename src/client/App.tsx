import { lazy, Suspense, useEffect } from "react";
import { Home } from "./pages/Home";
import { navigate, usePath } from "./lib/router";

// Map-heavy pages load on demand so the join screen is instant on school Wi-Fi.
const Play = lazy(() => import("./pages/Play").then((m) => ({ default: m.Play })));
const HostParty = lazy(() => import("./pages/HostParty").then((m) => ({ default: m.HostParty })));
const HostHome = lazy(() => import("./pages/HostHome").then((m) => ({ default: m.HostHome })));

export function App() {
  const path = usePath();

  // QR codes point at /join/CODE; normalise to /play/CODE
  const joinCode = path.match(/^\/join\/([A-Za-z0-9]{6})\/?$/)?.[1].toUpperCase() ?? null;
  useEffect(() => {
    if (joinCode) navigate(`/play/${joinCode}`, true);
  }, [joinCode]);
  if (joinCode) return null;

  return <Suspense fallback={<div className="center-page">Loading…</div>}>{route(path)}</Suspense>;
}

function route(path: string) {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/play\/([A-Za-z0-9]{6})\/?$/))) return <Play key={m[1]} code={m[1].toUpperCase()} />;
  if ((m = path.match(/^\/host\/party\/([A-Za-z0-9]{6})\/?$/))) return <HostParty key={m[1]} code={m[1].toUpperCase()} />;
  if (/^\/host\/?$/.test(path)) return <HostHome />;
  return <Home />;
}
