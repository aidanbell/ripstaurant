// Display labels for the contract's codes, and option lists for filter controls. Typed
// as Record<Code, string>, so a code added to contract/src/codes.ts fails to compile
// here until it has a label.

import {
  BusinessType,
  EventType,
  ReasonCode,
  Status,
} from "@ripstaurant/contract";

export type Option<T extends string> = { value: T; label: string };

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  permanent: "Closed permanently",
  relocated: "Moved",
  rebranded: "Rebranded",
  format_change: "No longer a restaurant here",
  ownership_change: "New owner",
  temporary: "Closed temporarily",
};

export const STATUS_LABELS: Record<Status, string> = {
  announced: "Closing (announced)",
  closed: "Closed",
  reopened: "Reopened",
};

export const REASON_LABELS: Record<ReasonCode, string> = {
  rent_lease: "Rent or lease",
  redevelopment: "Redevelopment",
  health_enforcement: "Health inspection closure",
  owner_retirement: "Owner retired",
  sale: "Sold",
  construction_disruption: "Nearby construction",
  pandemic: "Pandemic",
  financial: "Financial",
  relocation: "Relocation",
  unknown: "Unknown",
};

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  cafe: "Café",
  bakery: "Bakery",
  take_out: "Take-out",
  food_retail: "Food retail",
  brewery: "Brewery",
  market: "Market",
};

function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): Option<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export const EVENT_TYPE_OPTIONS = options(EventType.options, EVENT_TYPE_LABELS);
export const STATUS_OPTIONS = options(Status.options, STATUS_LABELS);

/** Food retail isn't published (pipeline/src/export.ts, UNPUBLISHED_TYPES). */
export const BUSINESS_TYPE_OPTIONS = options(
  BusinessType.options.filter((t) => t !== "food_retail"),
  BUSINESS_TYPE_LABELS,
);

/** A row with no known reason has `rs: []`, never "unknown"; that's the "none" option. */
export const NO_REASON = "none";
export const REASON_OPTIONS: Option<ReasonCode | typeof NO_REASON>[] = [
  ...options(
    ReasonCode.options.filter((r) => r !== "unknown"),
    REASON_LABELS,
  ),
  { value: NO_REASON, label: "No known reason" },
];
