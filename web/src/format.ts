import type { DateRange } from "@ripstaurant/contract";

/** A closure's date range as text: one day, a window, "by" a date, or not announced. */
export function formatRange([from, to]: DateRange): string {
  if (from && to && from !== to) return `${from} – ${to}`;
  if (to) return from ? to : `by ${to}`;
  return from ?? "date not announced";
}
