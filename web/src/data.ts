// The only place the site reads data (PLAN: the frontend reaches data through one small
// module, so it never knows whether results come from static files or, later, a server).
// Files follow contract/ and are validated on load: served from /data/, which is
// web/public/data/ in development (`bun run export`) and the deployed export in production.

import {
  Boundaries,
  CityList,
  LocationDetail,
  MANIFEST_PATH,
  Manifest,
  locationPath,
} from "@ripstaurant/contract";

const BASE = "/data/";

/** A data file that couldn't be fetched; `status` is the HTTP status. */
export class DataFileError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path}: HTTP ${status}`);
    this.path = path;
    this.status = status;
  }
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new DataFileError(path, res.status);
  // A static host with single-page-app fallback (Vite, Cloudflare Pages) answers a
  // missing file with index.html and a 200, so anything that isn't JSON is a 404.
  if (!res.headers.get("content-type")?.includes("json"))
    throw new DataFileError(path, 404);
  return res.json();
}

// The manifest is fetched once per page load; everything it points at is content-hashed.
let manifest: Promise<Manifest> | null = null;

function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    const loading = getJson(MANIFEST_PATH).then((m) => Manifest.parse(m));
    // A failed load isn't cached, so the next navigation retries.
    loading.catch(() => (manifest = null));
    manifest = loading;
  }
  return manifest;
}

async function cityEntry(slug: string) {
  const city = (await loadManifest()).cities.find((c) => c.slug === slug);
  if (!city) throw new Error(`no city "${slug}" in the manifest`);
  return city;
}

/** Caches each load for the page's lifetime, so views share one fetch. */
function once<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
) {
  let value = cache.get(key);
  if (!value) {
    value = load();
    value.catch(() => cache.delete(key));
    cache.set(key, value);
  }
  return value;
}

const cities = new Map<string, Promise<CityList>>();
const boundaries = new Map<string, Promise<Boundaries | null>>();

/** A city's closures; loaded once and shared by every view (map, list). */
export function loadCity(slug: string): Promise<CityList> {
  return once(cities, slug, async () =>
    CityList.parse(await getJson((await cityEntry(slug)).list)),
  );
}

/** A city's neighbourhood outlines, or null if the export has none. */
export function loadBoundaries(slug: string): Promise<Boundaries | null> {
  return once(boundaries, slug, async () => {
    const path = (await cityEntry(slug)).boundaries;
    return path ? Boundaries.parse(await getJson(path)) : null;
  });
}

export async function getLocation(
  city: string,
  id: string,
): Promise<LocationDetail> {
  return LocationDetail.parse(await getJson(locationPath(city, id)));
}
