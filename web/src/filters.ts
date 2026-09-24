// Filters for the city list, shared by /map and /list so they always show the same rows.
// The URL's search params are the only filter state: read them with parseFilters(),
// derive the rows with applyFilters(), write them with <Form method="get"> or
// setSearchParams. Repeated params are multi-select: ?type=permanent&type=relocated.
//
//   const rows = useMemo(() => applyFilters(list, parseFilters(params)), [list, params]);
//
// Pure and synchronous, so it can move into a Web Worker (or behind a server) without
// the pages changing.

import {
  BusinessType,
  DEFAULT_VISIBLE_TYPES,
  EventType,
  ReasonCode,
  Status,
  sortDate,
} from "@ripstaurant/contract";
import type { CityList, ClosureRow } from "@ripstaurant/contract";
import { NO_REASON } from "./labels";

export type Filters = {
  /** Name or address contains this (case- and accent-insensitive). */
  q: string;
  /** Event types to show; the contract's defaults when the URL names none. */
  types: EventType[];
  /** Empty = any. */
  statuses: Status[];
  businessTypes: BusinessType[];
  /** Reason codes, or NO_REASON for rows with no known reason. Empty = any. */
  reasons: (ReasonCode | typeof NO_REASON)[];
  /** Neighbourhood by name, so shared links survive a re-export. */
  hood: string | null;
  /** ISO dates, compared with the row's sortDate (the latest known end of its range). */
  from: string | null;
  to: string | null;
};

/** The URL param each filter reads. */
export const PARAM = {
  q: "q",
  types: "type",
  statuses: "status",
  businessTypes: "bt",
  reasons: "reason",
  hood: "hood",
  from: "from",
  to: "to",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Values from the URL that are one of the allowed codes; anything else is dropped. */
function oneOf<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T =>
    (allowed as readonly string[]).includes(v),
  );
}

function date(value: string | null): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

/** The URL is user input: unknown values are ignored rather than trusted. */
export function parseFilters(params: URLSearchParams): Filters {
  const types = oneOf(params.getAll(PARAM.types), EventType.options);
  return {
    q: (params.get(PARAM.q) ?? "").trim(),
    types: types.length ? types : [...DEFAULT_VISIBLE_TYPES],
    statuses: oneOf(params.getAll(PARAM.statuses), Status.options),
    businessTypes: oneOf(
      params.getAll(PARAM.businessTypes),
      BusinessType.options,
    ),
    reasons: oneOf(params.getAll(PARAM.reasons), [
      ...ReasonCode.options,
      NO_REASON,
    ]),
    hood: params.get(PARAM.hood) || null,
    from: date(params.get(PARAM.from)),
    to: date(params.get(PARAM.to)),
  };
}

/** "Café Crème" → "cafe creme" */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesReason(row: ClosureRow, reasons: Filters["reasons"]): boolean {
  if (!reasons.length) return true;
  if (!row.rs.length) return reasons.includes(NO_REASON);
  return row.rs.some((r) => reasons.includes(r));
}

function matchesDate(row: ClosureRow, from: string | null, to: string | null) {
  if (!from && !to) return true;
  // An announced closure with no date yet can't be placed in a date range.
  const date = sortDate(row.d);
  if (date === null) return false;
  return (!from || date >= from) && (!to || date <= to);
}

/** The rows that pass every filter, in the list's order (newest first). */
export function applyFilters(list: CityList, filters: Filters): ClosureRow[] {
  const hood = filters.hood === null ? -1 : list.hoods.indexOf(filters.hood);
  // An unknown neighbourhood name matches nothing, rather than silently everything.
  if (filters.hood !== null && hood === -1) return [];
  const q = fold(filters.q);

  return list.closures.filter(
    (row) =>
      filters.types.includes(row.type) &&
      (!filters.statuses.length || filters.statuses.includes(row.status)) &&
      (!filters.businessTypes.length ||
        filters.businessTypes.includes(row.bt)) &&
      (hood === -1 || row.hood === hood) &&
      matchesReason(row, filters.reasons) &&
      matchesDate(row, filters.from, filters.to) &&
      (!q || fold(`${row.name} ${row.addr}`).includes(q)),
  );
}
