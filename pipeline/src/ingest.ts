// The first half of every pull: download a dataset file, archive it, and record the
// pull as an `ingests` row. Used by the snapshot and reference jobs.

import { CryptoHasher, gzipSync } from "bun";
import type { TransactionSQL } from "bun";
import { resourceUrl, USER_AGENT } from "./ckan";
import type { RawStore } from "./storage";

export type Pulled = {
  source: string;
  url: string;
  fetchedAt: Date;
  bytes: Buffer;
  rawKey: string;
  rawSha256: string;
};

/**
 * Downloads a CKAN resource and archives it gzipped at `<city>/<source>/<fetched-at>.<ext>.gz`.
 * `ext` defaults to the resource name's ("Dinesafe.csv" → csv).
 */
export async function pull(
  store: RawStore,
  city: string,
  source: string,
  pkg: string,
  resource: string,
  ext = resource.split(".").at(-1)?.toLowerCase() ?? "bin",
): Promise<Pulled> {
  const url = await resourceUrl(pkg, resource);
  const fetchedAt = new Date();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  // A dropped connection can end the body early without an error, and a pull can't be
  // repeated for a past date. (With content-encoding, the length is compressed.)
  const expected = Number(res.headers.get("content-length"));
  if (
    expected &&
    !res.headers.has("content-encoding") &&
    bytes.length !== expected
  )
    throw new Error(
      `truncated download: ${bytes.length} of ${expected} bytes from ${url}`,
    );

  const rawKey = `${city}/${source}/${fetchedAt.toISOString().replaceAll(":", "-")}.${ext}.gz`;
  const rawSha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
  await store.write(rawKey, gzipSync(bytes));
  return { source, url, fetchedAt, bytes, rawKey, rawSha256 };
}

/** Records a pull; returns the ingest id. */
export async function insertIngest(
  tx: TransactionSQL,
  cityId: string,
  pulled: Pulled,
  rowCount: number,
  keptCount: number,
): Promise<string> {
  const [ingest]: { id: string }[] = await tx`
    insert into ingests (city_id, source, resource_url, fetched_at, raw_key, raw_sha256, row_count, kept_count)
    values (${cityId}, ${pulled.source}, ${pulled.url}, ${pulled.fetchedAt}, ${pulled.rawKey}, ${pulled.rawSha256}, ${rowCount}, ${keptCount})
    returning id
  `;
  if (!ingest) throw new Error("ingest insert returned no id");
  return ingest.id;
}
