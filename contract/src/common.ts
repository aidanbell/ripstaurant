import { z } from "zod";

/** Bumped on any breaking change to the export files. */
export const CONTRACT_VERSION = 1;
export const Version = z.literal(CONTRACT_VERSION);

/** `YYYY-MM-DD`. ISO dates sort correctly as strings. */
export const IsoDate = z.iso.date();

/** A lowercase URL-safe city identifier, e.g. `toronto`. */
export const CitySlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * `[longitude, latitude]`, GeoJSON order, rounded to 5 decimals (~1 m).
 * Longitude first is easy to get backwards; MapLibre expects this order.
 */
export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof LngLat>;

/** `[west, south, east, north]` */
export const BBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBox>;

/**
 * When an event happened, as a range: `[earliest, latest]`.
 *
 * - Exact date: both ends equal (`["2025-04-27", "2025-04-27"]`).
 * - Known window: e.g. between the last inspection and the licence cancellation.
 * - Unknown start: `[null, "2022-09-08"]` = "by Sep 8, 2022".
 * - Announced with no date yet: `[null, null]`.
 *
 * Sort by the latest end, falling back to the earliest.
 */
export const DateRange = z
  .tuple([IsoDate.nullable(), IsoDate.nullable()])
  .refine(([from, to]) => from === null || to === null || from <= to, "range start is after its end");
export type DateRange = z.infer<typeof DateRange>;

/** The date a range sorts by: its latest known end. */
export function sortDate([from, to]: DateRange): string | null {
  return to ?? from;
}

export function inBBox([lng, lat]: LngLat, [w, s, e, n]: BBox): boolean {
  return lng >= w && lng <= e && lat >= s && lat <= n;
}
