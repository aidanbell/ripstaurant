// How well each dataset's addresses match Address Points. Run after changing address.ts.
//
//   bun run address:report            # every dataset in the local DB
//   bun run address:report --misses 40
//
// Counts distinct addresses (a DineSafe address repeats across inspections), and lists
// the most common misses so the normalizer can be tuned against them.

import { parseArgs } from "node:util";
import { sql } from "@ripstaurant/db";
import { AddressMatcher } from "./address";
import type { MatchMethod } from "./address";
import { TORONTO_DATASETS } from "./datasets";
import type { Row } from "./datasets";
import { CITY, count } from "./job";

const { values: args } = parseArgs({
  options: {
    misses: { type: "string", default: "15" },
    remote: { type: "boolean", default: false },
  },
});

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

function pct(n: number, of: number): string {
  return `${((100 * n) / Math.max(of, 1)).toFixed(1)}%`;
}

for (const dataset of TORONTO_DATASETS) {
  const rows: { raw_json: Row }[] =
    await sql`select raw_json from source_records where source = ${dataset.source}`;
  // Per distinct address, its best outcome across records.
  const outcomes = new Map<string, Outcome>();
  for (const { raw_json: row } of rows) {
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

  const tally = new Map<Outcome, number>();
  for (const outcome of outcomes.values())
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
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
    .slice(0, Number(args.misses));
  for (const miss of misses) console.log(`    ${miss}`);
}

await sql.close();
