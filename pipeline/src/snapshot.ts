// Pulls each bulk dataset, archives the raw file, and stores its new or changed rows.
//
//   bun run snapshot                   # all datasets; raw files to data/raw/
//   bun run snapshot --only dinesafe   # one dataset
//   bun run snapshot --upload          # raw files to S3_BUCKET (R2); what the scheduled job runs
//
// Each dataset is one `ingests` row plus the source_records whose content hasn't been
// stored before. Raw files are `<city>/<source>/<fetched-at>.csv.gz`, gzipped as downloaded.
// A failing dataset doesn't stop the others; the job exits non-zero if any failed.

import { parseArgs } from "node:util";
import { CryptoHasher, gzipSync } from "bun";
import { sql } from "@ripstaurant/db";
import { parse } from "csv-parse";
import { resourceUrl, USER_AGENT } from "./ckan";
import { TORONTO_DATASETS } from "./datasets";
import type { BulkDataset, Row } from "./datasets";
import { bucketStore, localStore } from "./storage";
import type { RawStore } from "./storage";

const CITY = "toronto";
const BATCH = 2000;

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    upload: { type: "boolean", default: false },
    // Read by @ripstaurant/db to allow a non-local database.
    remote: { type: "boolean", default: false },
  },
});

type Stored = {
  source_key: string;
  content_hash: Buffer;
  raw_json: Row;
};

async function snapshot(
  cityId: string,
  dataset: BulkDataset,
  store: RawStore,
): Promise<string> {
  const url = await resourceUrl(dataset.pkg, dataset.resource);
  const fetchedAt = new Date();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const rawKey = `${CITY}/${dataset.source}/${fetchedAt.toISOString().replaceAll(":", "-")}.csv.gz`;
  const rawSha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
  await store.write(rawKey, gzipSync(bytes));

  let rowCount = 0;
  const kept: Stored[] = [];
  const rows = parse(bytes, { columns: true, bom: true }) as AsyncIterable<Row>;
  for await (const row of rows) {
    if (rowCount++ === 0) {
      const missing = dataset.columns.filter((c) => !(c in row));
      if (missing.length)
        throw new Error(`missing columns: ${missing.join(", ")}`);
    }
    if (!dataset.keep(row)) continue;
    // `_id` is the row's position in this file, so it would make every row look new.
    const { _id, ...fields } = row;
    kept.push({
      source_key: dataset.key(fields),
      content_hash: new CryptoHasher("sha256")
        .update(JSON.stringify(fields))
        .digest(),
      raw_json: fields,
    });
  }
  if (rowCount === 0) throw new Error(`no rows in ${url}`);

  const inserted = await sql.begin(async (tx) => {
    const [ingest]: { id: string }[] = await tx`
      insert into ingests (city_id, source, resource_url, fetched_at, raw_key, raw_sha256, row_count, kept_count)
      values (${cityId}, ${dataset.source}, ${url}, ${fetchedAt}, ${rawKey}, ${rawSha256}, ${rowCount}, ${kept.length})
      returning id
    `;
    let count = 0;
    for (let i = 0; i < kept.length; i += BATCH) {
      const batch = kept.slice(i, i + BATCH).map((r) => ({
        ...r,
        city_id: cityId,
        source: dataset.source,
        ingest_id: ingest?.id,
      }));
      const result =
        await tx`insert into source_records ${tx(batch)} on conflict do nothing`;
      count += result.count;
    }
    return count;
  });

  const n = (x: number) => x.toLocaleString("en-CA");
  return `${n(rowCount)} rows, ${n(kept.length)} kept, ${n(inserted)} new → ${rawKey}`;
}

const datasets = args.only
  ? TORONTO_DATASETS.filter((d) => d.source === args.only)
  : TORONTO_DATASETS;
if (!datasets.length) throw new Error(`unknown dataset "${args.only}"`);

const store = args.upload ? bucketStore() : localStore();
const [city]: { id: string }[] =
  await sql`select id from cities where slug = ${CITY}`;
if (!city) throw new Error(`city "${CITY}" not found; run bun run db:migrate`);

console.log(`raw files → ${store.name}`);
for (const dataset of datasets) {
  const started = performance.now();
  try {
    const summary = await snapshot(city.id, dataset, store);
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    console.log(`${dataset.source}: ${summary} (${secs}s)`);
  } catch (error) {
    console.error(`${dataset.source}: FAILED`, error);
    process.exitCode = 1;
  }
}
await sql.close();
