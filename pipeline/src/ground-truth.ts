// The ground-truth sample (docs/data-gaps.md, step 1): published closures verified by
// hand, to measure each clean-up step by whether it was right, not just by how much it
// changed. Verdicts live in review_decisions, keyed by the published event id.
//
//   bun run ground-truth draw               # 100 random published end events → review_decisions
//                                           # + data/ground-truth/<sample>.csv to fill in
//   bun run ground-truth import <file.csv>  # verdicts from the filled-in CSV
//   bun run ground-truth score              # the sample against the current export
//
//   --sample <name>  default ground-truth-2026-09
//   --size <n>       draw only; default 100
//   --dir <path>     the export to read; default web/public/data
//
// Draw and score read the export, not the database: the sample is of what the site shows.

import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  CityList,
  DEFAULT_VISIBLE_TYPES,
  MANIFEST_PATH,
  Manifest,
} from "@ripstaurant/contract";
import type { ClosureRow, DateRange } from "@ripstaurant/contract";
import { sql } from "@ripstaurant/db";
import { CITY, count } from "./job";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sample: { type: "string", default: "ground-truth-2026-09" },
    size: { type: "string", default: "100" },
    dir: { type: "string", default: "web/public/data" },
    remote: { type: "boolean", default: false },
  },
});
const [command, file] = positionals;

const COLUMNS = [
  "event_id",
  "name",
  "address",
  "type",
  "closed_between",
  "search",
  "verdict",
  "closed_month",
  "source_url",
  "note",
] as const;

const Verdict = z.enum(["closed", "open", "not_a_closure"]);
const CsvRow = z
  .object({
    event_id: z.string().min(1),
    verdict: z.union([Verdict, z.literal("")]),
    closed_month: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal("")]),
    source_url: z.union([z.url(), z.literal("")]),
    note: z.string(),
  })
  .refine(
    (r) => r.closed_month === "" || r.verdict === "closed",
    "closed_month needs verdict closed",
  );

async function publishedRows(): Promise<Map<string, ClosureRow>> {
  const manifest = Manifest.parse(
    await Bun.file(`${args.dir}/${MANIFEST_PATH}`).json(),
  );
  const city = manifest.cities.find((c) => c.slug === CITY);
  if (!city) throw new Error(`${CITY} isn't in ${args.dir}/${MANIFEST_PATH}`);
  const list = CityList.parse(
    await Bun.file(`${args.dir}/${city.list}`).json(),
  );
  return new Map(list.closures.map((row) => [row.id, row]));
}

function isEnd(row: ClosureRow): boolean {
  return DEFAULT_VISIBLE_TYPES.includes(row.type);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function describe([from, to]: DateRange): string {
  return `${from ?? "?"} – ${to ?? "?"}`;
}

async function draw(cityId: string): Promise<void> {
  const [existing]: { n: number }[] = await sql`
    select count(*)::int as n from review_decisions
    where city_id = ${cityId} and sample = ${args.sample}
  `;
  if (existing?.n)
    throw new Error(
      `sample ${args.sample} already has ${existing.n} rows; pick another --sample`,
    );

  const rows = [...(await publishedRows()).values()].filter(isEnd);
  // Fisher–Yates, then take the first n.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  const picked = rows.slice(0, Number(args.size));

  await sql`
    insert into review_decisions ${sql(
      picked.map((row) => ({
        city_id: cityId,
        event_id: row.id,
        sample: args.sample,
        published: row,
      })),
    )}
  `;

  const lines = [
    COLUMNS.join(","),
    ...picked.map((row) =>
      [
        row.id,
        row.name,
        row.addr,
        row.type,
        describe(row.d),
        `https://www.google.com/search?q=${encodeURIComponent(`"${row.name}" ${row.addr} Toronto`)}`,
        "",
        "",
        "",
        "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  await mkdir("data/ground-truth", { recursive: true });
  const out = `data/ground-truth/${args.sample}.csv`;
  await Bun.write(out, `${lines.join("\n")}\n`);
  console.log(
    `drew ${count(picked.length)} of ${count(rows.length)} end events → ${out}`,
  );
}

async function importCsv(cityId: string): Promise<void> {
  if (!file) throw new Error("usage: bun run ground-truth import <file.csv>");
  const records: unknown[] = parse(await Bun.file(file).text(), {
    columns: true,
    skip_empty_lines: true,
  });
  let updated = 0;
  let pending = 0;
  for (const [i, record] of records.entries()) {
    const result = CsvRow.safeParse(record);
    if (!result.success)
      throw new Error(`row ${i + 2}: ${result.error.issues[0]?.message}`);
    const r = result.data;
    if (!r.verdict) {
      pending++;
      continue;
    }
    const rows = await sql`
      update review_decisions
      set verdict = ${r.verdict},
          closed_month = ${r.closed_month ? `${r.closed_month}-01` : null},
          source_url = ${r.source_url || null},
          note = ${r.note || null},
          reviewed_at = coalesce(reviewed_at, now())
      where city_id = ${cityId} and sample = ${args.sample} and event_id = ${r.event_id}
      returning id
    `;
    if (!rows.length)
      throw new Error(
        `row ${i + 2}: ${r.event_id} isn't in sample ${args.sample}`,
      );
    updated++;
  }
  console.log(
    `${count(updated)} verdicts imported, ${count(pending)} still pending`,
  );
}

/** Whether the range could contain the month (`2024-03-01`). */
function contains([from, to]: DateRange, month: string): boolean {
  const monthEnd = `${month.slice(0, 7)}-31`;
  return (from === null || from <= monthEnd) && (to === null || to >= month);
}

function monthPrecise([from, to]: DateRange): boolean {
  return from !== null && to !== null && from.slice(0, 7) === to.slice(0, 7);
}

function pct(n: number, of: number): string {
  return of ? `${Math.round((100 * n) / of)}%` : "–";
}

async function score(cityId: string): Promise<void> {
  const decisions: {
    event_id: string;
    published: ClosureRow;
    verdict: z.infer<typeof Verdict> | null;
    closed_month: string | null;
  }[] = await sql`
    select event_id, published, verdict, closed_month::text
    from review_decisions
    where city_id = ${cityId} and sample = ${args.sample}
  `;
  if (!decisions.length) throw new Error(`no sample ${args.sample}`);
  const current = await publishedRows();
  const reviewed = decisions.filter((d) => d.verdict !== null);
  console.log(
    `${args.sample}: ${count(reviewed.length)} of ${count(decisions.length)} reviewed`,
  );

  // Removed = no longer published. Right: false closures removed, real ones kept.
  console.log("\nverdict        now published  removed");
  for (const verdict of Verdict.options) {
    const group = reviewed.filter((d) => d.verdict === verdict);
    const kept = group.filter((d) => current.has(d.event_id)).length;
    console.log(
      `${verdict.padEnd(14)} ${String(kept).padStart(13)}  ${String(group.length - kept).padStart(7)}`,
    );
  }

  const falseRate = (published: (d: (typeof reviewed)[number]) => boolean) => {
    const shown = reviewed.filter(published);
    return pct(
      shown.filter((d) => d.verdict !== "closed").length,
      shown.length,
    );
  };
  console.log(
    `\nfalse closures among published: ${falseRate(() => true)} when drawn, ${falseRate((d) => current.has(d.event_id))} now`,
  );

  // Dates: closed events with a known month that are still published.
  const dated = reviewed.filter(
    (d) => d.closed_month !== null && current.has(d.event_id),
  );
  const tally = (range: (d: (typeof dated)[number]) => DateRange) => {
    const hits = dated.filter((d) => contains(range(d), d.closed_month!));
    const precise = dated.filter((d) => monthPrecise(range(d)));
    return `range contains the month ${pct(hits.length, dated.length)}, month-precise ${pct(precise.length, dated.length)}`;
  };
  console.log(`\n${count(dated.length)} closed with a known month:`);
  console.log(`  when drawn: ${tally((d) => d.published.d)}`);
  console.log(`  now:        ${tally((d) => current.get(d.event_id)!.d)}`);
}

const [city]: { id: string }[] =
  await sql`select id from cities where slug = ${CITY}`;
if (!city) throw new Error(`city "${CITY}" not found; run bun run db:migrate`);
try {
  if (command === "draw") await draw(city.id);
  else if (command === "import") await importCsv(city.id);
  else if (command === "score") await score(city.id);
  else
    throw new Error(
      "usage: bun run ground-truth draw | import <file.csv> | score",
    );
} finally {
  await sql.close();
}
