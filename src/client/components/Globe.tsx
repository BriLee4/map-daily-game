import type * as GeoJSON from "geojson";
import { Map as MLMap, NavigationControl, setWorkerUrl, type FilterSpecification, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 finds its web worker relative to its own module URL, which breaks once Vite
// pre-bundles / fingerprints it. The worker is self-contained, so hand Vite the file directly.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import { bbox, haversineKm, type Position } from "../../shared/geo";
import { getCountry, loadCountries, type CountryCollection } from "../lib/countries";

export interface GlobeResultLine {
  guess: Position;
  nearest?: Position;
  score: number;
  mine?: boolean;
}

export interface GlobeProps {
  /** student can click to place a pin */
  onPick?: (p: Position) => void;
  pin?: Position | null;
  /** anonymous guess points for the heat map */
  heat?: Position[] | null;
  /** highlight this country (answer) */
  answerId?: string | null;
  /** dots (+ optional lines to the border) shown on reveal */
  results?: GlobeResultLine[];
  /** points the camera should frame (the answer country is added automatically) */
  focus?: Position[] | null;
  /** when this changes, return to the neutral world view (e.g. new round) */
  resetKey?: string | number;
  className?: string;
}

setWorkerUrl(workerUrl);

const DEFAULT_CENTER: Position = [10, 20];
const DEFAULT_ZOOM = 1.4;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function baseStyle(countries: CountryCollection): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: {
      "sky-color": cssVar("--sky", "#0b1530"),
      "horizon-color": cssVar("--horizon", "#3b6fb6"),
      "fog-color": cssVar("--horizon", "#3b6fb6"),
      "fog-ground-blend": 0.5,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    },
    sources: {
      countries: { type: "geojson", data: countries as unknown as GeoJSON.FeatureCollection },
      heat: { type: "geojson", data: EMPTY },
      pin: { type: "geojson", data: EMPTY },
      results: { type: "geojson", data: EMPTY },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": cssVar("--ocean", "#1d4e89") } },
      { id: "land", type: "fill", source: "countries", paint: { "fill-color": cssVar("--land", "#e9e4d4") } },
      {
        id: "answer-fill",
        type: "fill",
        source: "countries",
        filter: ["==", ["get", "id"], ""],
        paint: { "fill-color": cssVar("--answer", "#22c55e"), "fill-opacity": 0.85 },
      },
      { id: "borders", type: "line", source: "countries", paint: { "line-color": cssVar("--border", "#9a917a"), "line-width": 0.6 } },
      {
        id: "answer-outline",
        type: "line",
        source: "countries",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": cssVar("--answer-line", "#14532d"), "line-width": 2 },
      },
      {
        // halo so tiny answer countries (Vatican, Nauru…) are still visible when zoomed out
        id: "answer-halo",
        type: "circle",
        source: "results",
        filter: ["==", ["get", "kind"], "answer"],
        paint: {
          "circle-radius": 14,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": cssVar("--answer", "#22c55e"),
          "circle-stroke-width": 3,
        },
      },
      {
        id: "heat",
        type: "heatmap",
        source: "heat",
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 2, 6, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 30, 4, 45, 8, 70],
          "heatmap-opacity": 0.85,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.15, "#4c1d95",
            0.35, "#c026d3",
            0.6, "#f97316",
            0.85, "#facc15",
            1, "#fffbeb",
          ],
        },
      },
      {
        id: "heat-points",
        type: "circle",
        source: "heat",
        paint: {
          "circle-radius": 3,
          "circle-color": "#fff",
          "circle-stroke-color": "#111",
          "circle-stroke-width": 1,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.3, 4, 1],
        },
      },
      {
        id: "result-lines",
        type: "line",
        source: "results",
        filter: ["==", ["get", "kind"], "line"],
        paint: {
          "line-color": ["case", ["get", "mine"], cssVar("--accent", "#2563eb"), "rgba(20,20,20,0.45)"],
          "line-width": ["case", ["get", "mine"], 3, 1.2],
          "line-dasharray": [2, 1],
        },
      },
      {
        id: "result-dots",
        type: "circle",
        source: "results",
        filter: ["==", ["get", "kind"], "guess"],
        paint: {
          "circle-radius": ["case", ["get", "mine"], 8, 5],
          "circle-color": [
            "interpolate", ["linear"], ["get", "score"],
            0, "#dc2626", 1500, "#f97316", 3500, "#facc15", 4999, "#84cc16", 5000, "#16a34a",
          ],
          "circle-stroke-color": ["case", ["get", "mine"], cssVar("--accent", "#2563eb"), "#111"],
          "circle-stroke-width": ["case", ["get", "mine"], 3, 1],
        },
      },
      {
        id: "pin",
        type: "circle",
        source: "pin",
        paint: {
          "circle-radius": 9,
          "circle-color": cssVar("--accent", "#2563eb"),
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      },
    ],
  };
}

export function Globe({ onPick, pin, heat, answerId, results, focus, resetKey, className }: GlobeProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    let disposed = false;
    let map: MLMap | null = null;
    loadCountries().then((countries) => {
      if (disposed || !el.current) return;
      const m = new MLMap({
        container: el.current,
        style: baseStyle(countries),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 0.8,
        maxZoom: 9,
        attributionControl: { compact: true, customAttribution: "Borders: Natural Earth" },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      m.on("click", (e) => {
        // Ignore taps in space around the globe: off-surface points unproject to the horizon,
        // so they don't round-trip back to the pixel that was tapped.
        const back = m.project(e.lngLat);
        if (Math.hypot(back.x - e.point.x, back.y - e.point.y) > 4) return;
        pickRef.current?.([e.lngLat.wrap().lng, e.lngLat.lat]);
      });
      if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = m;
      m.on("load", () => !disposed && setReady(true));
      map = m;
      mapRef.current = m;
    });
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    if (el.current) ro.observe(el.current);
    return () => {
      disposed = true;
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getCanvas().style.cursor = onPick ? "crosshair" : "";
  }, [ready, onPick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("pin") as GeoJSONSource).setData(
      pin ? { type: "FeatureCollection", features: [point(pin, {})] } : EMPTY,
    );
  }, [ready, pin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("heat") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (heat ?? []).map((p) => point(p, {})),
    });
  }, [ready, heat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const filter: FilterSpecification = ["==", ["get", "id"], answerId ?? ""];
    map.setFilter("answer-fill", filter);
    map.setFilter("answer-outline", filter);
    const features: GeoJSON.Feature[] = [];
    const country = answerId ? getCountry(answerId) : undefined;
    if (country) features.push(point([country.properties.lx, country.properties.ly], { kind: "answer" }));
    for (const r of results ?? []) {
      if (r.nearest && (r.nearest[0] !== r.guess[0] || r.nearest[1] !== r.guess[1]))
        features.push({
          type: "Feature",
          properties: { kind: "line", mine: !!r.mine },
          geometry: { type: "LineString", coordinates: [r.guess, r.nearest] },
        });
      features.push(point(r.guess, { kind: "guess", score: r.score, mine: !!r.mine }));
    }
    (map.getSource("results") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [ready, answerId, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || resetKey === undefined) return;
    map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 1200 });
  }, [ready, resetKey]);

  // Camera: frame the guesses (and the answer, once revealed) so the class sees everything at once.
  const focusKey = JSON.stringify([focus ?? [], answerId ?? null]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts: Position[] = [...(focus ?? [])];
    const c = answerId ? getCountry(answerId) : undefined;
    if (c) {
      const [w, s, e, n] = bbox(c.geometry);
      if (e - w > 180) pts.push([c.properties.lx, c.properties.ly]);
      else pts.push([w, s], [e, n]);
    }
    if (pts.length === 0) return;
    frame(map, pts);
  }, [ready, focusKey]);

  return <div ref={el} className={`globe ${className ?? ""}`} />;
}

function frame(map: MLMap, pts: Position[]) {
  // fitBounds is unreliable on the globe projection, so centre on the spherical midpoint of the
  // points and choose a zoom from the farthest point's distance to it.
  const r = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of pts) {
    x += Math.cos(lat * r) * Math.cos(lng * r);
    y += Math.cos(lat * r) * Math.sin(lng * r);
    z += Math.sin(lat * r);
  }
  const hyp = Math.hypot(x, y);
  const center: Position = hyp < 1e-9 && Math.abs(z) < 1e-9 ? pts[0] : [Math.atan2(y, x) / r, Math.atan2(z, hyp) / r];
  const farKm = Math.max(300, ...pts.map((p) => haversineKm(center, p)));
  const h = map.getCanvas().clientHeight || 600;
  const w = map.getCanvas().clientWidth || 800;
  // empirically ~10,000 km from centre to edge is visible at zoom 1.2 in a 600px-tall view
  const zoom = 1.2 + Math.log2((10_000 * (Math.min(w, h) / 600)) / (farKm * 1.3));
  map.flyTo({ center, zoom: Math.max(0.9, Math.min(4.5, zoom)), duration: 1600 });
}

function point(p: Position, properties: Record<string, unknown>): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates: p } };
}
