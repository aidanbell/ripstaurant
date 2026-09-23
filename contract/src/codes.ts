// Shared vocabularies. These mirror PLAN.md ("What counts as a closure", "Reasons");
// change them there first.

import { z } from "zod";

/** What happened to the establishment at this location. */
export const EventType = z.enum([
  "permanent", // stopped operating for good here
  "relocated", // same establishment moved to a new address
  "rebranded", // same operation continued under a new name
  "format_change", // business continues but no longer operates as a restaurant here
  "ownership_change", // new owner, same name
  "temporary", // renovation, health closure, seasonal; reopened or expected to
]);
export type EventType = z.infer<typeof EventType>;

/** Event types the site shows by default; the rest sit behind a filter toggle. */
export const DEFAULT_VISIBLE_TYPES: readonly EventType[] = [
  "permanent",
  "relocated",
  "rebranded",
  "format_change",
];

/**
 * Where the event stands. `retracted` exists in the database but is never exported,
 * so it isn't part of the contract.
 */
export const Status = z.enum([
  "announced", // closing in the future (usually from news)
  "closed",
  "reopened", // a temporary closure that ended
]);
export type Status = z.infer<typeof Status>;

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
export type ReasonCode = z.infer<typeof ReasonCode>;

/** stated: someone said so. documented: a public record shows it. signal: a nearby fact, not a claim. */
export const ReasonKind = z.enum(["stated", "documented", "signal"]);
export type ReasonKind = z.infer<typeof ReasonKind>;

/** Food and drink business types. Non-food businesses are filtered out before export. */
export const BusinessType = z.enum([
  "restaurant",
  "bar",
  "cafe",
  "bakery",
  "take_out",
  "food_retail",
  "brewery",
  "market",
]);
export type BusinessType = z.infer<typeof BusinessType>;

export const SourceKind = z.enum([
  "dataset", // a bulk open dataset (DineSafe, business licences, permits)
  "news_article",
  "social_post",
  "business_website",
  "press_release",
  "other",
]);
export type SourceKind = z.infer<typeof SourceKind>;

/** What a piece of evidence supports. */
export const Claim = z.enum([
  "closed",
  "announced",
  "reopened",
  "relocated",
  "rebranded",
  "successor",
  "reason",
]);
export type Claim = z.infer<typeof Claim>;
