// Per-location detail file: `{city}/locations/{id}.json`. Fetched when someone opens
// a location. Holds the address's full history and every source behind it.

import { z } from "zod";
import {
  BusinessType,
  Claim,
  EventType,
  ReasonCode,
  ReasonKind,
  SourceKind,
  Status,
} from "./codes";
import { CitySlug, DateRange, IsoDate, LngLat, Version } from "./common";

/** Index into `LocationDetail.sources`. */
const SourceRef = z.number().int().nonnegative();

export const Source = z.object({
  kind: SourceKind,
  title: z.string(),
  publisher: z.string(),
  url: z.url(),
  /** Publication date for articles/posts; retrieval date for datasets. */
  date: IsoDate.optional(),
  /** Wayback Machine copy, so the citation survives link rot. */
  archived: z.url().optional(),
});
export type Source = z.infer<typeof Source>;

export const Reason = z.object({
  code: ReasonCode,
  kind: ReasonKind,
  /** Our own short paraphrase; never quoted text. */
  summary: z.string().max(160).optional(),
  src: z.array(SourceRef).min(1),
});
export type Reason = z.infer<typeof Reason>;

/** What came after: the successor at this address, or where the business moved. */
export const Next = z.object({
  name: z.string(),
  /** Location id, when the target has its own detail file (relocations). */
  loc: z.string().optional(),
  addr: z.string().optional(),
});
export type Next = z.infer<typeof Next>;

export const ClosureEvent = z.object({
  /** Matches the list row's `id`. */
  id: z.string(),
  type: EventType,
  status: Status,
  d: DateRange,
  reasons: z.array(Reason),
  next: Next.optional(),
  evidence: z.array(z.object({ claim: Claim, src: SourceRef })).min(1),
});
export type ClosureEvent = z.infer<typeof ClosureEvent>;

/** One business's time at this address. */
export const Occupant = z.object({
  name: z.string(),
  bt: BusinessType.optional(),
  /**
   * When this occupant was here, from the records (licence issued, first inspection) or,
   * for an occupant with an event, until the event's latest date. `to: null` = still here.
   */
  from: IsoDate.nullable(),
  to: IsoDate.nullable(),
  /** Years in business as reported by sources (may include earlier locations). */
  yrs: z.number().int().positive().optional(),
  chain: z.boolean().optional(),
  /** Present when this occupancy ended in (or is announced to end in) an exported event. */
  event: ClosureEvent.optional(),
  /** Sources showing this occupant existed. */
  src: z.array(SourceRef),
});
export type Occupant = z.infer<typeof Occupant>;

export const LocationDetail = z
  .object({
    v: Version,
    id: z.string(),
    city: CitySlug,
    addr: z.string(),
    ll: LngLat,
    hood: z.string(),
    /** Oldest first. Occupants before our 2022-03-01 window appear for context, without events. */
    occupants: z.array(Occupant).min(1),
    sources: z.array(Source),
  })
  .superRefine((loc, ctx) => {
    const n = loc.sources.length;
    const refs = loc.occupants.flatMap((o) => [
      ...o.src,
      ...(o.event?.evidence.map((e) => e.src) ?? []),
      ...(o.event?.reasons.flatMap((r) => r.src) ?? []),
    ]);
    for (const r of refs) {
      if (r >= n)
        ctx.addIssue({
          code: "custom",
          message: `source ref ${r} out of range (${n} sources)`,
        });
    }
  });
export type LocationDetail = z.infer<typeof LocationDetail>;
