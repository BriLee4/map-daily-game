# 🌍 Daily Map Quiz

A live geography game for classrooms. The teacher projects a game, students join on their
Chromebooks with a code, and each round everyone races the clock to drop a pin on a 3D globe.
The class then sees a **heat map** of where everyone guessed, the teacher **reveals** the answer,
and the **leaderboard** updates.

- **Teacher:** signs in with **Cloudflare Access (Zero Trust)**, creates a game (random or hand-picked
  countries, round count, timer), runs it from the projector, and can review past games and export CSVs.
- **Students:** no accounts. They enter a 6-character code (or scan the QR code) and pick a nickname.
  Refreshing the page puts them back in the game.
- **Real-time:** one **Durable Object per party** holds the game state, the WebSockets (using the
  Hibernation API) and the round timer (Durable Object **alarms**, so the server ends the round, not the browser).
- **History:** finished games are written to **D1**.

## How a round works

| Phase | Projector (teacher) | Student device |
|---|---|---|
| `lobby` | Big join code + QR, list of players (kick ×, lock room) | "You're in!" |
| `question` | "Find **Mongolia**", countdown, who has pinned / locked in | Tap the globe to drop a pin, **Lock in** |
| `heatmap` | Heat map of all guesses (anonymous) → **Reveal answer** | Same heat map + own pin |
| `reveal` | Country highlighted, every guess as a coloured dot, leaderboard with round points → **Next round** | Own distance, line to the border, points, rank |
| `final` | Podium + full leaderboard | Final rank + score |

The round ends when the timer runs out, when every connected student has locked in, or when the
teacher clicks **End round now**.

**Scoring:** a guess inside the country, or within 25 km of its border (so tiny countries like
Vatican City are fair), scores **5,000**. Otherwise the score is
`5000 · e^(−(km − 25) / 2000)`, where `km` is the distance to the nearest point of the border.
For example, 500 km away scores about 3,900 points and 3,000 km away about 1,100.
Scores are calculated on the server and only shown once the answer is revealed.

## Architecture

```
Browser (React + MapLibre GL globe)
   │  /            /play/CODE                 ← public (students)
   │  /host        /host/party/CODE           ← behind Cloudflare Access (teachers)
   ▼
Worker (src/worker/index.ts)
   ├─ static assets (Vite build, SPA fallback)
   ├─ /api/party/:code[/ws]         public: game lookup, student WebSocket
   ├─ /api/host/*                   checks the Access JWT, then:
   │     POST /games                create a game → Party.init() (RPC)
   │     GET  /games[/:id][.csv]    history from D1
   │     GET  /party/:code/ws       teacher WebSocket (owner checked)
   ▼
Party Durable Object (src/worker/party.ts), one per join code, SQLite-backed
   ├─ ctx.acceptWebSocket() with hibernation; per-socket role in serializeAttachment()
   ├─ state in ctx.storage; alarm = round timer, then cleanup
   └─ writes results to D1 when the game ends
```

- The Worker rebuilds every request it forwards to the Durable Object, so a student can't fake the
  `X-GG-Role: host` header. The Durable Object also checks that the teacher's email matches the
  game's owner.
- Country shapes come from [Natural Earth](https://www.naturalearthdata.com/) 1:50m (public domain),
  slimmed down by `scripts/build-countries.mjs` to `src/shared/countries.json` (234 countries; 197 are
  in the random pool, which leaves out small territories like Jersey or Hong Kong). There's no tile
  server or API key: the globe is drawn from that file, with **no labels**, so it doesn't give answers away.
- Before the reveal, students get only the country's name and their own guess. Every student's
  results are sent only to the teacher's screen.

## Run it locally

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

The example file sets `DEV_TEACHER_EMAIL`, which skips Access on localhost only.

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Open <http://localhost:5173/host> to create a game, then open <http://localhost:5173> in another
browser or a private window to join as a student.

Tests:

```bash
npm test                 # scoring and geometry unit tests
```

```bash
npm run test:protocol    # WebSocket protocol checks (needs `npm run dev` running)
```

```bash
npm run test:e2e         # Playwright: one teacher and 3 students through a full game (screenshots in .shots/)
```

## Deploy (workers.dev)

1. Create the D1 database and paste the printed `database_id` into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create daily-map-quiz
   ```
2. Apply the database schema:
   ```bash
   npm run db:migrate:remote
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
   The game will be at `https://daily-map-quiz.<your-subdomain>.workers.dev`.
4. Protect the teacher side (next section) **before you use it with a class**. Until it's
   configured, `/api/host/*` returns an error, so nobody can create games.

## Protect the teacher side with Cloudflare Access (Zero Trust)

Students need open access, and teachers need sign-in, so protect **paths**, not the whole Worker.

> ⚠️ Don't use **Workers & Pages → your Worker → Access → "Protect this Worker"**. That locks out
> students too, and worker-level Access policies currently reject WebSocket upgrades with a 403.
> Use a hostname- and path-based self-hosted application instead.

1. Turn on Zero Trust for your account if you haven't (the Free plan covers up to 50 users).
2. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
3. Add two public hostnames/paths for your workers.dev hostname:
   - `daily-map-quiz.<sub>.workers.dev` with path `host`
   - `daily-map-quiz.<sub>.workers.dev` with path `api/host`
4. Add a policy, for example **Allow** with **Emails ending in** `@yourschool.org`, or a list of teacher
   emails. If your school uses Google Workspace or Microsoft 365, add it as a login method under
   **Settings → Authentication** so teachers sign in with their school account. Otherwise the
   one-time PIN emailed to the teacher works.
5. Copy the application's **Application Audience (AUD) tag**, and your team domain
   (`https://<team>.cloudflareaccess.com`), into `wrangler.jsonc` → `vars.POLICY_AUD` /
   `vars.TEAM_DOMAIN`, then redeploy.

The Worker verifies the `Cf-Access-Jwt-Assertion` JWT on every `/api/host/*` request using `jose`,
checking the issuer and audience against your team's signing keys. It checks the token itself
because Workers that serve Static Assets don't receive `ctx.access`. Each teacher only sees and
controls their own games.

Why not put students behind Zero Trust too? Kids would need accounts and email addresses, signing in
eats class time on shared Chromebooks, and the game would have to store personal data. Instead,
students' only identity is a random key in their browser plus a nickname. Join codes only work while
a game is live, and the teacher can lock the room or remove anyone.

## Privacy & retention

- Students enter a nickname only, and the join screen tells them not to use their full name.
- A game's live state is deleted 6 hours after it ends, or 12 hours after it was created if it was
  never finished. An abandoned lobby with no players is removed from the history.
- D1 keeps each finished game's nicknames and scores so the teacher can review them and export a
  CSV. Delete rows from `games` / `game_players` to remove them.

## Limits & settings

`src/shared/protocol.ts → LIMITS`: 1–30 rounds, 10–180 s timer, up to 60 players per party.

## Project layout

```
src/shared/     geo.ts (scoring), protocol.ts (message types), countries.json
src/worker/     index.ts (routes), party.ts (Durable Object), auth.ts (Access JWT)
src/client/     React app: pages/Home, Play (student), HostHome (dashboard), HostParty (projector)
migrations/     D1 schema
scripts/        build-countries.mjs (regenerates countries.json from data/)
tests/          protocol + Playwright end-to-end scripts
```
