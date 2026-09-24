// How well source_records normalize: whether rows parse into typed records (records.ts),
// how many establishments get a business type, and how addresses match Address Points
// (address.ts). Run after changing either, or after a schema change.
//
//   bun run report                # every dataset in the local DB
//   bun run report --misses 40    # more sample failures and misses per dataset
//
// Address outcomes count distinct addresses (a DineSafe address repeats across
// inspections); the most common misses are listed so the normalizer can be tuned.

import { parseArgs } from "node:util";
import { sql } from "@ripstaurant/db";
import type { BusinessType } from "@ripstaurant/contract";
import { AddressMatcher } from "./address";
import type { MatchMethod } from "./address";
import { TORONTO_DATASETS } from "./datasets";
import type { Row } from "./datasets";
import { CITY, count } from "./job";
import {
  dinesafeBusinessType,
  inspectionFromArchive,
  inspectionFromCurrent,
  licenceFromRow,
} from "./records";
import type { Inspection, Licence } from "./records";

const { values: args } = parseArgs({
  options: {
    misses: { type: "string", default: "15" },
    remote: { type: "boolean", default: false },
  },
});
const SAMPLES = Number(args.misses);

function pct(n: number, of: number): string {
  return `${((100 * n) / Math.max(of, 1)).toFixed(1)}%`;
}

/** "estName: too small" from a ZodError; the message from anything else. */
function reason(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path: unknown[]; message: string }[] })
      .issues;
    return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function tallyOf<K>(items: Iterable<K>): Map<K, number> {
  const tally = new Map<K, number>();
  for (const item of items) tally.set(item, (tally.get(item) ?? 0) + 1);
  return tally;
}

function top<K>(tally: Map<K, number>, n: number): [K, number][] {
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const PARSERS: Partial<Record<string, (row: Row) => Inspection | Licence>> = {
  dinesafe: inspectionFromCurrent,
  dinesafe_archive: inspectionFromArchive,
  business_licences: licenceFromRow,
};

const rowsBySource = new Map<string, Row[]>();
for (const dataset of TORONTO_DATASETS) {
  const rows: { raw_json: Row }[] =
    await sql`select raw_json from source_records where source = ${dataset.source}`;
  rowsBySource.set(
    dataset.source,
    rows.map((r) => r.raw_json),
  );
}

// Records ------------------------------------------------------------------------------

console.log("RECORDS");
const inspections = new Map<string, Inspection[]>();
for (const [source, parser] of Object.entries(PARSERS)) {
  if (!parser) continue;
  const rows = rowsBySource.get(source) ?? [];
  const parsed: (Inspection | Licence)[] = [];
  const failures = new Map<string, number>();
  for (const row of rows) {
    try {
      parsed.push(parser(row));
    } catch (error) {
      const why = reason(error);
      failures.set(why, (failures.get(why) ?? 0) + 1);
    }
  }
  const failed = rows.length - parsed.length;
  console.log(
    `\n${source}: ${count(parsed.length)} of ${count(rows.length)} rows parse` +
      (failed ? ` (${count(failed)} fail, ${pct(failed, rows.length)})` : ""),
  );
  for (const [why, n] of top(failures, SAMPLES))
    console.log(`    ${count(n)} × ${why}`);

  const records = parsed.filter((r): r is Inspection => "establishmentId" in r);
  if (records.length) inspections.set(source, records);
  const licences = parsed.filter((r): r is Licence => "number" in r);
  if (licences.length) {
    const types = tallyOf(licences.map((l) => l.businessType ?? "none"));
    console.log(
      "  business type: " +
        top(types, 10)
          .map(([t, n]) => `${t} ${pct(n, licences.length)}`)
          .join(" · "),
    );
  }
}

// Business type for DineSafe establishments: the archive has it, the current feed links
// to the archive by oldEstId.
const archiveTypes = new Map<string, string>();
for (const i of inspections.get("dinesafe_archive") ?? [])
  if (i.establishmentType)
    archiveTypes.set(i.establishmentId, i.establishmentType);

const unknownTypes = tallyOf(
  [...new Set(archiveTypes.values())].filter(
    (t) => dinesafeBusinessType(t) === undefined,
  ),
);
if (unknownTypes.size)
  console.log(
    `\n  archive types not in DINESAFE_TYPES (add them): ${[...unknownTypes.keys()].join(", ")}`,
  );

const current = new Map<string, string | null>();
for (const i of inspections.get("dinesafe") ?? [])
  current.set(i.establishmentId, i.archiveId);
if (current.size) {
  const outcomes = tallyOf(
    [...current.values()].map((archiveId) => {
      const type = archiveId ? archiveTypes.get(archiveId) : undefined;
      if (!type) return "no type (not in archive since 2020)";
      const bt: BusinessType | null | undefined = dinesafeBusinessType(type);
      if (bt === undefined) return "unknown type";
      return bt ?? "not covered (institution, plant, cart…)";
    }),
  );
  console.log(
    `\n  current DineSafe establishments (${count(current.size)}) by archive type:`,
  );
  for (const [outcome, n] of top(outcomes, 20))
    console.log(`    ${pct(n, current.size).padStart(6)}  ${outcome}`);
}

// Addresses ----------------------------------------------------------------------------

console.log("\nADDRESSES");
const points: {
  id: string;
  source_key: string;
  match_key: string;
  lng: number;
  lat: number;
}[] = await sql`
    select ap.id, ap.source_key, ap.match_key, ST_X(ap.geom) as lng, ST_Y(ap.geom) as lat
    from address_points ap join cities c on c.id = ap.city_id
    where c.slug = ${CITY} and ap.removed_at is null
    order by ap.id
  `;
if (!points.length)
  throw new Error("no address points; run bun run reference first");
const matcher = new AddressMatcher(points);

type Outcome = MatchMethod | "ambiguous" | "miss" | "unparsed";
const OUTCOMES: Outcome[] = [
  "id",
  "exact",
  "unit_trimmed",
  "suffix_dropped",
  "nearby",
  "ambiguous",
  "miss",
  "unparsed",
];

for (const dataset of TORONTO_DATASETS) {
  const rows = rowsBySource.get(dataset.source) ?? [];
  // Per distinct address, its best outcome across records.
  const outcomes = new Map<string, Outcome>();
  for (const row of rows) {
    const parsed = dataset.address(row);
    const label =
      parsed?.key ??
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row).filter(([k]) => /addr|street/i.test(k)),
        ),
      );
    const match = matcher.match(
      parsed,
      dataset.addressPointId?.(row),
      dataset.near?.(row),
    );
    let outcome: Outcome = match?.method ?? "miss";
    if (!match && !parsed) outcome = "unparsed";
    const previous = outcomes.get(label);
    if (!previous || OUTCOMES.indexOf(outcome) < OUTCOMES.indexOf(previous))
      outcomes.set(label, outcome);
  }

  const tally = tallyOf(outcomes.values());
  const total = outcomes.size;
  const matched =
    total -
    (tally.get("ambiguous") ?? 0) -
    (tally.get("miss") ?? 0) -
    (tally.get("unparsed") ?? 0);
  console.log(
    `\n${dataset.source}: ${count(total)} distinct addresses from ${count(rows.length)} records, ${pct(matched, total)} matched`,
  );
  console.log(
    "  " +
      OUTCOMES.filter((o) => tally.has(o))
        .map((o) => `${o} ${pct(tally.get(o) ?? 0, total)}`)
        .join(" · "),
  );
  const misses = [...outcomes]
    .filter(([, o]) => o === "miss" || o === "unparsed")
    .map(([label, o]) => `${o === "unparsed" ? "?" : " "} ${label}`)
    .slice(0, SAMPLES);
  for (const miss of misses) console.log(`    ${miss}`);
}

await sql.close();
