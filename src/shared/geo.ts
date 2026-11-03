// Geometry + scoring shared by the Worker (authoritative scoring) and the client (display).

export type Position = [number, number]; // [lng, lat]
export type CountryGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export const EARTH_RADIUS_KM = 6371;
export const MAX_SCORE = 5000;
/** Guesses within this distance of the border count as "inside" (helps tiny countries). */
export const BORDER_TOLERANCE_KM = 25;
/** Score halves roughly every ~1,400 km beyond the border. */
export const SCORE_SCALE_KM = 2000;

const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Wrap a longitude so it is within ±180° of `ref` (handles the antimeridian). */
function wrapLng(lng: number, ref: number): number {
  let d = lng - ref;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return ref + d;
}

function polygons(g: CountryGeometry): Position[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

function inRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = wrapLng(ring[i][0], x), yi = ring[i][1];
    const xj = wrapLng(ring[j][0], x), yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInCountry(p: Position, g: CountryGeometry): boolean {
  for (const poly of polygons(g)) {
    if (!inRing(p, poly[0])) continue;
    if (poly.slice(1).some((hole) => inRing(p, hole))) continue;
    return true;
  }
  return false;
}

/**
 * Closest point on the country's border to `p`, and its distance in km.
 * Each edge is projected in a local equirectangular frame centred on `p`, which is accurate
 * enough for scoring and stays correct across the antimeridian.
 */
export function nearestBorderPoint(p: Position, g: CountryGeometry): { point: Position; km: number } {
  const cosLat = Math.cos(toRad(p[1]));
  let best: { point: Position; km: number } = { point: p, km: Infinity };
  for (const poly of polygons(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = (wrapLng(ring[i][0], p[0]) - p[0]) * cosLat, ay = ring[i][1] - p[1];
        const bx = (wrapLng(ring[i + 1][0], p[0]) - p[0]) * cosLat, by = ring[i + 1][1] - p[1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        // quick reject using planar distance (degrees) before the exact haversine
        const planar = Math.sqrt(cx * cx + cy * cy) * 111.2;
        if (planar > best.km * 1.5 + 50) continue;
        const cand: Position = [p[0] + cx / (cosLat || 1e-9), p[1] + cy];
        const km = haversineKm(p, cand);
        if (km < best.km) best = { point: [wrapLng(cand[0], 0), cand[1]], km };
      }
    }
  }
  return best;
}

export interface ScoredGuess {
  /** km from the country border (0 when inside or within tolerance) */
  km: number;
  score: number;
  inside: boolean;
  /** nearest point of the country to the guess, for drawing a line on reveal */
  nearest: Position;
}

export function scoreGuess(p: Position, g: CountryGeometry): ScoredGuess {
  if (pointInCountry(p, g)) return { km: 0, score: MAX_SCORE, inside: true, nearest: p };
  const { point, km } = nearestBorderPoint(p, g);
  if (km <= BORDER_TOLERANCE_KM) return { km: 0, score: MAX_SCORE, inside: true, nearest: point };
  const score = Math.round(MAX_SCORE * Math.exp(-(km - BORDER_TOLERANCE_KM) / SCORE_SCALE_KM));
  return { km: Math.round(km), score, inside: false, nearest: point };
}

export function bbox(g: CountryGeometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons(g))
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  return [minX, minY, maxX, maxY];
}
