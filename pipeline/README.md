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
