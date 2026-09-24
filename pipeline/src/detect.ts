// Closure detection (Phase 4): turns resolved establishments and their linked records
// into closure events, with evidence, documented reasons and establishment links.
//
//   bun run detect
//
// Rebuilt on every run, like resolve, and written in place: events by (occupancy, key),
// evidence by (event, record, claim). Only this job's own rows are touched; evidence from
// documented sources (news, Phase 5) and reviewed rows are left alone.
//
// Each occupancy that looks over is scored from independent signals, combined as
// 1 - Π(1 - weight), and damped if the establishment still holds an active licence:
//
//   stopped      no inspection for 18+ months (open places: p95 gap 434 days, p99 710)
//   licence      every licence cancelled, around or after the last inspection
//   successor    another business first seen at the same place afterwards
//   conversion   a permit changing the space from food use to something else
//   demolition   a demolition permit at the address
//   health       a health closure order at or near the last inspection
//
// The closure date is a range: from the last sighting to the earliest bound any signal
// gives (licence cancellation, a successor's first inspection).
//
// Also detected: temporary closures (a closure order, then a passing inspection),
// ownership changes (a cancelled licence followed by a new owner's under the same name),
// relocations (the same business at a new address) and rebrands (a successor licensed to
// the same owner).

import type { TransactionSQL } from "bun";
import { sql } from "@ripstaurant/db";
import type { Row } from "./datasets";
import { count, runJob } from "./job";
import { chainKey, nameKey } from "./names";
import {
  devApplicationFromRow,
  inspectionFromArchive,
  inspectionFromCurrent,
  licenceFromRow,
  permitFromRow,
} from "./records";
import type {
  DevApplication,
  InspectionStatus,
  Licence,
  Permit,
} from "./records";

/** Closures landing on or after this are in scope (Ontario's final reopening step). */
const WINDOW_START = "2022-03-01";
/** With no upper bound, the last sighting must be within this long before the window. */
const UNBOUNDED_GRACE_DAYS = 365;

/** Days without an inspection → weight of the "stopped" signal. */
const STOPPED: [days: number, weight: number][] = [
  [1095, 0.7],
  [730, 0.55],
  [548, 0.35],
];
const WEIGHT = {
  licence: 0.5,
  successor: 0.5,
  conversion: 0.35,
  demolition: 0.3,
  health: 0.3,
  relocation: 0.6,
};
/** An active licence suggests the business may still be open; confidence is damped. */
const ACTIVE_LICENCE_FACTOR = 0.6;
/** A licence cancelled up to this long before the last inspection still counts. */
const LICENCE_LEAD_DAYS = 180;
/** A conversion or demolition permit applied up to this long before the last sighting counts. */
const PERMIT_LEAD_DAYS = 730;
/** A health closure within this long before the last inspection is a reason for the end. */
const HEALTH_LEAD_DAYS = 90;
/** A passing inspection within this long after a closure order means it reopened. */
const REOPEN_DAYS = 365;
/** A same-name licence issued this close to the old one's cancellation is an ownership change. */
const OWNERSHIP_BEFORE_DAYS = 180;
const OWNERSHIP_AFTER_DAYS = 365;
/**
 * A same-name business first seen elsewhere within this long after the last sighting
 * moved there. Allows for licence cancellations trailing the move, and the new place's
 * first inspection trailing its opening (Sweet Thrills: 414 days).
 */
const RELOCATION_DAYS = 548;
/** Development applications up to this long before the closure are a redevelopment reason. */
const REDEVELOPMENT_LEAD_DAYS = 5 * 365;
/** Zoning amendments and subdivisions are redevelopment on record; site plans only suggest it. */
const REDEVELOPMENT_DOCUMENTED = new Set(["OZ", "SB"]);
const REDEVELOPMENT_SIGNAL = new Set(["SA"]);
const BATCH = 5000;

type Claim =
  | "closed"
  | "announced"
  | "reopened"
  | "relocated"
  | "rebranded"
  | "successor"
  | "reason";

type Occupancy = {
  id: string;
  establishmentId: string;
  locationId: string;
  pointId: string | null;
  address: string;
  first: string | null;
  last: string | null;
  name: string;
  chained: boolean;
};

type InspectionDay = {
  date: string;
  status: InspectionStatus;
  recordId: string;
};
type Linked<T> = { record: T; recordId: string };

type Evidence = {
  recordId: string;
  establishmentId: string;
  claim: Claim;
  note: string;
};
type Reason = {
  recordId: string;
  claim: Claim;
  code: "health_enforcement" | "redevelopment";
  kind: "documented" | "signal";
  note: string;
};
type Event = {
  occupancyId: string;
  key: string;
  type:
    "permanent" | "relocated" | "rebranded" | "ownership_change" | "temporary";
  status: "closed" | "reopened";
  earliest: string | null;
  latest: string | null;
  confidence: number;
  evidence: Evidence[];
  reasons: Reason[];
};
type EstablishmentLink = {
  from: string;
  to: string;
  kind: "relocated_to" | "rebranded_as" | "successor";
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

function minDate(...dates: (string | null | undefined)[]): string | null {
  const known = dates.filter((d): d is string => Boolean(d)).sort();
  return known[0] ?? null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function stoppedWeight(days: number): number {
  for (const [threshold, weight] of STOPPED)
    if (days >= threshold) return weight;
  return 0;
}

function inWindow(earliest: string | null, latest: string | null): boolean {
  if (latest) return latest >= WINDOW_START;
  return (earliest ?? "") >= addDays(WINDOW_START, -UNBOUNDED_GRACE_DAYS);
}

async function detect(cityId: string): Promise<string> {
  const occupancies: {
    id: string;
    establishment_id: string;
    location_id: string;
    address_point_id: string | null;
    address: string;
    first_seen: string | null;
    last_seen: string | null;
    canonical_name: string;
    chain_id: string | null;
  }[] = await sql`
    select o.id, o.establishment_id, o.location_id, l.address_point_id, l.address,
           o.first_seen::text, o.last_seen::text, e.canonical_name, e.chain_id
    from occupancies o
    join establishments e on e.id = o.establishment_id
    join locations l on l.id = o.location_id
    where e.city_id = ${cityId}
  `;
  const links: {
    establishment_id: string | null;
    location_id: string | null;
    record_id: string;
    source: string;
    raw_json: Row;
  }[] = await sql`
    select rl.establishment_id, rl.location_id, sr.id as record_id, sr.source, sr.raw_json
    from record_links rl join source_records sr on sr.id = rl.source_record_id
    where sr.city_id = ${cityId}
    order by sr.id
  `;

  // Records, by establishment (inspections, licences) and by location (permits, apps).
  const byEstablishment = new Map<string, Occupancy[]>();
  const byLocation = new Map<string, Occupancy[]>();
  const byPoint = new Map<string, Set<string>>();
  for (const o of occupancies) {
    const occupancy: Occupancy = {
      id: o.id,
      establishmentId: o.establishment_id,
      locationId: o.location_id,
      pointId: o.address_point_id,
      address: o.address,
      first: o.first_seen,
      last: o.last_seen,
      name: o.canonical_name,
      chained: o.chain_id !== null,
    };
    push(byEstablishment, o.establishment_id, occupancy);
    push(byLocation, o.location_id, occupancy);
    if (o.address_point_id) {
      const set = byPoint.get(o.address_point_id) ?? new Set();
      set.add(o.location_id);
      byPoint.set(o.address_point_id, set);
    }
  }

  const inspections = new Map<string, InspectionDay[]>(); // by occupancy
  const licences = new Map<string, Map<string, Linked<Licence>>>(); // by establishment, number
  const permits = new Map<string, Linked<Permit>[]>(); // by location
  const applications = new Map<string, Linked<DevApplication>[]>(); // by location
  const locationOf = new Map<string, string>(); // establishment → location of each record
  let horizon = "";
  let failed = 0;

  /** An establishment's inspection goes to its occupancy at that location, else its only (or latest) one. */
  function occupancyFor(
    establishmentId: string,
    locationId: string | null,
  ): Occupancy | undefined {
    const own = byEstablishment.get(establishmentId) ?? [];
    return (
      own.find((o) => o.locationId === locationId) ??
      [...own].sort((a, b) => (a.last ?? "").localeCompare(b.last ?? "")).at(-1)
    );
  }

  for (const link of links) {
    try {
      if (link.source === "dinesafe" || link.source === "dinesafe_archive") {
        if (!link.establishment_id) continue;
        const inspection =
          link.source === "dinesafe"
            ? inspectionFromCurrent(link.raw_json)
            : inspectionFromArchive(link.raw_json);
        if (inspection.date > horizon) horizon = inspection.date;
        const occupancy = occupancyFor(link.establishment_id, link.location_id);
        if (!occupancy) continue;
        push(inspections, occupancy.id, {
          date: inspection.date,
          status: inspection.status,
          recordId: link.record_id,
        });
      } else if (link.source === "business_licences") {
        if (!link.establishment_id) continue;
        const licence = licenceFromRow(link.raw_json);
        const own = licences.get(link.establishment_id) ?? new Map();
        // Records are in id order, so the newest version of each licence wins.
        own.set(licence.number, { record: licence, recordId: link.record_id });
        licences.set(link.establishment_id, own);
        if (link.location_id)
          locationOf.set(link.establishment_id, link.location_id);
      } else if (link.source === "development_applications") {
        if (!link.location_id) continue;
        push(applications, link.location_id, {
          record: devApplicationFromRow(link.raw_json),
          recordId: link.record_id,
        });
      } else if (link.location_id) {
        push(permits, link.location_id, {
          record: permitFromRow(link.raw_json),
          recordId: link.record_id,
        });
      }
    } catch {
      failed++;
    }
  }
  if (!horizon) throw new Error("no inspections; run bun run resolve first");
  const [latestLicencePull]: { date: string | null }[] = await sql`
    select max(fetched_at)::date::text as date from ingests
    where city_id = ${cityId} and source = 'business_licences'
  `;
  const licencesAsOf = latestLicencePull?.date ?? horizon;

  /** Distinct inspection days, oldest first; a day with a closure order counts as closed. */
  function daysOf(occupancyId: string): InspectionDay[] {
    const byDate = new Map<string, InspectionDay>();
    for (const day of inspections.get(occupancyId) ?? []) {
      const seen = byDate.get(day.date);
      if (!seen || (day.status === "closed" && seen.status !== "closed"))
        byDate.set(day.date, day);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Other occupancies at the same place: this location, or its point if that has few. */
  function neighbours(o: Occupancy): Occupancy[] {
    const places = new Set([o.locationId]);
    const atPoint = o.pointId ? byPoint.get(o.pointId) : undefined;
    if (atPoint && atPoint.size <= 3) for (const id of atPoint) places.add(id);
    return [...places]
      .flatMap((id) => byLocation.get(id) ?? [])
      .filter((n) => n.establishmentId !== o.establishmentId);
  }

  // Businesses by distinctive name, for relocations to a new establishment.
  const byName = new Map<string, Occupancy[]>();
  for (const o of occupancies) {
    const key = nameKey(o.canonical_name);
    if (key && chainKey(o.canonical_name)) {
      const occupancy = byEstablishment
        .get(o.establishment_id)
        ?.find((x) => x.id === o.id);
      if (occupancy) push(byName, key, occupancy);
    }
  }

  const events: Event[] = [];
  const establishmentLinks: EstablishmentLink[] = [];
  let operating = 0;
  let outOfWindow = 0;

  for (const o of occupancies) {
    const occupancy = byEstablishment
      .get(o.establishment_id)
      ?.find((x) => x.id === o.id);
    if (!occupancy) continue;
    const days = daysOf(occupancy.id);
    const lastDay = days.at(-1);
    const own = [...(licences.get(occupancy.establishmentId)?.values() ?? [])];
    const activeLicence = own.some((l) => !l.record.cancelled);

    // Temporary closures: a closure order, then a passing inspection.
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!day || day.status !== "closed" || day.date < WINDOW_START) continue;
      const reopened = days
        .slice(i + 1)
        .find(
          (d) =>
            d.status !== "closed" &&
            daysBetween(day.date, d.date) <= REOPEN_DAYS,
        );
      if (!reopened) continue;
      events.push({
        occupancyId: occupancy.id,
        key: `temporary:${day.date}`,
        type: "temporary",
        status: "reopened",
        earliest: day.date,
        latest: day.date,
        confidence: 0.95,
        evidence: [
          {
            recordId: day.recordId,
            establishmentId: occupancy.establishmentId,
            claim: "closed",
            note: `DineSafe closure order on ${day.date}.`,
          },
          {
            recordId: reopened.recordId,
            establishmentId: occupancy.establishmentId,
            claim: "reopened",
            note: `Inspected again on ${reopened.date} (${reopened.status.replace("_", " ")}).`,
          },
        ],
        reasons: [
          {
            recordId: day.recordId,
            claim: "closed",
            code: "health_enforcement",
            kind: "documented",
            note: "Closed by a DineSafe health inspection.",
          },
        ],
      });
    }

    // Ownership changes: a cancelled licence, then a new owner's under the same name.
    const sorted = [...own].sort((a, b) =>
      (a.record.issued ?? "").localeCompare(b.record.issued ?? ""),
    );
    // Each new licence marks one change, even if several old ones lead to it.
    const changed = new Set<string>();
    for (const previous of sorted) {
      const cancelled = previous.record.cancelled;
      if (!cancelled) continue;
      const next = sorted.find(
        (l) =>
          l !== previous &&
          l.record.issued &&
          daysBetween(cancelled, l.record.issued) >= -OWNERSHIP_BEFORE_DAYS &&
          daysBetween(cancelled, l.record.issued) <= OWNERSHIP_AFTER_DAYS &&
          nameKey(l.record.owner) !== nameKey(previous.record.owner) &&
          nameKey(l.record.operatingName ?? "") ===
            nameKey(previous.record.operatingName ?? ""),
      );
      if (!next?.record.issued || changed.has(next.record.number)) continue;
      changed.add(next.record.number);
      const earliest = minDate(cancelled, next.record.issued);
      const latest = [cancelled, next.record.issued].sort()[1] ?? null;
      if (!inWindow(earliest, latest)) continue;
      events.push({
        occupancyId: occupancy.id,
        key: `ownership:${next.record.number}`,
        type: "ownership_change",
        status: "closed",
        earliest,
        latest,
        confidence: 0.8,
        evidence: [
          {
            recordId: previous.recordId,
            establishmentId: occupancy.establishmentId,
            claim: "closed",
            note: `Licence ${previous.record.number} cancelled ${cancelled}.`,
          },
          {
            recordId: next.recordId,
            establishmentId: occupancy.establishmentId,
            claim: "successor",
            note: `Licence ${next.record.number} issued ${next.record.issued} to a new owner, same name.`,
          },
        ],
        reasons: [],
      });
    }

    // How the occupancy ended, if it did.
    const lastSeen = lastDay?.date ?? occupancy.last;
    const signals: number[] = [];
    const evidence: Evidence[] = [];
    const reasons: Reason[] = [];
    const bounds: (string | null)[] = [];
    // Recorded only if the event is kept.
    const pendingLinks: EstablishmentLink[] = [];
    let type: Event["type"] = "permanent";

    if (lastDay) {
      const gap = daysBetween(lastDay.date, horizon);
      const weight = stoppedWeight(gap);
      if (weight) {
        signals.push(weight);
        evidence.push({
          recordId: lastDay.recordId,
          establishmentId: occupancy.establishmentId,
          claim: "closed",
          note: `Last DineSafe inspection ${lastDay.date}; none in the ${Math.round(gap / 30.4)} months since (DineSafe to ${horizon}).`,
        });
      }
      const order = [...days]
        .reverse()
        .find(
          (d) =>
            d.status === "closed" &&
            daysBetween(d.date, lastDay.date) <= HEALTH_LEAD_DAYS,
        );
      if (order) {
        signals.push(WEIGHT.health);
        reasons.push({
          recordId: order.recordId,
          claim: "reason",
          code: "health_enforcement",
          kind: "documented",
          note: `Closed by a DineSafe health inspection on ${order.date}.`,
        });
      }
    }

    if (own.length && !activeLicence) {
      const last = [...own].sort((a, b) =>
        (a.record.cancelled ?? "").localeCompare(b.record.cancelled ?? ""),
      )[own.length - 1];
      const cancelled = last?.record.cancelled;
      if (
        last &&
        cancelled &&
        (!lastSeen || cancelled >= addDays(lastSeen, -LICENCE_LEAD_DAYS))
      ) {
        signals.push(WEIGHT.licence);
        if (!lastSeen || cancelled >= lastSeen) bounds.push(cancelled);
        evidence.push({
          recordId: last.recordId,
          establishmentId: occupancy.establishmentId,
          claim: "closed",
          note: `Licence ${last.record.number} cancelled ${cancelled}.`,
        });
      }
    }

    // The next business at the same place.
    // (Never a business of the same name: that's this one under another id.)
    const successor = neighbours(occupancy)
      .filter(
        (n) =>
          n.first &&
          lastSeen &&
          n.first > lastSeen &&
          nameKey(n.name) !== nameKey(occupancy.name),
      )
      .sort((a, b) => (a.first ?? "").localeCompare(b.first ?? ""))[0];
    if (successor?.first) {
      const firstRecord =
        daysOf(successor.id)[0]?.recordId ??
        [...(licences.get(successor.establishmentId)?.values() ?? [])][0]
          ?.recordId;
      if (firstRecord) {
        signals.push(WEIGHT.successor);
        bounds.push(successor.first);
        evidence.push({
          recordId: firstRecord,
          establishmentId: successor.establishmentId,
          claim: "successor",
          note: `${successor.name} first seen here ${successor.first}.`,
        });
        // A successor licensed to the same owner is the same operation, renamed.
        const owners = new Set(
          own.map((l) => nameKey(l.record.owner)).filter(Boolean),
        );
        const successorOwners = [
          ...(licences.get(successor.establishmentId)?.values() ?? []),
        ].map((l) => nameKey(l.record.owner));
        if (successorOwners.some((owner) => owner && owners.has(owner))) {
          type = "rebranded";
          pendingLinks.push({
            from: occupancy.establishmentId,
            to: successor.establishmentId,
            kind: "rebranded_as",
          });
        } else {
          pendingLinks.push({
            from: occupancy.establishmentId,
            to: successor.establishmentId,
            kind: "successor",
          });
        }
      }
    }

    // Permits and development applications at the place.
    const since = lastSeen ? addDays(lastSeen, -PERMIT_LEAD_DAYS) : "";
    for (const { record: permit, recordId } of permits.get(
      occupancy.locationId,
    ) ?? []) {
      if (!permit.applied || permit.applied < since) continue;
      if (permit.fromFood) {
        signals.push(WEIGHT.conversion);
        evidence.push({
          recordId,
          establishmentId: occupancy.establishmentId,
          claim: "closed",
          note: `Permit ${permit.number} (applied ${permit.applied}): ${permit.currentUse} → ${permit.proposedUse}.`,
        });
      }
      if (permit.demolition) {
        signals.push(WEIGHT.demolition);
        reasons.push({
          recordId,
          claim: "reason",
          code: "redevelopment",
          kind: "documented",
          note: `Demolition permit ${permit.number}, applied ${permit.applied}.`,
        });
      }
    }

    // The same business, first seen at another address afterwards.
    const moved =
      (byEstablishment.get(occupancy.establishmentId) ?? []).find(
        (other) =>
          other.id !== occupancy.id &&
          other.first &&
          lastSeen &&
          other.first > (occupancy.first ?? "") &&
          (other.last ?? "") > lastSeen,
      ) ??
      (occupancy.chained
        ? undefined
        : (byName.get(nameKey(occupancy.name)) ?? []).find(
            (other) =>
              other.establishmentId !== occupancy.establishmentId &&
              other.locationId !== occupancy.locationId &&
              other.first &&
              lastSeen &&
              other.first >= addDays(lastSeen, -90) &&
              other.first <= addDays(lastSeen, RELOCATION_DAYS),
          ));
    if (moved?.first) {
      const record =
        daysOf(moved.id)[0]?.recordId ??
        [...(licences.get(moved.establishmentId)?.values() ?? [])][0]?.recordId;
      if (record) {
        signals.push(WEIGHT.relocation);
        type = "relocated";
        evidence.push({
          recordId: record,
          establishmentId: moved.establishmentId,
          claim: "relocated",
          note: `${moved.name} at ${moved.address} from ${moved.first}.`,
        });
        if (moved.establishmentId !== occupancy.establishmentId)
          pendingLinks.push({
            from: occupancy.establishmentId,
            to: moved.establishmentId,
            kind: "relocated_to",
          });
      }
    }

    // A closure needs a sign it ended, not just a reason it might have.
    const ended = evidence.some(
      (e) =>
        e.claim === "closed" ||
        e.claim === "successor" ||
        e.claim === "relocated",
    );
    if (!ended) {
      operating++;
      continue;
    }

    const latest = minDate(...bounds);
    const earliest = lastDay ? lastSeen : null;
    if (!inWindow(earliest, latest)) {
      outOfWindow++;
      continue;
    }

    // Reasons from development applications, now that the closure's timing is known.
    const until = latest ?? horizon;
    for (const { record: app, recordId } of applications.get(
      occupancy.locationId,
    ) ?? []) {
      if (!app.submitted || app.submitted > until) continue;
      if (app.submitted < addDays(until, -REDEVELOPMENT_LEAD_DAYS)) continue;
      const documented = REDEVELOPMENT_DOCUMENTED.has(app.type);
      if (!documented && !REDEVELOPMENT_SIGNAL.has(app.type)) continue;
      reasons.push({
        recordId,
        claim: "reason",
        code: "redevelopment",
        kind: documented ? "documented" : "signal",
        note: `Development application ${app.number} (${app.type}) submitted ${app.submitted}.`,
      });
    }

    establishmentLinks.push(...pendingLinks);
    const combined = 1 - signals.reduce((p, w) => p * (1 - w), 1);
    const confidence =
      Math.round(100 * combined * (activeLicence ? ACTIVE_LICENCE_FACTOR : 1)) /
      100;
    events.push({
      occupancyId: occupancy.id,
      key: "end",
      type,
      status: "closed",
      earliest,
      latest,
      confidence,
      evidence,
      reasons,
    });
  }

  const written = await sql.begin((tx) =>
    write(tx, cityId, events, establishmentLinks),
  );

  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  const buckets = [0.8, 0.6, 0.4, 0];
  const ends = events.filter((e) => e.key === "end");
  const confidence = buckets.map((floor, i) => {
    const ceiling = i === 0 ? 1.01 : (buckets[i - 1] ?? 1.01);
    const n = ends.filter(
      (e) => e.confidence >= floor && e.confidence < ceiling,
    ).length;
    return `≥${floor} ${count(n)}`;
  });
  return [
    `${count(events.length)} events: ${[...byType].map(([t, n]) => `${t} ${count(n)}`).join(", ")}`,
    `end-of-occupancy confidence: ${confidence.join(" · ")}`,
    `${count(operating)} occupancies still operating, ${count(outOfWindow)} ended before ${WINDOW_START}; DineSafe to ${horizon}, licences to ${licencesAsOf}; ${count(failed)} records failed to parse`,
    `written: ${written}`,
  ].join("\n  ");
}

async function insertBatches(
  tx: TransactionSQL,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH)
    await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + BATCH))}`;
}

/** Stages events, evidence, reasons and links, then merges them, writing only what changed. */
async function write(
  tx: TransactionSQL,
  cityId: string,
  events: Event[],
  establishmentLinks: EstablishmentLink[],
): Promise<string> {
  await tx`
    create temp table staged_events (
      occupancy_id bigint, key text, type text, status text,
      closed_on_earliest date, closed_on_latest date, confidence real,
      primary key (occupancy_id, key)
    ) on commit drop
  `;
  await tx`
    create temp table staged_evidence (
      occupancy_id bigint, key text, source_record_id bigint,
      establishment_id bigint, claim text, note text
    ) on commit drop
  `;
  await tx`
    create temp table staged_reasons (
      occupancy_id bigint, key text, source_record_id bigint, claim text,
      reason_code text, kind text, note text
    ) on commit drop
  `;
  await tx`
    create temp table staged_links (from_id bigint, to_id bigint, kind text)
    on commit drop
  `;

  const stagedEvents = events.map((e) => ({
    occupancy_id: e.occupancyId,
    key: e.key,
    type: e.type,
    status: e.status,
    closed_on_earliest: e.earliest,
    closed_on_latest: e.latest,
    confidence: e.confidence,
  }));
  // A reason's record is evidence too (claim "reason" unless it already backs the event).
  const stagedEvidence = events.flatMap((e) => {
    const rows = new Map<string, Record<string, unknown>>();
    for (const item of [
      ...e.evidence,
      ...e.reasons.map((r) => ({
        recordId: r.recordId,
        establishmentId: null,
        claim: r.claim,
        note: r.note,
      })),
    ])
      rows.set(`${item.recordId}|${item.claim}`, {
        occupancy_id: e.occupancyId,
        key: e.key,
        source_record_id: item.recordId,
        establishment_id: item.establishmentId,
        claim: item.claim,
        note: item.note,
      });
    return [...rows.values()];
  });
  const stagedReasons = events.flatMap((e) =>
    e.reasons.map((r) => ({
      occupancy_id: e.occupancyId,
      key: e.key,
      source_record_id: r.recordId,
      claim: r.claim,
      reason_code: r.code,
      kind: r.kind,
      note: r.note,
    })),
  );
  const unique = new Map(
    establishmentLinks.map((l) => [`${l.from}|${l.to}|${l.kind}`, l]),
  );
  const stagedLinks = [...unique.values()]
    .filter((l) => l.from !== l.to)
    .map((l) => ({ from_id: l.from, to_id: l.to, kind: l.kind }));

  await insertBatches(tx, "staged_events", stagedEvents);
  await insertBatches(tx, "staged_evidence", stagedEvidence);
  await insertBatches(tx, "staged_reasons", stagedReasons);
  await insertBatches(tx, "staged_links", stagedLinks);

  const upserted = await tx`
    insert into closure_events (occupancy_id, key, type, status, closed_on_earliest, closed_on_latest, confidence)
    select occupancy_id, key, type, status, closed_on_earliest, closed_on_latest, confidence
    from staged_events
    on conflict (occupancy_id, key) do update
    set type = excluded.type, status = excluded.status,
        closed_on_earliest = excluded.closed_on_earliest,
        closed_on_latest = excluded.closed_on_latest,
        confidence = excluded.confidence
    where (closure_events.type, closure_events.status, closure_events.closed_on_earliest,
           closure_events.closed_on_latest, closure_events.confidence)
          is distinct from
          (excluded.type, excluded.status, excluded.closed_on_earliest,
           excluded.closed_on_latest, excluded.confidence)
  `;

  await tx`
    create temp table resolved_evidence on commit drop as
    select ce.id as closure_event_id, s.source_record_id, s.establishment_id, s.claim, s.note
    from staged_evidence s
    join closure_events ce on ce.occupancy_id = s.occupancy_id and ce.key = s.key
  `;
  // This job's evidence: from a bulk record, not yet reviewed, on an event of this city.
  const ownEvidence = tx`
    e.source_record_id is not null and e.match_status = 'auto'
    and e.closure_event_id in (
      select ce.id from closure_events ce
      join occupancies o on o.id = ce.occupancy_id
      join establishments est on est.id = o.establishment_id
      where est.city_id = ${cityId}
    )
  `;
  const staleReasons = await tx`
    delete from closure_reasons cr
    using evidence e
    where cr.evidence_id = e.id and ${ownEvidence}
      and not exists (
        select 1 from staged_reasons s
        join closure_events ce on ce.occupancy_id = s.occupancy_id and ce.key = s.key
        where ce.id = cr.closure_event_id and s.source_record_id = e.source_record_id
          and s.reason_code = cr.reason_code and s.kind = cr.kind
      )
  `;
  const staleEvidence = await tx`
    delete from evidence e
    where ${ownEvidence}
      and not exists (
        select 1 from resolved_evidence r
        where r.closure_event_id = e.closure_event_id
          and r.source_record_id = e.source_record_id and r.claim = e.claim
      )
      and not exists (select 1 from closure_reasons cr where cr.evidence_id = e.id)
  `;
  const evidence = await tx`
    insert into evidence (closure_event_id, source_record_id, establishment_id, claim, note)
    select closure_event_id, source_record_id, establishment_id, claim, note
    from resolved_evidence
    on conflict (closure_event_id, source_record_id, claim) where source_record_id is not null
    do update set establishment_id = excluded.establishment_id, note = excluded.note
    where (evidence.establishment_id, evidence.note)
          is distinct from (excluded.establishment_id, excluded.note)
  `;
  const reasons = await tx`
    insert into closure_reasons (closure_event_id, reason_code, kind, evidence_id, note)
    select ce.id, s.reason_code, s.kind, e.id, s.note
    from staged_reasons s
    join closure_events ce on ce.occupancy_id = s.occupancy_id and ce.key = s.key
    join evidence e on e.closure_event_id = ce.id
      and e.source_record_id = s.source_record_id and e.claim = s.claim
    on conflict do nothing
  `;

  // Events this run no longer produces, once nothing but this job's evidence backed them.
  const staleEvents = await tx`
    delete from closure_events ce
    using occupancies o, establishments est
    where ce.occupancy_id = o.id and o.establishment_id = est.id
      and est.city_id = ${cityId}
      and not exists (
        select 1 from staged_events s where s.occupancy_id = ce.occupancy_id and s.key = ce.key
      )
      and not exists (select 1 from evidence e where e.closure_event_id = ce.id)
  `;

  const staleLinks = await tx`
    delete from establishment_links l
    using establishments est
    where l.from_establishment_id = est.id and est.city_id = ${cityId}
      and not exists (
        select 1 from staged_links s
        where s.from_id = l.from_establishment_id and s.to_id = l.to_establishment_id
          and s.kind = l.kind
      )
  `;
  const insertedLinks = await tx`
    insert into establishment_links (from_establishment_id, to_establishment_id, kind)
    select from_id, to_id, kind from staged_links
    on conflict do nothing
  `;

  return [
    `${count(upserted.count)} events`,
    `${count(evidence.count)} evidence`,
    `${count(reasons.count)} reasons`,
    `${count(insertedLinks.count)} establishment links`,
    `removed ${count(staleEvents.count)} events, ${count(staleEvidence.count)} evidence, ${count(staleReasons.count)} reasons, ${count(staleLinks.count)} links`,
  ].join(", ");
}

await runJob([{ name: "detect", run: (cityId) => detect(cityId) }]);
