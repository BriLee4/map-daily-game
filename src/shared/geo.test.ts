import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { haversineKm, MAX_SCORE, pointInCountry, scoreGuess, type CountryGeometry } from "./geo.ts";

const data = JSON.parse(readFileSync(new URL("./countries.json", import.meta.url), "utf8")) as {
  features: { properties: { id: string; name: string }; geometry: CountryGeometry }[];
};
const geo = (id: string) => data.features.find((f) => f.properties.id === id)!.geometry;

test("haversine London→Paris ≈ 344 km", () => {
  assert.ok(Math.abs(haversineKm([-0.1276, 51.5072], [2.3522, 48.8566]) - 344) < 5);
});

test("inside the country scores full points", () => {
  assert.equal(scoreGuess([2.35, 48.85], geo("FRA")).score, MAX_SCORE); // Paris
  assert.equal(scoreGuess([105, 47], geo("MNG")).score, MAX_SCORE); // Mongolia
  assert.ok(pointInCountry([-100, 40], geo("USA")));
});

test("lake/hole and neighbour are not inside", () => {
  assert.ok(!pointInCountry([13.4, 52.5], geo("FRA"))); // Berlin is not France
});

test("score falls with distance", () => {
  const near = scoreGuess([13.4, 52.5], geo("FRA")); // Berlin, a few hundred km from France
  const far = scoreGuess([139.7, 35.7], geo("FRA")); // Tokyo
  assert.ok(near.km > 200 && near.km < 700, `near km ${near.km}`);
  assert.ok(near.score > 3500 && near.score < MAX_SCORE, `near score ${near.score}`);
  assert.ok(far.score < 100, `far score ${far.score}`);
});

test("tiny countries get border tolerance", () => {
  assert.equal(scoreGuess([12.48, 41.9], geo("VAT")).score, MAX_SCORE); // central Rome
  assert.equal(scoreGuess([7.42, 43.74], geo("MCO")).score, MAX_SCORE);
});

test("antimeridian: Fiji and far-east Russia", () => {
  assert.equal(scoreGuess([178.0, -17.8], geo("FJI")).score, MAX_SCORE);
  const r = scoreGuess([-179.5, -17.0], geo("FJI")); // just across the dateline
  assert.ok(r.km < 300, `fiji dateline km ${r.km}`);
  assert.ok(pointInCountry([179.5, 66.5], geo("RUS")) || pointInCountry([170, 66], geo("RUS")));
});
