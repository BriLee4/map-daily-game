import { useEffect, useMemo, useState } from "react";
import { scoreGuess, type Position } from "../../shared/geo";
import { getCountry, loadCountries } from "../lib/countries";
import { Globe, type GlobeResultLine } from "./Globe";

/**
 * The home page's look-only demo: the globe turns to a country, a class's worth of guesses
 * appears as a heat map, then the answer lights up and the next "round" begins.
 */

interface DemoRound {
  id: string;
  name: string;
  /** where pretend students guessed: [lng, lat, spread in degrees, how many] */
  clusters: [number, number, number, number][];
}

const ROUNDS: DemoRound[] = [
  { id: "BRA", name: "Brazil", clusters: [[-50, -10, 5, 9], [-66, 6, 3, 3], [-63, -32, 3, 2]] },
  { id: "EGY", name: "Egypt", clusters: [[30, 26.5, 2.2, 9], [18, 26, 3, 2], [44, 24, 3, 2]] },
  { id: "JPN", name: "Japan", clusters: [[138, 36.5, 2, 8], [127.5, 36.5, 1.5, 3], [121, 23.8, 1, 2]] },
  { id: "AUS", name: "Australia", clusters: [[134, -25, 6, 10], [172, -41, 2, 3]] },
  { id: "MNG", name: "Mongolia", clusters: [[103, 46.5, 4, 7], [106, 34, 4, 4], [70, 48, 4, 2]] },
];

const HEAT_AT = 2600; // ms after the turn starts: guesses appear
const REVEAL_AT = 5200; // the answer lights up
const NEXT_AT = 8200; // on to the next country

/** Small seeded RNG so the demo draws the same guesses every time. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function guessesFor(round: DemoRound, seed: number): Position[] {
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  return round.clusters.flatMap(([lng, lat, sd, n]) =>
    Array.from({ length: n }, (): Position => [lng + gauss() * sd, Math.max(-75, Math.min(75, lat + gauss() * sd * 0.8))]),
  );
}

export default function HomeGlobe() {
  const [ready, setReady] = useState(false);
  const [i, setI] = useState(0);
  const [stage, setStage] = useState<"turn" | "heat" | "reveal">("turn");
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => void loadCountries().then(() => setReady(true)), []);

  useEffect(() => {
    if (!ready) return;
    setStage("turn");
    const t = [
      setTimeout(() => setStage("heat"), reduced ? 0 : HEAT_AT),
      setTimeout(() => setStage("reveal"), reduced ? 1500 : REVEAL_AT),
      // with reduced motion: show one finished round and stop
      ...(reduced ? [] : [setTimeout(() => setI((n) => (n + 1) % ROUNDS.length), NEXT_AT)]),
    ];
    return () => t.forEach(clearTimeout);
  }, [i, ready, reduced]);

  const round = ROUNDS[i];
  const guesses = useMemo(() => guessesFor(round, 7 + i), [round, i]);
  const results: GlobeResultLine[] = useMemo(() => {
    const c = getCountry(round.id);
    if (!ready || !c) return [];
    return guesses.map((g) => ({ guess: g, score: scoreGuess(g, c.geometry).score }));
  }, [ready, round, guesses]);
  const country = ready ? getCountry(round.id) : undefined;
  const center: Position | null = country ? [country.properties.lx, country.properties.ly - 6] : null;

  return (
    <figure className="home-globe" aria-hidden="true">
      <Globe
        decorative
        lookAt={center}
        heat={stage === "heat" ? guesses : null}
        answerId={stage === "reveal" ? round.id : null}
        results={stage === "reveal" ? results : undefined}
      />
      <figcaption className={`home-globe-chip ${stage === "reveal" ? "revealed" : ""}`}>
        {stage === "reveal" ? `It's ${round.name}!` : <>Find <strong>{round.name}</strong></>}
      </figcaption>
    </figure>
  );
}
