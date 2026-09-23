import { z } from "zod";

// Mirrors the closure types and reason codes in PLAN.md, plus `reopened` so
// articles about a comeback can close out an earlier closure event.
// `format_change`: the business carries on but stops operating as a
// restaurant at this location (delivery-only, wholesale-only).
export const EventType = z.enum([
  "permanent",
  "temporary",
  "relocated",
  "rebranded",
  "ownership_change",
  "format_change",
  "reopened",
]);

export const ReasonCode = z.enum([
  "rent_lease",
  "redevelopment",
  "health_enforcement",
  "owner_retirement",
  "sale",
  "construction_disruption",
  "pandemic",
  "financial",
  "relocation",
  "unknown",
]);

export const BusinessType = z.enum([
  "restaurant",
  "bar",
  "cafe",
  "bakery",
  "take_out",
  "food_retail",
  "brewery",
  "market",
  "non_food",
]);

export const Closure = z.object({
  name: z.string().describe("Business name as it would appear on a sign"),
  chain: z.boolean().describe("True if this is one location of a multi-location brand"),
  business_type: BusinessType,
  address: z.string().nullable().describe("Street address if given, e.g. '382 College St'"),
  street_or_area: z
    .string()
    .nullable()
    .describe("Street, intersection or neighbourhood when no full address is given"),
  event_type: EventType,
  status: z
    .enum(["announced", "closed", "reopened", "retracted"])
    .describe("retracted: the article (e.g. an editor's note) says the closure is no longer happening"),
  event_date: z.string().nullable().describe("ISO date (YYYY-MM-DD, YYYY-MM or YYYY) of the closing/last day"),
  event_date_precision: z.enum(["day", "month", "year", "unknown"]),
  years_in_business: z.number().nullable(),
  stated_reasons: z.array(
    z.object({
      code: ReasonCode,
      attributed_to: z.enum(["owner", "landlord", "official", "journalist", "unknown"]),
      summary: z.string().describe("Your own paraphrase in 20 words or fewer; do not quote the article"),
    }),
  ),
  successor: z.string().nullable().describe("What replaces it at the same location, if mentioned"),
  relocated_to: z.string().nullable().describe("New address/area if the business moved"),
  primary_source: z
    .enum(["instagram", "facebook", "x", "tiktok", "website", "press_release", "city_record", "none"])
    .describe("Where the owner/official originally announced it, per the article"),
});

export const Extraction = z.object({
  relevant: z
    .boolean()
    .describe("False if the article reports no closure/reopening of a Toronto food or drink business"),
  closures: z.array(Closure),
});

export type Extraction = z.infer<typeof Extraction>;
