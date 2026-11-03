const { chromium } = require("playwright");
const OUT = process.env.OUT ?? __dirname + "/../.shots";
require("fs").mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:5173";
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  const mk = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
    return p;
  };
  // Teacher creates a custom game
  const host = await mk(1440, 900);
  await host.goto(BASE + "/host");
  await host.getByRole("tab", { name: "Pick countries" }).click();
  for (const c of ["Brazil", "Mongolia"]) {
    await host.getByLabel("Search countries").fill(c);
    await host.locator(".matches button", { hasText: c }).first().waitFor();
    await host.getByLabel("Search countries").press("Enter");
  }
  await host.selectOption("select", "15");
  await host.screenshot({ path: OUT + "/01-dashboard.png" });
  await host.getByRole("button", { name: /Create game/ }).click();
  await host.waitForURL(/\/host\/party\//);
  const code = host.url().split("/").pop();
  console.log("code", code);

  const names = ["Ava", "Ben", "Chloe"];
  const kids = [];
  for (const n of names) {
    const k = await mk(1280, 720);
    await k.goto(BASE + "/join/" + code);
    await k.getByLabel("Nickname").fill(n);
    await k.getByRole("button", { name: "Join" }).click();
    await k.getByText("You're in!").waitFor();
    kids.push(k);
  }
  await host.getByText("3 players").waitFor();
  await host.screenshot({ path: OUT + "/02-lobby.png" });
  await kids[0].screenshot({ path: OUT + "/03-student-lobby.png" });

  for (let round = 0; round < 2; round++) {
    if (round === 0) await host.getByRole("button", { name: "Start game" }).click();
    else await host.getByRole("button", { name: "Next round" }).click();
    for (const k of kids) await k.getByText("Tap the globe").waitFor();
    await kids[0].waitForTimeout(4000); // let map render
    // each kid taps a different spot then locks in
    const spots = [[0.42, 0.62], [0.45, 0.6], [0.6, 0.4]];
    for (let i = 0; i < kids.length; i++) {
      const box = await kids[i].locator(".play-globe canvas").boundingBox();
      await kids[i].mouse.click(box.x + box.width * spots[i][0], box.y + box.height * spots[i][1]);
      await kids[i].getByRole("button", { name: "Lock in guess" }).waitFor();
    }
    if (round === 0) await kids[0].screenshot({ path: OUT + "/04-student-question.png" });
    if (round === 0) await host.screenshot({ path: OUT + "/05-host-question.png" });
    for (const k of kids) await k.getByRole("button", { name: "Lock in guess" }).click();
    // all locked -> auto heatmap
    await host.getByRole("button", { name: "Reveal answer" }).waitFor({ timeout: 5000 });
    await host.waitForTimeout(800);
    if (round === 0) await host.screenshot({ path: OUT + "/06-host-heatmap.png" });
    await host.getByRole("button", { name: "Reveal answer" }).click();
    await host.getByText(/^It's /).waitFor();
    await host.waitForTimeout(2200);
    await host.screenshot({ path: OUT + `/07-host-reveal-r${round + 1}.png` });
    await kids[0].waitForTimeout(500);
    await kids[0].screenshot({ path: OUT + `/08-student-reveal-r${round + 1}.png` });
    console.log("round", round + 1, await kids[0].locator(".result-card").innerText());
  }
  await host.getByRole("button", { name: "Final results" }).click();
  await host.locator(".podium").waitFor();
  await host.screenshot({ path: OUT + "/09-host-final.png" });
  await kids[1].getByText(/You finished/).waitFor();
  await kids[1].screenshot({ path: OUT + "/10-student-final.png" });
  // dashboard history + CSV
  await host.goto(BASE + "/host");
  await host.getByRole("button", { name: "Results" }).first().click();
  await host.waitForTimeout(500);
  await host.screenshot({ path: OUT + "/11-dashboard-history.png" });
  const games = await (await host.request.get(BASE + "/api/host/games")).json();
  const csv = await (await host.request.get(BASE + `/api/host/games/${games.games[0].id}.csv`)).text();
  console.log(csv);
  // mobile student view
  const phone = await mk(390, 780);
  await phone.goto(BASE + "/");
  await phone.screenshot({ path: OUT + "/12-phone-home.png" });
  console.log("ERRORS", JSON.stringify(errors.filter((e) => !/WebGL|GPU|swiftshader/i.test(e)), null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
