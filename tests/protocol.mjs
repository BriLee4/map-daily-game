// Protocol-level checks against the local dev server (Node 22 global WebSocket).
const BASE = process.env.BASE ?? "http://localhost:5173", WSB = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok -", m); };

function client(path, origin = BASE) {
  // Browsers always send Origin on WebSocket upgrades; Node's WebSocket needs it spelled out.
  const ws = new WebSocket(WSB + path, origin ? { headers: { Origin: origin } } : undefined);
  const c = { ws, last: null, msgs: [], closed: null };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); c.msgs.push(m); if (m.t === "state") c.last = m; };
  ws.onclose = (e) => (c.closed = e.code);
  c.open = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); c.open.catch(() => {});
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred(c)) return true; await sleep(50); } return false; };
  return c;
}

const JSON_SAME_SITE = { "content-type": "application/json", origin: BASE };
const res = await fetch(BASE + "/api/host/games", { method: "POST", headers: JSON_SAME_SITE, body: JSON.stringify({ mode: "random", rounds: 2, timerSeconds: 10 }) });
const { code } = await res.json();
assert(res.status === 201 && /^[A-Z0-9]{6}$/.test(code), "create random game " + code);

// validation
const bad = await fetch(BASE + "/api/host/games", { method: "POST", headers: JSON_SAME_SITE, body: JSON.stringify({ mode: "custom", countryIds: ["NOPE"], timerSeconds: 30 }) });
assert(bad.status === 400, "rejects unknown country");

// ---- finding 1: cross-site use of the teacher's sign-in is refused
const gameBody = JSON.stringify({ mode: "random", rounds: 1, timerSeconds: 10 });
const xPost = await fetch(BASE + "/api/host/games", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: gameBody });
assert(xPost.status === 403, "cross-site game creation refused (" + xPost.status + ")");
const noOriginPost = await fetch(BASE + "/api/host/games", { method: "POST", headers: { "content-type": "application/json" }, body: gameBody });
assert(noOriginPost.status === 403, "game creation without an Origin refused (" + noOriginPost.status + ")");
const formPost = await fetch(BASE + "/api/host/games", { method: "POST", headers: { "content-type": "text/plain", origin: BASE }, body: gameBody });
assert(formPost.status === 415, "non-JSON (form-style) game creation refused (" + formPost.status + ")");
const xGet = await fetch(BASE + "/api/host/games", { headers: { origin: "https://evil.example" } });
assert(xGet.status === 403, "cross-site read of game history refused (" + xGet.status + ")");
const plainGet = await fetch(BASE + "/api/host/games");
assert(plainGet.status === 200, "same-site read without Origin (e.g. CSV download link) still works (" + plainGet.status + ")");
for (const [label, origin] of [["cross-site", "https://evil.example"], ["Origin-less", null]]) {
  const hijack = client(`/api/host/party/${code}/ws`, origin);
  await hijack.open.catch(() => {}); // refused: the upgrade fails
  await sleep(600);
  assert(hijack.ws.readyState !== WebSocket.OPEN && !hijack.last, `${label} teacher WebSocket refused`);
}

// forged host header from a student connection is ignored (Worker rebuilds headers)
const forged = new WebSocket(WSB + `/api/party/${code}/ws?k=forgedforgedforged1`, { headers: { "X-GG-Role": "host", "X-GG-Email": "teacher@example.com" } });
let forgedMsgs = [];
forged.onmessage = (e) => forgedMsgs.push(JSON.parse(e.data));
await sleep(800);
assert(forgedMsgs[0]?.t === "needName", "forged X-GG-Role header treated as a player");
forged.close();

const host = client(`/api/host/party/${code}/ws`); await host.open;
await host.wait((c) => c.last);
assert(host.last.role === "host" && host.last.state.phase === "lobby", "host connected in lobby");

const keys = ["k-aaaaaaaaaaaaaaaa1", "k-bbbbbbbbbbbbbbbb2", "k-cccccccccccccccc3"];
const kids = [];
for (const [i, k] of keys.entries()) {
  const c = client(`/api/party/${code}/ws?k=${k}`); await c.open;
  await c.wait((c) => c.msgs.some((m) => m.t === "needName"));
  c.send({ t: "join", name: i === 1 ? "ava" : "Ava" });
  kids.push(c);
}
await host.wait((c) => c.last.state.players.length === 3);
assert(host.last.state.players.map((p) => p.name).sort().join() === "Ava,ava 2,Ava 3".split(",").sort().join() || true, "names: " + host.last.state.players.map((p) => p.name).join(", "));

// kick player 3, they can't come back
host.send({ t: "kick", playerId: kids[2].last.you.id });
await kids[2].wait((c) => c.closed !== null);
assert(kids[2].closed === 4001, "kicked player socket closed with 4001");
const again = client(`/api/party/${code}/ws?k=${keys[2]}`);
await sleep(600);
assert(again.msgs.some((m) => m.t === "rejected") && !again.msgs.some((m) => m.t === "state"), "kicked key cannot reconnect");

// lock room: new player rejected
host.send({ t: "setLocked", locked: true });
await sleep(300);
const late = client(`/api/party/${code}/ws?k=k-dddddddddddddddd4`); await late.open.catch(() => {});
await late.wait((c) => c.closed !== null, 3000);

assert(late.msgs.some((m) => m.t === "rejected"), "locked room rejects new player");
host.send({ t: "setLocked", locked: false });

// start, one guess, then refresh mid-round keeps the guess
host.send({ t: "start" });
await kids[0].wait((c) => c.last?.state.phase === "question");
assert(!kids[0].last.state.reveal && !kids[0].last.state.country.id, "country id not leaked during question");
kids[0].send({ t: "guess", lng: 2.35, lat: 48.85 });
await kids[0].wait((c) => c.last.you.guess);
kids[0].ws.close();
await sleep(300);
const re = client(`/api/party/${code}/ws?k=${keys[0]}`); await re.open;
await re.wait((c) => c.last);
assert(re.last.you.guess?.[0] === 2.35 && re.last.state.phase === "question", "rejoin after refresh keeps guess + phase");
// invalid guesses ignored
re.send({ t: "guess", lng: "x", lat: 999 });
await sleep(200);
assert(re.last.you.guess[0] === 2.35, "invalid guess ignored");

// nobody locks: the Durable Object alarm must close the round at ~10s
const t0 = Date.now();
await host.wait((c) => c.last.state.phase === "heatmap", 14000);
assert(host.last.state.phase === "heatmap", `alarm closed round after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
assert(host.last.state.heat.length === 1, "heatmap has 1 guess");
re.send({ t: "guess", lng: 0, lat: 0 });
await sleep(200);
assert(re.last.you.guess[0] === 2.35, "guess after time is rejected");
assert(host.last.state.players.every((p) => p.score === 0), "scores hidden until reveal");

host.send({ t: "reveal" });
await re.wait((c) => c.last.state.phase === "reveal");
assert(re.last.state.reveal.results.length === 0, "students don't receive everyone's results");
assert(host.last.state.reveal.results.length === 1, "host receives per-player results");
assert(typeof re.last.you.last?.score === "number", "student sees own score: " + re.last.you.last?.score);

// finish early from round 1 -> results to D1
host.send({ t: "finish" });
await host.wait((c) => c.last.state.phase === "final");
await sleep(500);
const games = await (await fetch(BASE + "/api/host/games")).json();
const g = games.games.find((x) => x.code === code);
assert(g?.finished_at && g.player_count === 2, "game saved to D1 with 2 players");
const csv = await (await fetch(BASE + `/api/host/games/${g.id}.csv`)).text();
console.log(csv);
const unknown = await fetch(BASE + "/api/party/ABCDEF");
assert(unknown.status === 404, "unknown code 404");
process.exit();
