import type { DateRange, Status } from "@ripstaurant/contract";

// ISO dates are calendar days: format them in UTC so no time zone shifts the day.
const DAY = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type Style = "long" | "short";

function date(iso: string, style: Style): string {
  return (style === "long" ? DAY : MONTH).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * When a closure happened, saying what each end of its range means. Most closures are
 * only known to within a window: from the last time the place was seen open to the
 * first record showing it had closed (a licence cancellation, a successor moving in).
 * The window isn't how long it was open.
 *
 *   long:  "Last seen open May 30, 2023 · closed by Apr 7, 2026"
 *   short: "Closed by Apr 2026 · last seen May 2023"
 */
export function describeClosure(
  [from, to]: DateRange,
  status: Status,
  style: Style = "long",
): string {
  if (status === "announced") {
    if (!to) return "Closing, date not announced";
    if (from && from !== to)
      return `Closing between ${date(from, style)} and ${date(to, style)}`;
    return `Closing ${date(to, style)}`;
  }
  if (status === "reopened") {
    const closed = from ?? to;
    return closed ? `Closed ${date(closed, style)}, reopened` : "Reopened";
  }
  if (from && to && from === to) return `Closed ${date(to, style)}`;
  if (from && to) {
    if (style === "short")
      return `Closed by ${date(to, style)} · last seen ${date(from, style)}`;
    return `Last seen open ${date(from, style)} · closed by ${date(to, style)}`;
  }
  if (to) return `Closed by ${date(to, style)}`;
  if (from) return `Last seen open ${date(from, style)}`;
  return "Date unknown";
}

/** When an occupant was seen at an address: "Jan 1987 – May 2023", "Jun 2026 – present". */
export function describeStay(from: string | null, to: string | null): string {
  const start = from ? date(from, "short") : "?";
  return `${start} – ${to ? date(to, "short") : "present"}`;
}

/** "2023-05-30" → "Q2 2023" */
function quarterLabel(iso: string): string {
  return `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(0, 4)}`;
}

/** The date filter, for its pill: "Any time", "Q1 2023 – Q4 2024", "Since Q2 2024", "Up to Q4 2023". */
export function describeClosedBetween(
  from: string | null,
  to: string | null,
): string {
  if (from && to) {
    const [start, end] = [quarterLabel(from), quarterLabel(to)];
    return start === end ? start : `${start} – ${end}`;
  }
  if (from) return `Since ${quarterLabel(from)}`;
  if (to) return `Up to ${quarterLabel(to)}`;
  return "Any time";
}
