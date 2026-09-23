// Builds list rows from detail files, so the two can never disagree. The pipeline's
// export and the sample builder both go through here.

import type { ClosureRow } from "./list";
import type { LocationDetail } from "./detail";
import type { ReasonCode } from "./codes";

const KIND_ORDER = { stated: 0, documented: 1, signal: 2 } as const;

/** One row per occupant event at this location. */
export function rowsFromLocation(loc: LocationDetail, hoods: readonly string[]): ClosureRow[] {
  const hood = hoods.indexOf(loc.hood);
  if (hood === -1) throw new Error(`${loc.id}: unknown neighbourhood "${loc.hood}"`);

  return loc.occupants.flatMap((o) => {
    const e = o.event;
    if (!e) return [];
    if (!o.bt) throw new Error(`${loc.id}: ${o.name} has an event but no business type`);

    // Signals are context, not reasons, so they stay out of the list's reason filter.
    // `unknown` is dropped too: an empty list already means "no reason known".
    const rs = [...new Set(
      e.reasons
        .filter((r) => r.kind !== "signal" && r.code !== "unknown")
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
        .map((r) => r.code),
    )] as ReasonCode[];

    const row: ClosureRow = {
      id: e.id,
      loc: loc.id,
      name: o.name,
      addr: loc.addr,
      hood,
      ll: loc.ll,
      type: e.type,
      status: e.status,
      d: e.d,
      bt: o.bt,
      rs,
    };
    if (o.yrs) row.yrs = o.yrs;
    if (o.chain) row.chain = true;
    if (e.next) row.next = e.next.name;
    return [row];
  });
}

/** `"Rose and Sons"` → `"rose-and-sons"`; used for readable, stable ids. */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Event ids are the location id plus the occupant's name: `tor-176-dupont-st~big-crow`. */
export function eventId(locationId: string, occupantName: string): string {
  return `${locationId}~${slugify(occupantName)}`;
}

/** Round to 5 decimals (~1 m); keeps list files small. */
export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
