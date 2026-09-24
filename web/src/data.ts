// The only place the site reads data (PLAN: the frontend reaches data through one small
// module, so it never knows whether results come from static files or, later, a server).
// Files follow contract/ and are validated on load: served from /data/, which is
// web/public/data/ in development (`bun run export`) and the deployed export in production.

import {
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

/** The manifest points at each city's current (content-hashed) list file. */
async function fetchCity(slug: string): Promise<CityList> {
  const manifest = Manifest.parse(await getJson(MANIFEST_PATH));
  const city = manifest.cities.find((c) => c.slug === slug);
  if (!city) throw new Error(`no city "${slug}" in the manifest`);
  return CityList.parse(await getJson(city.list));
}

// A city's list is loaded once per page load and shared by every view (map, list).
const cities = new Map<string, Promise<CityList>>();

export function loadCity(slug: string): Promise<CityList> {
  let city = cities.get(slug);
  if (!city) {
    city = fetchCity(slug);
    // A failed load isn't cached, so the next navigation retries.
    city.catch(() => cities.delete(slug));
    cities.set(slug, city);
  }
  return city;
}

export async function getLocation(
  city: string,
  id: string,
): Promise<LocationDetail> {
  return LocationDetail.parse(await getJson(locationPath(city, id)));
}
