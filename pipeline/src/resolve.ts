// Entity resolution (Phase 4): builds establishments, locations, occupancies and
// record_links from DineSafe (current feed and archive) and business licences.
//
//   bun run resolve
//
// Everything is rebuilt from source_records on each run, then written in place by stable
// keys (establishments.source_key, locations.slug), so ids survive re-runs and only rows
// that changed are written.
//
// 1. Locations: each record's address + unit, matched to an address point.
// 2. DineSafe: ids linked by oldEstId, or sharing a location and a normalized name, are
//    one establishment (so a new DineSafe id after an ownership change still merges).
//    Types the site doesn't cover (schools, plants, carts) are skipped.
// 3. Licences: attached to the establishment at the same address with the most similar
//    name and overlapping dates. An unmatched food licence active since 2020 is an
//    establishment of its own.
// 4. Chains: a name at 3+ locations that's at 5+, or licensed with the CHAIN condition.

import type { TransactionSQL } from "bun";
import { slugify } from "@ripstaurant/contract";
import type { BusinessType } from "@ripstaurant/contract";
import { sql } from "@ripstaurant/db";
import { AddressMatcher } from "./address";
import type { LngLat, MatchMethod } from "./address";
import { TORONTO_DATASETS } from "./datasets";
import type { BulkDataset, Row } from "./datasets";
import { count, runJob } from "./job";
import {
  chainKey,
  looksNotCovered,
  nameKey,
  nameSimilarity,
  sharesDistinctiveWord,
} from "./names";
import {
  dinesafeBusinessType,
  inspectionFromArchive,
  inspectionFromCurrent,
  licenceFromRow,
} from "./records";
import type { Inspection, Licence } from "./records";

/** Location slugs start with the city's short code, as in the contract: tor-176-dupont-st. */
const SLUG_PREFIX = "tor";
/** Licences cancelled before this can't bear on closures from 2022-03; they're left out. */
const LICENCES_SINCE = "2020-01-01";
/** A licence belongs to an establishment whose name is at least this similar (names.ts). */
const NAME_MATCH = 0.5;
/**
 * At the exact same location (unit included), one shared distinctive word is enough:
 * the licence name often isn't the sign ("KEZY FOODS" / "KEZY DONER").
 */
const SAME_UNIT_MATCH = 0.6;
/** Slack when checking a licence's dates overlap the establishment's inspections. */
const OVERLAP_DAYS = 365;
/** Patio licences attach to a restaurant; on their own they aren't an establishment. */
const PATIO = new Set(["SIDEWALK CAFE", "CURB LANE CAFE"]);
const CHAIN_MIN_LOCATIONS = 3;
const CHAIN_SURE_LOCATIONS = 5;
const BATCH = 5000;

type Location = {
  slug: string;
  /** Normalized address without the unit, e.g. "116 GEARY AVE". */
  key: string;
  unit: string | null;
  /** "116 Geary Ave, Unit 108A" */
  address: string;
  pointId: string | null;
  method: MatchMethod | null;
  /** The record's own coordinates, used when there's no address point. */
  near: LngLat | null;
};

type Span = { first: string | null; last: string | null };

type Establishment = {
  sourceKey: string;
  names: Set<string>;
  name: string;
  businessType: BusinessType | null;
  openedOn: string | null;
  licensedChain: boolean;
  licences: number;
  seen: Span;
  /** Location slug → when this establishment was seen there. */
  occupancies: Map<string, Span>;
  links: { recordId: string; slug: string | null; confidence: number }[];
};

type Point = {
  id: string;
  source_key: string;
  match_key: string;
  address: string;
  lng: number;
  lat: number;
};

function datasetFor(source: string): BulkDataset {
  const dataset = TORONTO_DATASETS.find((d) => d.source === source);
  if (!dataset) throw new Error(`no dataset "${source}"`);
  return dataset;
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Widens a span to cover both dates. Sources can be out of order (a licence cancelled before it was issued), so the span never runs backwards. */
function extend(span: Span, a: string | null, b: string | null): void {
  span.first = earliest(span.first, earliest(a, b));
  span.last = latest(span.last, latest(a, b));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "429A YONGE ST W" → "429A Yonge St W" (for addresses without an exact address point). */
function titleCase(key: string): string {
  return key
    .split(" ")
    .map((word) => {
      if (/^\d/.test(word) || /^[NSEW]$/.test(word)) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
}

async function resolve(cityId: string): Promise<string> {
  const points: Point[] = await sql`
    select id, source_key, match_key, address, ST_X(geom) as lng, ST_Y(geom) as lat
    from address_points
    where city_id = ${cityId} and removed_at is null
    order by id
  `;
  if (!points.length)
    throw new Error("no address points; run bun run reference first");
  const matcher = new AddressMatcher(points);
  const pointAddress = new Map(points.map((p) => [p.id, p.address]));

  // 1. Locations ------------------------------------------------------------------------

  const locations = new Map<string, Location>();
  const byParsed = new Map<string, Location | null>();

  function locate(dataset: BulkDataset, row: Row): Location | null {
    const parsed = dataset.address(row);
    if (!parsed) return null;
    const cacheKey = `${parsed.key}|${parsed.unit ?? ""}`;
    const cached = byParsed.get(cacheKey);
    if (cached !== undefined) return cached;

    const match = matcher.match(
      parsed,
      dataset.addressPointId?.(row),
      dataset.near?.(row),
    );
    const key = match?.key ?? parsed.key;
    const unit = match?.unit ?? parsed.unit;
    const slug = `${SLUG_PREFIX}-${slugify(unit ? `${key} unit ${unit}` : key)}`;
    let location = locations.get(slug);
    if (!location) {
      const pointId = match?.pointId ?? null;
      // The City's own spelling when the point is this exact address; ours otherwise.
      const exactPoint =
        match?.method === "id" ||
        match?.method === "exact" ||
        match?.method === "unit_trimmed";
      const base =
        (exactPoint && pointId && pointAddress.get(pointId)) || titleCase(key);
      location = {
        slug,
        key,
        unit,
        address: unit ? `${base}, Unit ${unit}` : base,
        pointId,
        method: pointId && match ? (match.method as MatchMethod) : null,
        near: dataset.near?.(row) ?? null,
      };
      locations.set(slug, location);
    }
    byParsed.set(cacheKey, location);
    return location;
  }

  // 2. DineSafe establishments ---------------------------------------------------------

  const parent = new Map<string, string>();
  function find(node: string): string {
    const up = parent.get(node) ?? node;
    if (up === node) return node;
    const root = find(up);
    parent.set(node, root);
    return root;
  }
  function union(a: string, b: string): void {
    const x = find(a);
    const y = find(b);
    if (x === y) return;
    // The smaller id is the root, so a component's key doesn't depend on row order.
    if (x < y) parent.set(y, x);
    else parent.set(x, y);
  }

  type DinesafeRow = {
    recordId: string;
    node: string;
    inspection: Inspection;
    location: Location | null;
    current: boolean;
  };
  const dinesafeRows: DinesafeRow[] = [];
  const byNameAtLocation = new Map<string, string>();
  let failed = 0;

  for (const [source, parse] of [
    ["dinesafe", inspectionFromCurrent],
    ["dinesafe_archive", inspectionFromArchive],
  ] as const) {
    const dataset = datasetFor(source);
    const rows: { id: string; raw_json: Row }[] =
      await sql`select id, raw_json from source_records where source = ${source}`;
    for (const { id, raw_json: row } of rows) {
      let inspection: Inspection;
      try {
        inspection = parse(row);
      } catch {
        failed++;
        continue;
      }
      const current = source === "dinesafe";
      // Current ids ("001Vo000013QjdPIAS") and archive ids ("10657713") don't overlap.
      const node = inspection.establishmentId;
      parent.set(node, parent.get(node) ?? node);
      if (inspection.archiveId) {
        parent.set(
          inspection.archiveId,
          parent.get(inspection.archiveId) ?? inspection.archiveId,
        );
        union(node, inspection.archiveId);
      }
      const location = locate(dataset, row);
      const name = nameKey(inspection.name);
      if (location && name) {
        const key = `${location.slug}|${name}`;
        const other = byNameAtLocation.get(key);
        if (other) union(node, other);
        else byNameAtLocation.set(key, node);
      }
      dinesafeRows.push({ recordId: id, node, inspection, location, current });
    }
  }

  const components = new Map<string, DinesafeRow[]>();
  for (const row of dinesafeRows) {
    const root = find(row.node);
    const list = components.get(root);
    if (list) list.push(row);
    else components.set(root, [row]);
  }

  const establishments: Establishment[] = [];
  const byAddress = new Map<string, Establishment[]>();
  let notCovered = 0;

  for (const [root, rows] of components) {
    rows.sort(
      (a, b) =>
        a.inspection.date.localeCompare(b.inspection.date) ||
        Number(a.current) - Number(b.current),
    );
    const last = rows.at(-1);
    if (!last) continue;
    // The type from the most recent archive row; the current feed has none.
    const typed = rows.findLast((r) => r.inspection.establishmentType);
    let businessType: BusinessType | null = null;
    if (typed?.inspection.establishmentType) {
      const bt = dinesafeBusinessType(typed.inspection.establishmentType);
      if (bt === null) {
        notCovered++;
        continue;
      }
      businessType = bt ?? null;
    }

    const establishment: Establishment = {
      sourceKey: `dinesafe:${root}`,
      names: new Set(rows.map((r) => r.inspection.name)),
      name: last.inspection.name,
      businessType,
      openedOn: null,
      licensedChain: false,
      licences: 0,
      seen: { first: null, last: null },
      occupancies: new Map(),
      links: [],
    };
    for (const row of rows) {
      const { date } = row.inspection;
      extend(establishment.seen, date, date);
      const slug = row.location?.slug ?? null;
      if (slug) {
        const span = establishment.occupancies.get(slug) ?? {
          first: null,
          last: null,
        };
        extend(span, date, date);
        establishment.occupancies.set(slug, span);
      }
      establishment.links.push({ recordId: row.recordId, slug, confidence: 1 });
    }
    establishments.push(establishment);
    for (const slug of establishment.occupancies.keys()) {
      const key = locations.get(slug)?.key;
      if (!key) continue;
      const list = byAddress.get(key) ?? [];
      if (!list.includes(establishment)) list.push(establishment);
      byAddress.set(key, list);
    }
  }
  const fromDinesafe = establishments.length;

  // 3. Licences ------------------------------------------------------------------------

  const licenceDataset = datasetFor("business_licences");
  // Every pull lists every licence, so one without a cancel date was active at the latest.
  const [latestPull]: { date: string | null }[] = await sql`
    select max(fetched_at)::date::text as date from ingests
    where city_id = ${cityId} and source = 'business_licences'
  `;
  const activeAsOf = latestPull?.date ?? null;
  const licenceRows: { id: string; raw_json: Row }[] =
    await sql`select id, raw_json from source_records where source = 'business_licences' order by id`;
  // A licence has one row per version stored; the last (newest) version wins.
  const licences = new Map<
    string,
    { licence: Licence; location: Location | null; recordIds: string[] }
  >();
  for (const { id, raw_json: row } of licenceRows) {
    let licence: Licence;
    try {
      licence = licenceFromRow(row);
    } catch {
      failed++;
      continue;
    }
    const entry = licences.get(licence.number);
    if (entry) {
      entry.licence = licence;
      entry.location = locate(licenceDataset, row) ?? entry.location;
      entry.recordIds.push(id);
    } else {
      licences.set(licence.number, {
        licence,
        location: locate(licenceDataset, row),
        recordIds: [id],
      });
    }
  }

  let matched = 0;
  let ownEstablishment = 0;
  let skippedOld = 0;
  let skippedUnmatched = 0;
  const licenceOnly = new Map<string, Establishment>();

  for (const [number, { licence, location, recordIds }] of licences) {
    if (licence.cancelled && licence.cancelled < LICENCES_SINCE) {
      skippedOld++;
      continue;
    }
    const names = [licence.operatingName, licence.owner].filter(
      (n): n is string => Boolean(n),
    );
    const start = licence.issued ?? "0000-01-01";
    const end = licence.cancelled ?? "9999-12-31";

    let best: Establishment | null = null;
    let bestScore = 0;
    for (const candidate of location
      ? (byAddress.get(location.key) ?? [])
      : []) {
      const { first, last } = candidate.seen;
      if (!first || !last) continue;
      if (
        start > addDays(last, OVERLAP_DAYS) ||
        end < addDays(first, -OVERLAP_DAYS)
      )
        continue;
      const sameUnit = location
        ? candidate.occupancies.has(location.slug)
        : false;
      let score = 0;
      for (const a of names)
        for (const b of candidate.names) {
          score = Math.max(score, nameSimilarity(a, b));
          if (sameUnit && sharesDistinctiveWord(a, b))
            score = Math.max(score, SAME_UNIT_MATCH);
        }
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    let establishment: Establishment;
    let confidence: number;
    if (best && bestScore >= NAME_MATCH) {
      matched++;
      establishment = best;
      confidence = bestScore;
    } else if (location && !PATIO.has(licence.category)) {
      // Its own establishment; licences under the same name at the same address (an
      // ownership change) are one.
      const name = licence.operatingName ?? licence.owner;
      const groupKey = `${location.slug}|${nameKey(name)}`;
      const existing = licenceOnly.get(groupKey);
      if (existing) {
        establishment = existing;
        if (number < existing.sourceKey.slice("licence:".length))
          existing.sourceKey = `licence:${number}`;
      } else {
        ownEstablishment++;
        establishment = {
          sourceKey: `licence:${number}`,
          names: new Set([name]),
          name,
          businessType: null,
          openedOn: null,
          licensedChain: false,
          licences: 0,
          seen: { first: null, last: null },
          occupancies: new Map(),
          links: [],
        };
        licenceOnly.set(groupKey, establishment);
        establishments.push(establishment);
      }
      confidence = 1;
      const span = establishment.occupancies.get(location.slug) ?? {
        first: null,
        last: null,
      };
      const until = licence.cancelled ?? activeAsOf;
      extend(span, licence.issued, until);
      establishment.occupancies.set(location.slug, span);
      extend(establishment.seen, licence.issued, until);
    } else {
      skippedUnmatched++;
      continue;
    }

    establishment.licences++;
    establishment.openedOn = earliest(establishment.openedOn, licence.issued);
    establishment.businessType ??= licence.businessType;
    establishment.licensedChain ||= licence.chain;
    // A licence issued before the first inspection moves the occupancy's start back.
    if (location && establishment.occupancies.has(location.slug)) {
      const span = establishment.occupancies.get(location.slug);
      if (span) span.first = earliest(span.first, licence.issued);
    }
    for (const recordId of recordIds)
      establishment.links.push({
        recordId,
        slug: location?.slug ?? null,
        confidence,
      });
  }

  // Untyped DineSafe establishments with no licence: skip institutions and event booths
  // by name (they need no business licence, which is why nothing typed them).
  const covered = establishments.filter(
    (e) =>
      e.businessType !== null || e.licences > 0 || !looksNotCovered(e.name),
  );
  notCovered += establishments.length - covered.length;
  establishments.length = 0;
  establishments.push(...covered);

  // One establishment, one street address: occupancies that differ only by unit spelling
  // ("Unit BLDG-MAIN FLOOR", "Unit FLOOR") are the same place, not a move.
  let collapsed = 0;
  for (const e of establishments) {
    const byStreet = new Map<string, string[]>();
    for (const slug of e.occupancies.keys()) {
      const key = locations.get(slug)?.key ?? slug;
      byStreet.set(key, [...(byStreet.get(key) ?? []), slug]);
    }
    for (const slugs of byStreet.values()) {
      if (slugs.length < 2) continue;
      // Keep the one seen most recently; fold the others' dates into it.
      slugs.sort((a, b) =>
        (e.occupancies.get(a)?.last ?? "").localeCompare(
          e.occupancies.get(b)?.last ?? "",
        ),
      );
      const keep = slugs.at(-1) ?? "";
      const target = e.occupancies.get(keep);
      if (!target) continue;
      for (const slug of slugs.slice(0, -1)) {
        const span = e.occupancies.get(slug);
        if (span) extend(target, span.first, span.last);
        e.occupancies.delete(slug);
        collapsed++;
      }
    }
  }

  // 4. Chains --------------------------------------------------------------------------

  // A variant joins a shorter brand only if some establishment uses that bare name
  // ("FRESHSLICE PIZZA" joins "FRESHSLICE"); otherwise "LUCKY'S MEATS" and "LUCKY'S
  // CHINESE RESTAURANT" would both become "LUCKY'S".
  const bareNames = new Set(establishments.map((e) => nameKey(e.name)));
  const byName = new Map<string, Establishment[]>();
  for (const e of establishments) {
    const brand = chainKey(e.name);
    if (!brand) continue;
    const key = bareNames.has(brand) ? brand : nameKey(e.name);
    const list = byName.get(key) ?? [];
    list.push(e);
    byName.set(key, list);
  }
  const chainOf = new Map<Establishment, string>();
  for (const members of byName.values()) {
    const slugs = new Set(members.flatMap((m) => [...m.occupancies.keys()]));
    const licensed = members.some((m) => m.licensedChain);
    if (
      slugs.size < CHAIN_MIN_LOCATIONS ||
      (slugs.size < CHAIN_SURE_LOCATIONS && !licensed)
    )
      continue;
    // The chain's display name: its members' most common spelling.
    const spellings = new Map<string, number>();
    for (const m of members)
      spellings.set(m.name, (spellings.get(m.name) ?? 0) + 1);
    const [name] = [...spellings].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (name) for (const m of members) chainOf.set(m, name);
  }

  // Write -----------------------------------------------------------------------------

  const usedSlugs = new Set(
    establishments.flatMap((e) => [
      ...e.occupancies.keys(),
      ...e.links.flatMap((l) => (l.slug ? [l.slug] : [])),
    ]),
  );
  const stagedLocations = [...locations.values()]
    .filter((l) => usedSlugs.has(l.slug))
    .map((l) => ({
      slug: l.slug,
      address: l.address,
      unit: l.unit,
      address_point_id: l.pointId,
      address_match: l.method,
      lng: l.near?.[0] ?? null,
      lat: l.near?.[1] ?? null,
    }));
  const stagedEstablishments = establishments.map((e) => ({
    source_key: e.sourceKey,
    canonical_name: e.name,
    business_type: e.businessType,
    chain: chainOf.get(e) ?? null,
    opened_on: e.openedOn,
  }));
  const stagedOccupancies = establishments.flatMap((e) =>
    [...e.occupancies].map(([slug, span]) => ({
      source_key: e.sourceKey,
      slug,
      first_seen: span.first,
      last_seen: span.last,
    })),
  );
  const stagedLinks = establishments.flatMap((e) =>
    e.links.map((l) => ({
      source_record_id: l.recordId,
      source_key: e.sourceKey,
      slug: l.slug,
      match_confidence: l.confidence,
    })),
  );

  const written = await sql.begin((tx) =>
    write(tx, cityId, {
      stagedLocations,
      stagedEstablishments,
      stagedOccupancies,
      stagedLinks,
    }),
  );

  const multiLocation = establishments.filter(
    (e) => e.occupancies.size > 1,
  ).length;
  const chains = new Set(chainOf.values()).size;
  return [
    `${count(establishments.length)} establishments (${count(fromDinesafe)} from DineSafe, ${count(ownEstablishment)} licence-only; ${count(notCovered)} DineSafe skipped as not covered)`,
    `${count(stagedLocations.length)} locations, ${count(stagedOccupancies.length)} occupancies (${count(multiLocation)} establishments at more than one, ${count(collapsed)} unit variants folded), ${count(chains)} chains`,
    `licences: ${count(matched)} matched to DineSafe, ${count(ownEstablishment)} own establishments, ${count(skippedUnmatched)} unmatched patio or unlocated, ${count(skippedOld)} cancelled before ${LICENCES_SINCE}; ${count(failed)} rows failed to parse`,
    `written: ${written}`,
  ].join("\n  ");
}

type Staged = {
  stagedLocations: Record<string, unknown>[];
  stagedEstablishments: Record<string, unknown>[];
  stagedOccupancies: Record<string, unknown>[];
  stagedLinks: Record<string, unknown>[];
};

async function insertBatches(
  tx: TransactionSQL,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH)
    await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + BATCH))}`;
}

/** Stages everything, then merges it into the real tables, writing only what changed. */
async function write(
  tx: TransactionSQL,
  cityId: string,
  staged: Staged,
): Promise<string> {
  await tx`
    create temp table staged_locations (
      slug text primary key, address text, unit text, address_point_id bigint,
      address_match text, lng double precision, lat double precision
    ) on commit drop
  `;
  await tx`
    create temp table staged_establishments (
      source_key text primary key, canonical_name text, business_type text,
      chain text, opened_on date
    ) on commit drop
  `;
  await tx`
    create temp table staged_occupancies (
      source_key text, slug text, first_seen date, last_seen date
    ) on commit drop
  `;
  await tx`
    create temp table staged_links (
      source_record_id bigint, source_key text, slug text, match_confidence real
    ) on commit drop
  `;
  await insertBatches(tx, "staged_locations", staged.stagedLocations);
  await insertBatches(tx, "staged_establishments", staged.stagedEstablishments);
  await insertBatches(tx, "staged_occupancies", staged.stagedOccupancies);
  await insertBatches(tx, "staged_links", staged.stagedLinks);

  await tx`
    insert into chains (name)
    select distinct chain from staged_establishments where chain is not null
    on conflict (name) do nothing
  `;

  const locations = await tx`
    insert into locations (city_id, slug, address, unit, address_point_id, address_match, geom, neighbourhood_id)
    select ${cityId}, s.slug, s.address, s.unit, s.address_point_id, s.address_match, g.geom,
           coalesce(ap.neighbourhood_id,
                    (select n.id from neighbourhoods n
                     where n.city_id = ${cityId} and ST_Contains(n.geom, g.geom)
                     order by n.id limit 1))
    from staged_locations s
    left join address_points ap on ap.id = s.address_point_id
    cross join lateral (
      select coalesce(ap.geom, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)) as geom
    ) g
    on conflict (city_id, slug) do update
    set address = excluded.address, unit = excluded.unit,
        address_point_id = excluded.address_point_id, address_match = excluded.address_match,
        geom = excluded.geom, neighbourhood_id = excluded.neighbourhood_id
    where (locations.address, locations.unit, locations.address_point_id,
           locations.address_match, locations.geom, locations.neighbourhood_id)
          is distinct from
          (excluded.address, excluded.unit, excluded.address_point_id,
           excluded.address_match, excluded.geom, excluded.neighbourhood_id)
  `;

  const establishments = await tx`
    insert into establishments (city_id, source_key, canonical_name, business_type, chain_id, opened_on)
    select ${cityId}, s.source_key, s.canonical_name, s.business_type, c.id, s.opened_on
    from staged_establishments s
    left join chains c on c.name = s.chain
    on conflict (city_id, source_key) do update
    set canonical_name = excluded.canonical_name, business_type = excluded.business_type,
        chain_id = excluded.chain_id, opened_on = excluded.opened_on
    where (establishments.canonical_name, establishments.business_type,
           establishments.chain_id, establishments.opened_on)
          is distinct from
          (excluded.canonical_name, excluded.business_type,
           excluded.chain_id, excluded.opened_on)
  `;

  // Occupancies and links: resolve staged keys to ids, then diff against what's there.
  await tx`
    create temp table resolved_occupancies on commit drop as
    select e.id as establishment_id, l.id as location_id, s.first_seen, s.last_seen
    from staged_occupancies s
    join establishments e on e.city_id = ${cityId} and e.source_key = s.source_key
    join locations l on l.city_id = ${cityId} and l.slug = s.slug
  `;
  const staleOccupancies = await tx`
    delete from occupancies o
    using establishments e
    where o.establishment_id = e.id and e.city_id = ${cityId}
      and not exists (
        select 1 from resolved_occupancies r
        where r.establishment_id = o.establishment_id and r.location_id = o.location_id
      )
  `;
  const occupancies = await tx`
    insert into occupancies (establishment_id, location_id, first_seen, last_seen)
    select establishment_id, location_id, first_seen, last_seen from resolved_occupancies
    on conflict (establishment_id, location_id) do update
    set first_seen = excluded.first_seen, last_seen = excluded.last_seen
    where (occupancies.first_seen, occupancies.last_seen)
          is distinct from (excluded.first_seen, excluded.last_seen)
  `;

  await tx`
    create temp table resolved_links on commit drop as
    select s.source_record_id, e.id as establishment_id, l.id as location_id, s.match_confidence
    from staged_links s
    join establishments e on e.city_id = ${cityId} and e.source_key = s.source_key
    left join locations l on l.city_id = ${cityId} and l.slug = s.slug
  `;
  const staleLinks = await tx`
    delete from record_links rl
    using source_records sr
    where rl.source_record_id = sr.id
      and sr.city_id = ${cityId}
      and sr.source in ('dinesafe', 'dinesafe_archive', 'business_licences')
      and not exists (
        select 1 from resolved_links r
        where r.source_record_id = rl.source_record_id
          and r.establishment_id is not distinct from rl.establishment_id
          and r.location_id is not distinct from rl.location_id
          and r.match_confidence = rl.match_confidence
      )
  `;
  const links = await tx`
    insert into record_links (source_record_id, establishment_id, location_id, match_confidence)
    select source_record_id, establishment_id, location_id, match_confidence from resolved_links
    on conflict do nothing
  `;

  // Establishments and locations no longer produced by any record.
  const staleEstablishments = await tx`
    delete from establishments e
    where e.city_id = ${cityId}
      and not exists (select 1 from staged_establishments s where s.source_key = e.source_key)
  `;
  const staleLocations = await tx`
    delete from locations l
    where l.city_id = ${cityId}
      and not exists (select 1 from staged_locations s where s.slug = l.slug)
      and not exists (select 1 from occupancies o where o.location_id = l.id)
      and not exists (select 1 from record_links rl where rl.location_id = l.id)
  `;

  return [
    `${count(establishments.count)} establishments`,
    `${count(locations.count)} locations`,
    `${count(occupancies.count)} occupancies`,
    `${count(links.count)} links`,
    `removed ${count(staleEstablishments.count)} establishments, ${count(staleLocations.count)} locations, ${count(staleOccupancies.count)} occupancies, ${count(staleLinks.count)} links`,
  ].join(", ");
}

await runJob([{ name: "resolve", run: (cityId) => resolve(cityId) }]);
