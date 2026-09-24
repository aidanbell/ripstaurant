// Loads reference data: Toronto's neighbourhoods and Address Points. Every record's
// address is matched to an address point, which gives it coordinates and a neighbourhood.
//
//   bun run reference                          # both; raw files to data/raw/
//   bun run reference --only address_points
//   bun run reference --upload                 # raw files to S3_BUCKET (R2)
//
// Unlike the snapshot, these are current copies: rows are updated in place (only when
// they changed), and address points that leave the City's file get `removed_at`.

import type { TransactionSQL } from "bun";
import { sql } from "@ripstaurant/db";
import { parse } from "csv-parse";
import { z } from "zod";
import { addressPointKey } from "./address";
import type { Row } from "./datasets";
import { insertIngest, pull } from "./ingest";
import { CITY, count, runJob } from "./job";
import type { RawStore } from "./storage";

const BATCH = 5000;

const Neighbourhoods = z.object({
  features: z
    .array(
      z.object({
        properties: z.object({
          AREA_SHORT_CODE: z.string(),
          AREA_NAME: z.string(),
        }),
        geometry: z.object({ type: z.string() }).loose(),
      }),
    )
    .min(1),
});

const MultiPoint = z.object({
  coordinates: z.tuple([z.tuple([z.number(), z.number()])]).rest(z.unknown()),
});

const ADDRESS_COLUMNS = [
  "ADDRESS_POINT_ID",
  "LO_NUM",
  "LO_NUM_SUF",
  "LINEAR_NAME_FULL",
  "ADDRESS_FULL",
  "geometry",
];

/** Points in a neighbourhood's polygon get its id; only rows whose neighbourhood changed are written. */
async function assignNeighbourhoods(
  tx: TransactionSQL,
  cityId: string,
): Promise<number> {
  const result = await tx`
    update address_points ap
    set neighbourhood_id = n.id
    from neighbourhoods n
    where ap.city_id = ${cityId}
      and n.city_id = ${cityId}
      and ST_Contains(n.geom, ap.geom)
      and ap.neighbourhood_id is distinct from n.id
  `;
  return result.count;
}

async function loadNeighbourhoods(
  cityId: string,
  store: RawStore,
): Promise<string> {
  const pulled = await pull(
    store,
    CITY,
    "neighbourhoods",
    "neighbourhoods",
    "Neighbourhoods - 4326.geojson",
  );
  const { features } = Neighbourhoods.parse(
    JSON.parse(pulled.bytes.toString("utf8")),
  );

  const assigned = await sql.begin(async (tx) => {
    await insertIngest(tx, cityId, pulled, features.length, features.length);
    for (const { properties, geometry } of features) {
      await tx`
        insert into neighbourhoods (city_id, source_key, name, geom)
        values (
          ${cityId}, ${properties.AREA_SHORT_CODE}, ${properties.AREA_NAME},
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326))
        )
        on conflict (city_id, source_key) do update
        set name = excluded.name, geom = excluded.geom
      `;
    }
    return assignNeighbourhoods(tx, cityId);
  });
  return `${count(features.length)} neighbourhoods, ${count(assigned)} address points reassigned → ${pulled.rawKey}`;
}

type StagedPoint = {
  source_key: string;
  address: string;
  match_key: string;
  lng: number;
  lat: number;
};

async function loadAddressPoints(
  cityId: string,
  store: RawStore,
): Promise<string> {
  const pulled = await pull(
    store,
    CITY,
    "address_points",
    "address-points-municipal-toronto-one-address-repository",
    "Address Points - 4326.csv",
  );

  let rowCount = 0;
  const points: StagedPoint[] = [];
  const rows = parse(pulled.bytes, {
    columns: true,
    bom: true,
  }) as AsyncIterable<Row>;
  for await (const row of rows) {
    if (rowCount++ === 0) {
      const missing = ADDRESS_COLUMNS.filter((c) => !(c in row));
      if (missing.length)
        throw new Error(`missing columns: ${missing.join(", ")}`);
    }
    const key = addressPointKey(
      row.LO_NUM ?? "",
      row.LO_NUM_SUF ?? "",
      row.LINEAR_NAME_FULL ?? "",
    );
    // No usable house number (e.g. a park or a lot with number 0): nothing can match it.
    if (!key) continue;
    const [[lng, lat]] = MultiPoint.parse(
      JSON.parse(row.geometry ?? "null"),
    ).coordinates;
    points.push({
      source_key: row.ADDRESS_POINT_ID ?? "",
      address: row.ADDRESS_FULL ?? "",
      match_key: key,
      lng,
      lat,
    });
  }
  if (rowCount === 0) throw new Error(`no rows in ${pulled.url}`);

  const { changed, removed } = await sql.begin(async (tx) => {
    await insertIngest(tx, cityId, pulled, rowCount, points.length);
    await tx`
      create temp table staged_points (
        source_key text primary key,
        address text not null,
        match_key text not null,
        lng double precision not null,
        lat double precision not null
      ) on commit drop
    `;
    for (let i = 0; i < points.length; i += BATCH)
      await tx`insert into staged_points ${tx(points.slice(i, i + BATCH))}`;

    // The neighbourhood is set here rather than by a second update, so each row is
    // written once (an update leaves a dead copy of every row behind).
    const upsert = await tx`
      insert into address_points (city_id, source_key, address, match_key, geom, neighbourhood_id)
      select ${cityId}, s.source_key, s.address, s.match_key, p.geom,
             (select n.id from neighbourhoods n
              where n.city_id = ${cityId} and ST_Contains(n.geom, p.geom)
              order by n.id limit 1)
      from staged_points s
      cross join lateral (select ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326) as geom) p
      on conflict (city_id, source_key) do update
      set address = excluded.address,
          match_key = excluded.match_key,
          geom = excluded.geom,
          neighbourhood_id = excluded.neighbourhood_id,
          removed_at = null
      where address_points.address <> excluded.address
         or address_points.match_key <> excluded.match_key
         or not ST_Equals(address_points.geom, excluded.geom)
         or address_points.neighbourhood_id is distinct from excluded.neighbourhood_id
         or address_points.removed_at is not null
    `;
    const gone = await tx`
      update address_points ap
      set removed_at = now()
      where ap.city_id = ${cityId}
        and ap.removed_at is null
        and not exists (select 1 from staged_points s where s.source_key = ap.source_key)
    `;
    return { changed: upsert.count, removed: gone.count };
  });
  return `${count(rowCount)} rows, ${count(points.length)} with a house number, ${count(changed)} new or changed, ${count(removed)} removed → ${pulled.rawKey}`;
}

await runJob([
  { name: "neighbourhoods", run: loadNeighbourhoods },
  { name: "address_points", run: loadAddressPoints },
]);
