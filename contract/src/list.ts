// City list file: `{city}/closures.{hash}.json`. Loaded once; drives the map, the list,
// filters and search. Kept compact: one small row per closure event.

import { z } from "zod";
import { BusinessType, EventType, ReasonCode, Status } from "./codes";
import {
  BBox,
  CitySlug,
  DateRange,
  IsoDate,
  LngLat,
  Version,
  inBBox,
  sortDate,
} from "./common";

export const City = z.object({
  slug: CitySlug,
  name: z.string(),
  center: LngLat,
  bbox: BBox,
});
export type City = z.infer<typeof City>;

export const ClosureRow = z.object({
  /** Event id; stable across exports. */
  id: z.string(),
  /** Location id: fetch `{city}/locations/{loc}.json` for details. Several rows can share one. */
  loc: z.string(),
  name: z.string(),
  /** Display address, e.g. "769 Dundas St W". */
  addr: z.string(),
  /** Index into `CityList.hoods`. */
  hood: z.number().int().nonnegative(),
  ll: LngLat,
  type: EventType,
  status: Status,
  d: DateRange,
  bt: BusinessType,
  /** Stated or documented reason codes, most significant first. Empty = none known. */
  rs: z.array(ReasonCode),
  /** Years in business as reported by sources (may include earlier locations). */
  yrs: z.number().int().positive().optional(),
  chain: z.literal(true).optional(),
  /** Name of what replaced it, or where it moved. */
  next: z.string().optional(),
});
export type ClosureRow = z.infer<typeof ClosureRow>;

export const CityList = z
  .object({
    v: Version,
    city: City,
    /** When this export was generated (ISO datetime). */
    generated: z.iso.datetime(),
    /** Start of the coverage window. */
    since: IsoDate,
    /** Neighbourhood names; rows reference them by index. */
    hoods: z.array(z.string()).min(1),
    closures: z.array(ClosureRow),
  })
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.closures.forEach((row, i) => {
      const at = (msg: string) =>
        ctx.addIssue({ code: "custom", path: ["closures", i], message: msg });
      if (ids.has(row.id)) at(`duplicate id ${row.id}`);
      ids.add(row.id);
      if (row.hood >= list.hoods.length)
        at(`hood index ${row.hood} out of range`);
      if (!inBBox(row.ll, list.city.bbox))
        at(`${row.name} is outside the city bbox`);
      if (row.status !== "announced" && row.d[0] === null && row.d[1] === null)
        at(`${row.name}: a ${row.status} event needs at least one date`);
      const date = sortDate(row.d);
      if (date !== null && date < list.since)
        at(
          `${row.name} (${date}) is before the coverage window (${list.since})`,
        );
    });
  });
export type CityList = z.infer<typeof CityList>;
