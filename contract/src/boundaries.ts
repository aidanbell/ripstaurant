// Neighbourhood boundaries: `{city}/neighbourhoods.{hash}.json`, a GeoJSON
// FeatureCollection (plus the contract version). Loaded with the map, to outline a
// selected neighbourhood. Simplified to ~5 m and rounded to 5 decimals (~1 m).

import { z } from "zod";
import { LngLat, Version } from "./common";

/** A closed ring: at least four positions, the first repeated last. */
const Ring = z.array(LngLat).min(4);

export const Boundary = z.object({
  type: z.literal("Feature"),
  /** Matches an entry in the city list's `hoods`. */
  properties: z.object({ name: z.string() }),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: z.array(Ring).min(1) }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(Ring).min(1)).min(1),
    }),
  ]),
});
export type Boundary = z.infer<typeof Boundary>;

export const Boundaries = z.object({
  v: Version,
  type: z.literal("FeatureCollection"),
  features: z.array(Boundary).min(1),
});
export type Boundaries = z.infer<typeof Boundaries>;

/** `toronto/neighbourhoods.3f9a1c2b.json` */
export function boundariesPath(city: string, hash: string): string {
  return `${city}/neighbourhoods.${hash}.json`;
}
