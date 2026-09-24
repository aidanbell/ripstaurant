// Exports the public dataset in the contract's format (contract/): a manifest, one list
// file per city, and one detail file per location. Everything is validated against the
// contract before it's written.
//
//   bun run export                        # to web/public/data/ (what `vite dev` serves)
//   bun run export --out some/directory
//
// Only events at or above MIN_CONFIDENCE are exported. Internal fields (confidence,
// match status, licence owners, notes that aren't reasons) never leave the database.

import { mkdir, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  CONTRACT_VERSION,
  CityList,
  LocationDetail,
  MANIFEST_PATH,
  Manifest,
  eventId,
  listPath,
  locationPath,
  roundCoord,
  rowsFromLocation,
  sortDate,
} from "@ripstaurant/contract";
import type {
  BusinessType,
  ClosureEvent,
  ClosureRow,
  Occupant,
  Source,
} from "@ripstaurant/contract";
import { sql } from "@ripstaurant/db";
import { TORONTO_DATASETS } from "./datasets";
import { CITY, count } from "./job";

/** The threshold for showing a closure publicly (PLAN: open question). */
const MIN_CONFIDENCE = 0.6;
/**
 * Business types kept in the database (they still count as successors when detecting
 * closures) but not published: groceries and convenience stores are only adjacent to a
 * site about restaurants closing.
 */
const UNPUBLISHED_TYPES: BusinessType[] = ["food_retail"];
/** Start of the coverage window; events dated before it aren't exported. */
const SINCE = "2022-03-01";
/** Which event an occupant shows when it has several (the contract allows one). */
const EVENT_PRIORITY = ["end", "ownership", "temporary"];

const { values: args } = parseArgs({
  options: {
    out: {
      type: "string",
      default: new URL("../../web/public/data", import.meta.url).pathname,
    },
    remote: { type: "boolean", default: false },
  },
});

/** Each source dataset as the site cites it; DineSafe's feed and archive are one dataset. */
const DATASET_TITLES: Record<string, string> = {
  dinesafe: "DineSafe",
  dinesafe_archive: "DineSafe",
  business_licences: "Business licences and permits",
  building_permits_active: "Building permits: active",
  building_permits_cleared: "Building permits: cleared",
  development_applications: "Development applications",
};

type EventRow = {
  event_id: string;
  key: string;
  type: ClosureEvent["type"];
  status: ClosureEvent["status"] | "retracted";
  earliest: string | null;
  latest: string | null;
  occupancy_id: string;
  establishment_id: string;
};
type OccupancyRow = {
  occupancy_id: string;
  establishment_id: string;
  location_id: string;
  name: string;
  business_type: BusinessType | null;
  chained: boolean;
  first_seen: string | null;
  last_seen: string | null;
  ended: boolean;
};
type LocationRow = {
  id: string;
  slug: string;
  address: string;
  lng: number;
  lat: number;
  hood: string;
};

function eventOrder(key: string): number {
  const i = EVENT_PRIORITY.indexOf(key.split(":")[0] ?? "");
  return i === -1 ? EVENT_PRIORITY.length : i;
}

async function exportCity(cityId: string): Promise<string> {
  const [city]: {
    slug: string;
    name: string;
    w: number;
    s: number;
    e: number;
    n: number;
    cx: number;
    cy: number;
  }[] = await sql`
    select slug, name, ST_XMin(bbox) as w, ST_YMin(bbox) as s, ST_XMax(bbox) as e,
           ST_YMax(bbox) as n, ST_X(ST_Centroid(bbox)) as cx, ST_Y(ST_Centroid(bbox)) as cy
    from cities where id = ${cityId}
  `;
  if (!city) throw new Error(`city ${cityId} not found`);
  const hoods: string[] = (
    await sql`select name from neighbourhoods where city_id = ${cityId} order by name`
  ).map((r: { name: string }) => r.name);

  // Events worth showing, one per occupancy.
  const candidates: EventRow[] = await sql`
    select ce.id as event_id, ce.key, ce.type, ce.status,
           ce.closed_on_earliest::text as earliest, ce.closed_on_latest::text as latest,
           o.id as occupancy_id, o.establishment_id
    from closure_events ce
    join occupancies o on o.id = ce.occupancy_id
    join establishments e on e.id = o.establishment_id
    join locations l on l.id = o.location_id
    where e.city_id = ${cityId}
      and ce.confidence >= ${MIN_CONFIDENCE}
      and ce.status <> 'retracted'
      and e.business_type is not null
      and e.business_type not in ${sql(UNPUBLISHED_TYPES)}
      and l.geom is not null and l.neighbourhood_id is not null
  `;
  const chosen = new Map<string, EventRow>();
  let beforeWindow = 0;
  for (const event of candidates) {
    const date = sortDate([event.earliest, event.latest]);
    if (date !== null && date < SINCE) {
      beforeWindow++;
      continue;
    }
    const current = chosen.get(event.occupancy_id);
    if (
      !current ||
      eventOrder(event.key) < eventOrder(current.key) ||
      (eventOrder(event.key) === eventOrder(current.key) &&
        (sortDate([event.earliest, event.latest]) ?? "") >
          (sortDate([current.earliest, current.latest]) ?? ""))
    )
      chosen.set(event.occupancy_id, event);
  }
  const eventIds = [...chosen.values()].map((e) => e.event_id);

  // Every occupancy at the locations those events are at, for the location's history.
  const occupancies: OccupancyRow[] = await sql`
    select o.id as occupancy_id, o.establishment_id, o.location_id, e.canonical_name as name,
           e.business_type, e.chain_id is not null as chained,
           o.first_seen::text, o.last_seen::text,
           exists (select 1 from closure_events ce where ce.occupancy_id = o.id and ce.key = 'end') as ended
    from occupancies o join establishments e on e.id = o.establishment_id
    where (e.business_type is null or e.business_type not in ${sql(UNPUBLISHED_TYPES)})
      and o.location_id in (
      select o2.location_id from occupancies o2
      join closure_events ce on ce.occupancy_id = o2.id
      where ce.id in ${sql(eventIds)}
    )
  `;
  const locationIds = [...new Set(occupancies.map((o) => o.location_id))];
  const locations: LocationRow[] = await sql`
    select l.id, l.slug, l.address, ST_X(l.geom) as lng, ST_Y(l.geom) as lat, n.name as hood
    from locations l join neighbourhoods n on n.id = l.neighbourhood_id
    where l.id in ${sql(locationIds)}
  `;
  const locationById = new Map(locations.map((l) => [l.id, l]));

  // Evidence and reasons, by event; each cites the dataset its record came from.
  const evidence: { event_id: string; claim: string; source: string }[] =
    await sql`
      select distinct ev.closure_event_id as event_id, ev.claim, sr.source
      from evidence ev join source_records sr on sr.id = ev.source_record_id
      where ev.closure_event_id in ${sql(eventIds)}
    `;
  const reasons: {
    event_id: string;
    code: string;
    kind: string;
    note: string | null;
    source: string;
  }[] = await sql`
    select cr.closure_event_id as event_id, cr.reason_code as code, cr.kind, cr.note, sr.source
    from closure_reasons cr
    join evidence ev on ev.id = cr.evidence_id
    join source_records sr on sr.id = ev.source_record_id
    where cr.closure_event_id in ${sql(eventIds)}
  `;
  // Which datasets show each occupant existed.
  const seenIn: {
    establishment_id: string;
    location_id: string;
    source: string;
  }[] = await sql`
    select distinct rl.establishment_id, rl.location_id, sr.source
    from record_links rl join source_records sr on sr.id = rl.source_record_id
    where rl.establishment_id in ${sql([...new Set(occupancies.map((o) => o.establishment_id))])}
      and sr.source in ('dinesafe', 'dinesafe_archive', 'business_licences')
  `;
  // What came next: a successor, the rebranded business, or the new address.
  const next: {
    from_id: string;
    kind: string;
    name: string;
    location_id: string | null;
  }[] = await sql`
    select l.from_establishment_id as from_id, l.kind, e.canonical_name as name,
           (select o.location_id from occupancies o where o.establishment_id = e.id
            order by o.last_seen desc nulls last limit 1) as location_id
    from establishment_links l join establishments e on e.id = l.to_establishment_id
    where l.from_establishment_id in ${sql([...new Set([...chosen.values()].map((e) => e.establishment_id))])}
  `;
  const [retrieved]: { date: string }[] = await sql`
    select max(fetched_at)::date::text as date from ingests where city_id = ${cityId}
  `;

  const datasetUrl = new Map(
    TORONTO_DATASETS.map((d) => [
      DATASET_TITLES[d.source] ?? d.source,
      `https://open.toronto.ca/dataset/${d.pkg}/`,
    ]),
  );
  const group = <T extends Record<K, string>, K extends keyof T>(
    rows: T[],
    key: K,
  ) => {
    const map = new Map<string, T[]>();
    for (const row of rows)
      map.set(row[key], [...(map.get(row[key]) ?? []), row]);
    return map;
  };
  const evidenceByEvent = group(evidence, "event_id");
  const reasonsByEvent = group(reasons, "event_id");
  const nextByEstablishment = group(next, "from_id");
  const occupanciesByLocation = group(occupancies, "location_id");
  const eventByOccupancy = new Map(
    [...chosen.values()].map((e) => [e.occupancy_id, e]),
  );
  const sourcesSeen = new Map<string, Set<string>>();
  for (const s of seenIn) {
    const key = `${s.establishment_id}|${s.location_id}`;
    const set = sourcesSeen.get(key) ?? new Set();
    set.add(DATASET_TITLES[s.source] ?? s.source);
    sourcesSeen.set(key, set);
  }

  const details: LocationDetail[] = [];
  for (const location of locations) {
    const sources: Source[] = [];
    const cite = (title: string): number => {
      const i = sources.findIndex((s) => s.title === title);
      if (i !== -1) return i;
      const source: Source = {
        kind: "dataset",
        title,
        publisher: "City of Toronto",
        url: datasetUrl.get(title) ?? "https://open.toronto.ca/",
      };
      if (retrieved?.date) source.date = retrieved.date;
      return sources.push(source) - 1;
    };

    const here = [...(occupanciesByLocation.get(location.id) ?? [])].sort(
      (a, b) => (a.first_seen ?? "").localeCompare(b.first_seen ?? ""),
    );
    const ids = new Set<string>();
    const occupants: Occupant[] = here.map((o) => {
      const event = eventByOccupancy.get(o.occupancy_id);
      const occupant: Occupant = {
        name: o.name,
        from: o.first_seen,
        // Still here unless an end was detected; with an event, until the event's latest date.
        to: o.ended ? o.last_seen : null,
        src: [
          ...(sourcesSeen.get(`${o.establishment_id}|${o.location_id}`) ?? []),
        ].map(cite),
      };
      if (o.business_type) occupant.bt = o.business_type;
      if (o.chained) occupant.chain = true;
      if (!event) return occupant;

      let id = eventId(location.slug, o.name);
      for (let n = 2; ids.has(id); n++)
        id = `${eventId(location.slug, o.name)}~${n}`;
      ids.add(id);
      const exported: ClosureEvent = {
        id,
        type: event.type,
        status: event.status === "retracted" ? "closed" : event.status,
        d: [event.earliest, event.latest],
        reasons: (reasonsByEvent.get(event.event_id) ?? []).map((r) => ({
          code: r.code as ClosureEvent["reasons"][number]["code"],
          kind: r.kind as ClosureEvent["reasons"][number]["kind"],
          ...(r.note ? { summary: r.note.slice(0, 160) } : {}),
          src: [cite(DATASET_TITLES[r.source] ?? r.source)],
        })),
        evidence: (evidenceByEvent.get(event.event_id) ?? []).map((e) => ({
          claim: e.claim as ClosureEvent["evidence"][number]["claim"],
          src: cite(DATASET_TITLES[e.source] ?? e.source),
        })),
      };
      const following = (nextByEstablishment.get(o.establishment_id) ?? [])[0];
      if (following) {
        const target = following.location_id
          ? locationById.get(following.location_id)
          : undefined;
        exported.next = { name: following.name };
        if (target && target.id !== location.id) {
          exported.next.loc = target.slug;
          exported.next.addr = target.address;
        }
      }
      if (event.latest) occupant.to = event.latest;
      occupant.event = exported;
      return occupant;
    });

    details.push(
      LocationDetail.parse({
        v: CONTRACT_VERSION,
        id: location.slug,
        city: city.slug,
        addr: location.address,
        ll: [roundCoord(location.lng), roundCoord(location.lat)],
        hood: location.hood,
        occupants,
        sources,
      }),
    );
  }

  // `next.loc` may only point at a location that has a detail file.
  const exportedSlugs = new Set(details.map((d) => d.id));
  for (const detail of details)
    for (const occupant of detail.occupants)
      if (
        occupant.event?.next?.loc &&
        !exportedSlugs.has(occupant.event.next.loc)
      )
        delete occupant.event.next.loc;

  const rows: ClosureRow[] = details
    .flatMap((d) => rowsFromLocation(d, hoods))
    .sort((a, b) => {
      const x = sortDate(a.d) ?? "9999";
      const y = sortDate(b.d) ?? "9999";
      return y.localeCompare(x) || a.name.localeCompare(b.name);
    });
  const generated = new Date().toISOString();
  const list = CityList.parse({
    v: CONTRACT_VERSION,
    city: {
      slug: city.slug,
      name: city.name,
      center: [roundCoord(city.cx), roundCoord(city.cy)],
      bbox: [city.w, city.s, city.e, city.n],
    },
    generated,
    since: SINCE,
    hoods,
    closures: rows,
  });

  // Content-hashed, so browsers and the CDN can cache it forever.
  const listJson = JSON.stringify(list);
  const hash = new Bun.CryptoHasher("sha256")
    .update(listJson)
    .digest("hex")
    .slice(0, 8);
  const listRel = listPath(city.slug, hash);
  const manifest = Manifest.parse({
    v: CONTRACT_VERSION,
    generated,
    cities: [
      { slug: city.slug, name: city.name, list: listRel, count: rows.length },
    ],
  });

  const out = args.out;
  await rm(`${out}/${city.slug}`, { recursive: true, force: true });
  await mkdir(`${out}/${city.slug}/locations`, { recursive: true });
  await Bun.write(`${out}/${listRel}`, listJson);
  const BATCH = 200;
  for (let i = 0; i < details.length; i += BATCH)
    await Promise.all(
      details
        .slice(i, i + BATCH)
        .map((d) =>
          Bun.write(
            `${out}/${locationPath(city.slug, d.id)}`,
            JSON.stringify(d),
          ),
        ),
    );
  await Bun.write(`${out}/${MANIFEST_PATH}`, JSON.stringify(manifest));

  const kb = Math.round(Bun.gzipSync(Buffer.from(listJson)).length / 1024);
  return `${count(rows.length)} closures at ${count(details.length)} locations (list ${kb} KB gzipped; ${count(beforeWindow)} events dated before ${SINCE} left out) → ${out}`;
}

const [city]: { id: string }[] =
  await sql`select id from cities where slug = ${CITY}`;
if (!city) throw new Error(`city "${CITY}" not found; run bun run db:migrate`);
try {
  const started = performance.now();
  const summary = await exportCity(city.id);
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`export: ${summary} (${secs}s)`);
} finally {
  await sql.close();
}
