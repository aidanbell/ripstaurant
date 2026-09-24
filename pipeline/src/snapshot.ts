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
import { unzipSync } from "fflate";
import { TORONTO_DATASETS } from "./datasets";
import type { BulkDataset, Row } from "./datasets";
import { insertIngest, pull } from "./ingest";
import { CITY, count, runJob } from "./job";
import type { RawStore } from "./storage";

const BATCH = 2000;

/** The CSVs in a pull: the file itself, or each CSV inside a ZIP, in name order. */
function csvFiles(bytes: Buffer, zip: boolean | undefined): [string, Buffer][] {
  if (!zip) return [["", bytes]];
  const entries = unzipSync(bytes, {
    filter: (file) => file.name.toLowerCase().endsWith(".csv"),
  });
  const names = Object.keys(entries).sort();
  if (!names.length) throw new Error("no CSV files in the ZIP");
  return names.map((name) => [name, Buffer.from(entries[name] ?? [])]);
}

/**
 * The 2020–2022 archive files are wrapped in one extra pair of quotes: they open with
 * `""Rec #"` and close with `"""`. Unwrapped, they parse like the other years.
 */
function unwrapQuotedFile(csv: Buffer): Buffer {
  const bom = csv.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? 3
    : 0;
  if (csv.subarray(bom, bom + 2).toString() !== '""') return csv;
  let end = csv.length;
  while (end > bom && /\s/.test(String.fromCharCode(csv[end - 1] ?? 0))) end--;
  if (csv.subarray(end - 3, end).toString() !== '"""')
    throw new Error("file opens with a stray quote but doesn't close with one");
  return csv.subarray(bom + 1, end - 1);
}

/** UTF-8 when the file is valid UTF-8; otherwise Windows-1252, which the 2023 archive is (ACADÉMIE, Café). */
function decode(csv: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(csv);
  } catch {
    return new TextDecoder("windows-1252").decode(csv);
  }
}

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
    dataset.zip ? "zip" : undefined,
  );
  const positional = dataset.positional ?? ["_id"];

  let rowCount = 0;
  const kept: Stored[] = [];
  for (const [file, csv] of csvFiles(pulled.bytes, dataset.zip)) {
    let first = true;
    const rows = parse(decode(unwrapQuotedFile(csv)), {
      columns: true,
      bom: true,
    }) as AsyncIterable<Row>;
    for await (const row of rows) {
      rowCount++;
      if (first) {
        first = false;
        const missing = dataset.columns.filter((c) => !(c in row));
        if (missing.length)
          throw new Error(
            `${file || "file"} is missing columns: ${missing.join(", ")}`,
          );
      }
      if (!dataset.keep(row)) continue;
      const fields = Object.fromEntries(
        Object.entries(row).filter(([column]) => !positional.includes(column)),
      );
      kept.push({
        source_key: dataset.key(fields),
        content_hash: new CryptoHasher("sha256")
          .update(JSON.stringify(fields))
          .digest(),
        raw_json: fields,
      });
    }
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
