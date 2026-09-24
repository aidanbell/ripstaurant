// Pulls each bulk dataset, archives the raw file, and stores its new or changed rows.
//
//   bun run snapshot                   # all datasets; raw files to data/raw/
//   bun run snapshot --only dinesafe   # one dataset
//   bun run snapshot --upload          # raw files to S3_BUCKET (R2); what the scheduled job runs
//
// Each dataset is one `ingests` row plus the source_records whose content hasn't been
// stored before. Raw files are `<city>/<source>/<fetched-at>.csv.gz`, gzipped as downloaded.

import { CryptoHasher } from "bun";
import { sql } from "@ripstaurant/db";
import { parse } from "csv-parse";
import { TORONTO_DATASETS } from "./datasets";
import type { BulkDataset, Row } from "./datasets";
import { insertIngest, pull } from "./ingest";
import { CITY, count, runJob } from "./job";
import type { RawStore } from "./storage";

const BATCH = 2000;

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
  const pulled = await pull(
    store,
    CITY,
    dataset.source,
    dataset.pkg,
    dataset.resource,
  );

  let rowCount = 0;
  const kept: Stored[] = [];
  const rows = parse(pulled.bytes, {
    columns: true,
    bom: true,
  }) as AsyncIterable<Row>;
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
  if (rowCount === 0) throw new Error(`no rows in ${pulled.url}`);

  const inserted = await sql.begin(async (tx) => {
    const ingestId = await insertIngest(
      tx,
      cityId,
      pulled,
      rowCount,
      kept.length,
    );
    let n = 0;
    for (let i = 0; i < kept.length; i += BATCH) {
      const batch = kept.slice(i, i + BATCH).map((r) => ({
        ...r,
        city_id: cityId,
        source: dataset.source,
        ingest_id: ingestId,
      }));
      const result =
        await tx`insert into source_records ${tx(batch)} on conflict do nothing`;
      n += result.count;
    }
    return n;
  });

  return `${count(rowCount)} rows, ${count(kept.length)} kept, ${count(inserted)} new → ${pulled.rawKey}`;
}

await runJob(
  TORONTO_DATASETS.map((dataset) => ({
    name: dataset.source,
    run: (cityId, store) => snapshot(cityId, dataset, store),
  })),
);
