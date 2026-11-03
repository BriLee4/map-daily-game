// Builds src/shared/countries.json from Natural Earth 1:50m admin-0 countries (public domain).
// Source: https://github.com/nvkelso/natural-earth-vector (geojson/ne_50m_admin_0_countries.geojson)
// Download first:
//   curl -L -o data/ne_50m_admin_0_countries.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
// Run: npm run data
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(
  readFileSync(new URL("../data/ne_50m_admin_0_countries.geojson", import.meta.url), "utf8"),
);

// Not offered in the random pool (still pickable for custom rounds and drawn on the globe).
const NOT_IN_RANDOM_POOL = new Set([
  "Jersey", "Guernsey", "Isle of Man", "Åland", "Aruba", "Curaçao", "Sint Maarten",
  "Macao", "Hong Kong", "N. Cyprus", "Somaliland", "Greenland",
]);
const POOL_TYPES = new Set(["Sovereign country", "Country", "Sovereignty"]);
const EXTRA_POOL = new Set(["Israel", "Kosovo", "Palestine"]);
// Friendlier display names than Natural Earth's abbreviations.
const RENAME = {
  "eSwatini": "Eswatini",
  "Dem. Rep. Congo": "Democratic Republic of the Congo",
  "Congo": "Republic of the Congo",
  "Central African Rep.": "Central African Republic",
  "Dominican Rep.": "Dominican Republic",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Eq. Guinea": "Equatorial Guinea",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "Marshall Is.": "Marshall Islands",
  "Antigua and Barb.": "Antigua and Barbuda",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  "St. Kitts and Nevis": "Saint Kitts and Nevis",
  "United States of America": "United States",
  "W. Sahara": "Western Sahara",
  "Faeroe Is.": "Faroe Islands",
  "Falkland Is.": "Falkland Islands",
  "Cayman Is.": "Cayman Islands",
  "Cook Is.": "Cook Islands",
  "N. Mariana Is.": "Northern Mariana Islands",
  "U.S. Virgin Is.": "U.S. Virgin Islands",
  "British Virgin Is.": "British Virgin Islands",
  "Turks and Caicos Is.": "Turks and Caicos Islands",
  "Fr. Polynesia": "French Polynesia",
  "N. Cyprus": "Northern Cyprus",
  "São Tomé and Principe": "São Tomé and Príncipe",
};
const SKIP = new Set(["Antarctica", "Ashmore and Cartier Is.", "Siachen Glacier", "Indian Ocean Ter.",
  "Br. Indian Ocean Ter.", "Heard I. and McDonald Is.", "Fr. S. Antarctic Lands", "S. Geo. and the Is."]);

const r = (n) => Math.round(n * 100) / 100;
function ring(coords) {
  const out = [];
  for (const [x, y] of coords) {
    const p = [r(x), r(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length < 4) return null; // collapsed by rounding
  const a = out[0], b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}
function polygon(rings) {
  const outer = ring(rings[0]);
  if (!outer) return null;
  return [outer, ...rings.slice(1).map(ring).filter(Boolean)];
}
function geometry(g) {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(polygon).filter(Boolean);
  // Tiny countries (e.g. Vatican) can collapse entirely at 2 decimals; keep the original first ring then.
  if (polys.length === 0) {
    const first = g.type === "Polygon" ? g.coordinates : g.coordinates[0];
    return { type: "Polygon", coordinates: [first[0].map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])] };
  }
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

const features = [];
for (const f of src.features) {
  const p = f.properties;
  if (SKIP.has(p.NAME)) continue;
  const pool = (POOL_TYPES.has(p.TYPE) || EXTRA_POOL.has(p.NAME)) && !NOT_IN_RANDOM_POOL.has(p.NAME);
  let continent = p.CONTINENT;
  if (continent.startsWith("Seven seas")) continent = p.REGION_UN === "Africa" ? "Africa" : "Asia";
  features.push({
    type: "Feature",
    properties: {
      id: p.ADM0_A3,
      name: RENAME[p.NAME] ?? p.NAME,
      continent,
      pool,
      lx: r(p.LABEL_X),
      ly: r(p.LABEL_Y),
    },
    geometry: geometry(f.geometry),
  });
}
features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
const ids = new Set();
for (const f of features) {
  if (ids.has(f.properties.id)) throw new Error("duplicate id " + f.properties.id);
  ids.add(f.properties.id);
}
writeFileSync(
  new URL("../src/shared/countries.json", import.meta.url),
  JSON.stringify({ type: "FeatureCollection", features }),
);
console.log(`wrote ${features.length} countries (${features.filter((f) => f.properties.pool).length} in random pool)`);
