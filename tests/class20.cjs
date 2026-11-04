// Simulated class: 20 students on real WebSockets with believable guess spreads,
// teacher projector + one student's Chromebook in a real browser for screenshots.
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173", WSB = BASE.replace(/^http/, "ws");
const OUT = process.env.OUT ?? __dirname + "/../.shots/class20";
require("fs").mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// seeded RNG so the run is reproducible
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
function pick(clusters) {
  let r = rand(), acc = 0;
  for (const c of clusters) { acc += c.w; if (r <= acc) return [c.lng + gauss() * c.sd, Math.max(-80, Math.min(80, c.lat + gauss() * c.sd * 0.8))]; }
  return [rand() * 360 - 180, rand() * 140 - 70];
}
// where a real class tends to guess: mostly right, common mix-ups, a few wild ones
const ROUNDS = [
  { id: "BRA", clusters: [{ lng: -51, lat: -10, sd: 5, w: 0.6 }, { lng: -64, lat: -33, sd: 4, w: 0.14 }, { lng: -70, lat: 4, sd: 4, w: 0.12 }, { lng: 20, lat: 0, sd: 8, w: 0.09 }] },
  { id: "MNG", clusters: [{ lng: 103, lat: 46.5, sd: 4, w: 0.4 }, { lng: 106, lat: 33, sd: 5, w: 0.22 }, { lng: 70, lat: 48, sd: 5, w: 0.16 }, { lng: 98, lat: 61, sd: 6, w: 0.1 }, { lng: 128, lat: 37, sd: 3, w: 0.07 }] },
  { id: "EGY", clusters: [{ lng: 30, lat: 26.5, sd: 2.5, w: 0.55 }, { lng: 18, lat: 26, sd: 4, w: 0.15 }, { lng: 31, lat: 15, sd: 3, w: 0.12 }, { lng: 45, lat: 24, sd: 4, w: 0.1 }] },
];
const NAMES = ["Maya", "Liam", "Sofia", "Noah", "Ava", "Ethan", "Zoe", "Lucas", "Mia", "Owen", "Chloe", "Leo", "Aria", "Jack", "Lily", "Mateo", "Nora", "Eli", "Ruby", "Kai"];

function bot(code, i) {
  const key = `sim-student-key-${String(i).padStart(4, "0")}`;
  const ws = new WebSocket(`${WSB}/api/party/${code}/ws?k=${key}`);
  const b = { key, ws, last: null };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "needName") ws.send(JSON.stringify({ t: "join", name: NAMES[i] })); if (m.t === "state") b.last = m; };
  b.send = (m) => ws.send(JSON.stringify(m));
  return b;
}

(async () => {
  const r = await fetch(BASE + "/api/host/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "custom", countryIds: ROUNDS.map((x) => x.id), timerSeconds: 30 }) });
  const { code } = await r.json();
  console.log("game", code);
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await host.goto(`${BASE}/host/party/${code}`);

  const bots = [];
  for (let i = 0; i < 20; i++) { bots.push(bot(code, i)); await sleep(120); }
  // Maya's Chromebook: same browser key as bot 0, so the page shows her view
  const kidCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await kidCtx.addInitScript((k) => localStorage.setItem("gg-key", k), bots[0].key);
  const kid = await kidCtx.newPage();
  await kid.goto(`${BASE}/play/${code}`);
  await host.getByText("20 players").waitFor({ timeout: 20000 });
  await sleep(800);
  await host.screenshot({ path: `${OUT}/0-lobby.png` });

  for (let ri = 0; ri < ROUNDS.length; ri++) {
    await host.getByRole("button", { name: ri === 0 ? "Start game" : "Next round" }).click();
    await sleep(1500);
    // students pin at staggered times, ~3/4 lock in, the rest are caught by the timer
    const guesses = bots.map(() => pick(ROUNDS[ri].clusters));
    for (let i = 0; i < bots.length; i++) {
      bots[i].send({ t: "guess", lng: guesses[i][0], lat: guesses[i][1] });
      if (i === 13) { await sleep(600); await host.screenshot({ path: `${OUT}/${ri + 1}a-question.png` }); }
      await sleep(80);
    }
    for (let i = 0; i < bots.length; i++) if (i % 4 !== 3) { bots[i].send({ t: "lock" }); await sleep(60); }
    if (ri === 0) { await sleep(1500); await kid.screenshot({ path: `${OUT}/${ri + 1}b-student-question.png` }); }
    await host.getByRole("button", { name: "End round now" }).click();
    await host.getByRole("button", { name: "Reveal answer" }).waitFor();
    await sleep(3500); // camera flight + heatmap render
    await host.screenshot({ path: `${OUT}/${ri + 1}c-heatmap.png` });
    if (ri === 0) await kid.screenshot({ path: `${OUT}/${ri + 1}d-student-heatmap.png` });
    await host.getByRole("button", { name: "Reveal answer" }).click();
    await sleep(3500);
    await host.screenshot({ path: `${OUT}/${ri + 1}e-reveal.png` });
    if (ri === 0) await kid.screenshot({ path: `${OUT}/${ri + 1}f-student-reveal.png` });
  }
  await host.getByRole("button", { name: "Final results" }).click();
  await host.locator(".podium").waitFor();
  await sleep(600);
  await host.screenshot({ path: `${OUT}/9-final.png` });
  console.log("final", JSON.stringify(host && (await host.locator(".leaderboard").innerText()).split("\n").slice(0, 12)));
  await browser.close();
  bots.forEach((b) => b.ws.close());
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
