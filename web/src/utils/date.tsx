import type { DateRange } from "@ripstaurant/contract";
import { format, isSameMonth, parseISO } from "date-fns";

const DAY = "MMM d, yyyy";
const MONTH = "MMM yyyy";

function formatWindow(from: string, to: string): string {
  const start = parseISO(from);
  const end = parseISO(to);
  const pattern = isSameMonth(start, end) ? DAY : MONTH;
  return `${format(start, pattern)} and ${format(end, pattern)}`;
}

export type DisplayDate = {
  /** Leading word. Empty for an exact day. The whole phrase when nothing is announced. */
  verb: string;
  /** Date or range to emphasize. Empty when no date was announced. */
  date: string;
};

/**
 * Given a closure date range, return the leading word and the date separately
 * so the date can be styled on its own: `{verb} <span className="font-bold">{date}</span>`.
 *
 * | `dateRange`                             | verb        | date                              |
 * | --------------------------------------- | ----------- | --------------------------------- |
 * | `["2025-04-27", "2025-04-27"]`          |             | Apr 27, 2025                      |
 * | `["2024-01-01", "2024-01-16"]`          | between     | Jan 1, 2024 and Jan 16, 2024      |
 * | `["2023-09-14", "2025-07-09"]`          | between     | Sep 2023 and Jul 2025             |
 * | `[null, "2022-09-08"]`                  | by          | Sep 8, 2022                       |
 * | `[null, null]` (announced only)         | closing soon, date not announced |        |
 */
export function displayDateFromRange([from, to]: DateRange): DisplayDate {
  if (from === null) {
    if (to === null)
      return { verb: "closing soon, date not announced", date: "" };
    return { verb: "by", date: format(parseISO(to), DAY) };
  }
  if (to === null || from === to) {
    return { verb: "", date: format(parseISO(from), DAY) };
  }
  return { verb: "between", date: formatWindow(from, to) };
}
