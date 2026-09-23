// `manifest.json` at the root of the exported site data. The one file that isn't
// content-hashed: it's fetched fresh and points at the current list file for each city.

import { z } from "zod";
import { CitySlug, Version } from "./common";

export const Manifest = z.object({
  v: Version,
  generated: z.iso.datetime(),
  cities: z
    .array(
      z.object({
        slug: CitySlug,
        name: z.string(),
        /** Path to the city's list file, relative to the manifest. Content-hashed, so cache forever. */
        list: z.string(),
        count: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type Manifest = z.infer<typeof Manifest>;

export const MANIFEST_PATH = "manifest.json";

/** `toronto/closures.3f9a1c2b.json` */
export function listPath(city: string, hash: string): string {
  return `${city}/closures.${hash}.json`;
}

/** `toronto/locations/tor-2120-queen-st-e.json` */
export function locationPath(city: string, locationId: string): string {
  return `${city}/locations/${locationId}.json`;
}
