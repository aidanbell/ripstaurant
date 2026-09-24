# @ripstaurant/pipeline

Scheduled jobs that build the dataset. Bun + TypeScript, writing to Postgres through `@ripstaurant/db`.

## Snapshot (Phase 2)

Pulls Toronto's bulk open datasets, archives each raw file, and stores the new or changed rows.

```sh
bun run snapshot                   # all datasets; raw files to data/raw/ (git-ignored)
bun run snapshot --only dinesafe   # one dataset
bun run snapshot --upload          # raw files to R2 instead (needs S3_* in the environment)
```

Runs on the 1st and 15th of each month from `.github/workflows/snapshot.yml` (or by hand from the Actions tab), with `--upload`.

| Source                     | Dataset                               | Kept in `source_records`                                        |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `dinesafe`                 | DineSafe (current feed, from 2023-11) | every row                                                       |
| `business_licences`        | Business licences and permits         | food, nightclub and patio categories (~66k of 160k)             |
| `building_permits_active`  | Building permits: active              | food-related use or description, or a demolition (~14k of 205k) |
| `building_permits_cleared` | Building permits: cleared since 2017  | same filter (~37k of 439k)                                      |
| `development_applications` | Development applications              | every row                                                       |

Each pull of a dataset is:

1. The raw CSV, gzipped as downloaded, at `toronto/<source>/<fetched-at>.csv.gz`. Every row, always.
2. One `ingests` row: resource URL, fetch time, raw file key and sha256, row and kept counts.
3. `source_records` for kept rows whose content hasn't been stored before. An unchanged row isn't stored again, so later pulls add only what changed (a new inspection, a cancelled licence, a renamed establishment).

Filters live in `src/datasets.ts`. Widening one means re-reading archived raw files, not refetching. If the City renames a column a filter or key depends on, that dataset fails loudly rather than storing nothing.

A full run takes about 20 seconds and 1.4 GB of memory. The first load is ~260k rows (~280 MB in Postgres) and ~130 MB of raw files.

## Reference data (Phase 3)

```sh
bun run reference                          # neighbourhoods + Address Points; raw files to data/raw/
bun run reference --only address_points
bun run reference --upload                 # raw files to R2; runs after the snapshot in the same workflow
```

Loads the City's 158 neighbourhoods and ~525k Address Points into `neighbourhoods` and `address_points`. Unlike the snapshot these are current copies: a row is written only when it changed, and an address point that leaves the City's file gets `removed_at` rather than being deleted, since locations point at it. Each point gets its neighbourhood by point-in-polygon. Raw files are archived and recorded in `ingests` like any other pull. A full load takes ~40 seconds; an unchanged one writes nothing.

## Address matching

`src/address.ts` turns each dataset's address format into one normalized key (`429A YONGE ST`, `650 1/2 QUEEN ST W`) plus a unit (`Unit-108A`, `#108A` → `108A`). Address Points go through the same normalization, so both sides of a match agree on ambiguous words. Each dataset's parser is set in `src/datasets.ts` (`address`, and `addressPointId` / `near` where the dataset has them).

`AddressMatcher` tries, strongest first, and reports which one worked:

| Method           | When                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | The dataset carries the Address Point id itself (permits' `GEO_ID`)                                                                                                 |
| `exact`          | The normalized address is a point                                                                                                                                   |
| `unit_trimmed`   | Text after a known street name is unit text (`FRONT ST W CN`, `WESTMORE DR W2`)                                                                                     |
| `suffix_dropped` | `1718A` isn't a point but `1718` is                                                                                                                                 |
| `nearby`         | The number isn't a point; the closest one on the same side within 10 numbers is (219 → 217)                                                                         |
| `ambiguous`      | The address exists in two places (street names shared by former municipalities) and the record has no coordinates to choose by. Left unresolved rather than guessed |

When an address has several points (a building's land, structure and entrance points, or two same-named streets), the one nearest the record's own coordinates wins; DineSafe has coordinates. A `nearby` match gives a location coordinates and a neighbourhood, but a location is still identified by its own address, so 219 and 217 stay separate places.

```sh
bun run address:report             # match rates per dataset, most common misses
bun run address:report --misses 40
```

As of 2026-09-24 (distinct addresses):

| Dataset                   | Matched | Of which `nearby` | Ambiguous |
| ------------------------- | ------- | ----------------- | --------- |
| DineSafe                  | 99.1%   | 1.6%              | 0%        |
| Business licences         | 98.0%   | 3.9%              | 0.4%      |
| Building permits: active  | 99.5%   | 1.0%              | 0.0%      |
| Building permits: cleared | 99.0%   | 3.7%              | 0.1%      |
| Development applications  | 96.6%   | 6.5%              | 0.5%      |

Checked against DineSafe's own coordinates: exact matches are a median 1 m away, `nearby` 21 m. The remaining misses are mostly large sites with no point nearby, streets newer than the Address Points file, typos, and permits with street number 0.
