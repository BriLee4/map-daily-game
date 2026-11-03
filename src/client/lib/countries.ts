import type { CountryGeometry } from "../../shared/geo";

export interface CountryFeature {
  type: "Feature";
  properties: { id: string; name: string; continent: string; pool: boolean; lx: number; ly: number };
  geometry: CountryGeometry;
}
export interface CountryCollection {
  type: "FeatureCollection";
  features: CountryFeature[];
}

let data: CountryCollection | null = null;
let byId = new Map<string, CountryFeature>();
let pending: Promise<CountryCollection> | null = null;

/** Lazy-loads the country shapes (one shared ~400 KB gzip chunk). */
export function loadCountries(): Promise<CountryCollection> {
  pending ??= import("../../shared/countries.json").then((m) => {
    data = (m.default ?? m) as unknown as CountryCollection;
    byId = new Map(data.features.map((f) => [f.properties.id, f]));
    return data;
  });
  return pending;
}

export function getCountry(id: string): CountryFeature | undefined {
  return byId.get(id);
}

export function allCountries(): CountryFeature[] {
  return data?.features ?? [];
}
