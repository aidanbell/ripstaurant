// Builds sample export files for frontend development.
//
//   bun run sample                     # curated Toronto sample → contract/sample/ (committed)
//   bun run sample:synthetic           # 10,000 synthetic rows → contract/sample-synthetic/ (git-ignored)
//   bun contract/scripts/build-sample.ts --synthetic 50000
//
// Output mirrors the real export layout, so the frontend can serve either directory as-is:
//   manifest.json
//   toronto/closures.<hash>.json
//   toronto/locations/<id>.json      (curated sample only)

import { mkdir, rm } from "node:fs/promises";
import { gzipSync } from "bun";
import {
  CONTRACT_VERSION,
  CityList,
  DEFAULT_VISIBLE_TYPES,
  EventType,
  LocationDetail,
  Manifest,
  ReasonCode,
  BusinessType,
  eventId,
  listPath,
  locationPath,
  MANIFEST_PATH,
  roundCoord,
  rowsFromLocation,
  sortDate,
  type City,
  type ClosureRow,
} from "../src";
import { TORONTO_FIXTURE, type FixtureLocation } from "../fixtures/toronto";
import { TORONTO_NEIGHBOURHOODS } from "../fixtures/toronto-neighbourhoods";

const here = new URL("..", import.meta.url).pathname;
const TORONTO: City = { slug: "toronto", name: "Toronto", center: [-79.3832, 43.6532], bbox: [-79.6393, 43.581, -79.1153, 43.8555] };
// Fixed so the committed sample (and its hash) only changes when the fixture does.
const GENERATED = "2026-09-23T00:00:00.000Z";
const SINCE = "2022-03-01";

/** Resolve source keys to indices, keeping only sources that are referenced. */
function toDetail(f: FixtureLocation): LocationDetail {
  const keys: string[] = [];
  const ref = (key: string) => {
    if (!(key in f.sources)) throw new Error(`${f.id}: unknown source "${key}"`);
    const i = keys.indexOf(key);
    return i === -1 ? keys.push(key) - 1 : i;
  };
  const occupants = f.occupants.map((o) => ({
    ...o,
    src: o.src.map(ref),
    event: o.event && {
      ...o.event,
      id: eventId(f.id, o.name),
      reasons: o.event.reasons.map((r) => ({ ...r, src: r.src.map(ref) })),
      evidence: o.event.evidence.map((e) => ({ ...e, src: ref(e.src) })),
    },
  }));
  return LocationDetail.parse({
    v: CONTRACT_VERSION,
    id: f.id,
    city: TORONTO.slug,
    addr: f.addr,
    ll: [roundCoord(f.ll[0]), roundCoord(f.ll[1])],
    hood: f.hood,
    occupants,
    sources: keys.map((k) => f.sources[k]),
  });
}

/** Announced-without-a-date first, then newest first. */
function byNewest(a: ClosureRow, b: ClosureRow): number {
  const da = sortDate(a.d) ?? "9999";
  const db = sortDate(b.d) ?? "9999";
  return db.localeCompare(da) || a.name.localeCompare(b.name);
}

function syntheticRows(n: number): ClosureRow[] {
  // Deterministic PRNG so repeated runs produce the same file.
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const [w, s, e, nn] = TORONTO.bbox;
  const streets = ["Queen St W", "Queen St E", "King St W", "Dundas St W", "College St", "Bloor St W", "Danforth Ave", "Yonge St", "Ossington Ave", "Roncesvalles Ave", "Gerrard St E", "St Clair Ave W"];
  const words = ["Golden", "Little", "Blue", "Maple", "Corner", "Harbour", "Lucky", "Red", "Garden", "Old", "Urban", "Sunny"];
  const kinds = ["Kitchen", "Pizza", "Noodle Bar", "Cafe", "Grill", "Bakery", "Taqueria", "Sushi", "Diner", "Bistro", "Pho", "Shawarma"];
  const start = Date.parse(SINCE);
  const span = Date.parse(GENERATED) - start;
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(start + rand() * span).toISOString().slice(0, 10);
    const street = pick(streets);
    const row: ClosureRow = {
      id: `syn-${i}`,
      loc: `syn-loc-${i}`,
      name: `${pick(words)} ${pick(kinds)} ${i}`,
      addr: `${1 + Math.floor(rand() * 2999)} ${street}`,
      hood: Math.floor(rand() * TORONTO_NEIGHBOURHOODS.length),
      ll: [roundCoord(w + rand() * (e - w)), roundCoord(s + rand() * (nn - s))],
      type: rand() < 0.85 ? pick(DEFAULT_VISIBLE_TYPES) : pick(EventType.options),
      status: "closed",
      d: rand() < 0.5 ? [date, date] : [null, date],
      bt: pick(BusinessType.options),
      rs: rand() < 0.6 ? [] : [pick(ReasonCode.options.filter((c) => c !== "unknown"))],
    };
    if (rand() < 0.3) row.yrs = 1 + Math.floor(rand() * 40);
    if (rand() < 0.15) row.chain = true;
    if (rand() < 0.4) row.next = `${pick(words)} ${pick(kinds)}`;
    return row;
  });
}

async function write(dir: string, rel: string, data: unknown) {
  const path = `${dir}/${rel}`;
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const text = JSON.stringify(data, null, 2) + "\n";
  await Bun.write(path, text);
  return text;
}

function hash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 8);
}

async function build(outDir: string, rows: ClosureRow[], details: LocationDetail[]) {
  await rm(outDir, { recursive: true, force: true });

  const list = CityList.parse({
    v: CONTRACT_VERSION,
    city: TORONTO,
    generated: GENERATED,
    since: SINCE,
    hoods: [...TORONTO_NEIGHBOURHOODS],
    closures: [...rows].sort(byNewest),
  });
  const listText = JSON.stringify(list, null, 2) + "\n";
  const listRel = listPath(TORONTO.slug, hash(listText));
  await mkdir(`${outDir}/${TORONTO.slug}`, { recursive: true });
  await Bun.write(`${outDir}/${listRel}`, listText);

  for (const d of details) await write(outDir, locationPath(TORONTO.slug, d.id), d);

  await write(outDir, MANIFEST_PATH, Manifest.parse({
    v: CONTRACT_VERSION,
    generated: GENERATED,
    cities: [{ slug: TORONTO.slug, name: TORONTO.name, list: listRel, count: list.closures.length }],
  }));

  const minified = JSON.stringify(list);
  console.log(`${outDir.replace(here, "contract/")}`);
  console.log(`  ${list.closures.length} closures, ${details.length} location files`);
  console.log(`  ${listRel}: ${(minified.length / 1024).toFixed(0)} KB minified, ${(gzipSync(minified).length / 1024).toFixed(0)} KB gzipped`);
}

const syntheticArg = process.argv.indexOf("--synthetic");
if (syntheticArg > 0) {
  const n = Number(process.argv[syntheticArg + 1] ?? 10_000);
  await build(`${here}sample-synthetic`, syntheticRows(n), []);
} else {
  const details = TORONTO_FIXTURE.map(toDetail);
  const rows = details.flatMap((d) => rowsFromLocation(d, TORONTO_NEIGHBOURHOODS));
  // Every relocation target must have its own detail file.
  for (const d of details)
    for (const o of d.occupants)
      if (o.event?.next?.loc && !details.some((x) => x.id === o.event!.next!.loc))
        throw new Error(`${d.id}: next.loc ${o.event.next.loc} has no detail file`);
  await build(`${here}sample`, rows, details);
}
