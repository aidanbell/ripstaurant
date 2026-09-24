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

| Source                     | Dataset                                            | Kept in `source_records`                                        |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `dinesafe`                 | DineSafe (current feed, from 2023-11)              | every row                                                       |
| `dinesafe_archive`         | DineSafe archive, 2001–2023 (a ZIP of yearly CSVs) | inspections from 2020 on (~89k of 396k)                         |
| `business_licences`        | Business licences and permits                      | food, nightclub and patio categories (~66k of 160k)             |
| `building_permits_active`  | Building permits: active                           | food-related use or description, or a demolition (~14k of 205k) |
| `building_permits_cleared` | Building permits: cleared since 2017               | same filter (~37k of 439k)                                      |
| `development_applications` | Development applications                           | every row                                                       |

Each pull of a dataset is:

1. The raw CSV, gzipped as downloaded, at `toronto/<source>/<fetched-at>.csv.gz`. Every row. Kept for **180 days** (an R2 lifecycle rule), for re-parsing and debugging recent pulls.
2. One `ingests` row: resource URL, fetch time, raw file key and sha256, row and kept counts.
3. `source_records` for kept rows whose content hasn't been stored before. An unchanged row isn't stored again, so later pulls add only what changed (a new inspection, a cancelled licence, a renamed establishment). This is the durable history, backed up with the rest of the database (see `db/README.md`).

Filters live in `src/datasets.ts`. Widening one means re-reading recent raw files, or refetching: licences, permits and development applications keep their own history, and DineSafe (whose rows age out of the City's feed) is kept whole. If the City renames a column a filter or key depends on, that dataset fails loudly rather than storing nothing.

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
bun run report             # parse failures, business types, match rates, most common misses
bun run report --misses 40
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

## Typed records

`src/records.ts` parses source_records rows into typed, validated records. A value a parser doesn't expect (a new inspection status, an unreadable date) throws, so a schema change shows up in `bun run report` instead of turning into bad data.

| Record       | From                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Inspection` | `inspectionFromCurrent`: the current DineSafe feed (camelCase columns, `YYYY-MM-DD`). `inspectionFromArchive`: the archive (`Establishment ID`…, `MM/DD/YYYY` dates in 2023). Current rows link to the archive by `oldEstId`                                            |
| `Licence`    | `licenceFromRow`. The type vocabulary changed with the 2020 bylaw: `VICTUALLING` / `REFRESHMENTS` / `FOODSTUFFS` before, `EATING/DRINKING` / `TAKE-OUT OR RETAIL FOOD` after. Both map to a business type, with seating conditions separating restaurants from take-out |

Business types map to the contract's `BusinessType`:

- **DineSafe** (`dinesafeBusinessType`): the archive's 58 establishment types. Institutions (schools, care homes, hospitals), production (plants, commissaries, caterers) and anything without a storefront (carts, trucks, boats) map to `null`: inspected, but not covered by the site. A type not in the list is reported as new.
- **Licences**: from category, endorsements and seating. Patio licences carry no type.

As of 2026-09-24, 66% of current DineSafe establishments get a type through the archive; the rest were first inspected after it (or aren't linked), and will take it from a matching licence in Phase 4.

**Archive quirks handled by the snapshot:** the 2020–2022 files are wrapped in an extra pair of quotes (`""Rec #"` … `"""`); the 2023 file is Windows-1252, not UTF-8 (`ACADÉMIE`, `Café`); `Rec #` is a row number, left out like `_id`.

## Entity resolution (Phase 4)

```sh
bun run resolve    # establishments, locations, occupancies, record_links; ~10 seconds
```

Rebuilds everything from `source_records` on each run, then writes it in place by stable keys (`establishments.source_key`, `locations.slug`), so ids survive re-runs and only what changed is written. An unchanged re-run writes nothing. Runs after the reference load in the Snapshot workflow.

1. **Locations:** each record's address + unit (`AddressMatcher`), slugged as in the contract (`tor-116-geary-ave-unit-108a`). The address point supplies coordinates and neighbourhood; a location is still its own address.
2. **DineSafe establishments:** ids linked by `oldEstId`, or sharing a location and a normalized name (`src/names.ts`), are one establishment, so a new DineSafe id after an ownership change still merges. Key: `dinesafe:<lowest id>`. Types the site doesn't cover are skipped.
3. **Licences:** attached to the establishment at the same address with the most similar name (≥ 0.5) and overlapping dates (±1 year). At the exact same unit, one shared distinctive word is enough (`KEZY FOODS` / `KEZY DONER`); generic food and cuisine words don't count, since the next business in a unit often shares one. A licence gives its establishment an opening date, a type fallback and the chain flag. An unmatched food licence active since 2020 is an establishment of its own (`licence:<number>`); patio licences never are. Licences cancelled before 2020 are left out.
4. **Cleanup:** untyped establishments with no licence whose name says institution or event booth (`SCHOOL`, `DAYCARE`, `- CNE 2025`) are skipped, since they need no business licence. An establishment's occupancies at the same street address that differ only by unit spelling (`Unit BLDG-MAIN FLOOR` / `Unit FLOOR`) fold into one.
5. **Chains:** a name at 3+ locations that's at 5+ or licensed with the `CHAIN` condition. Variants join a brand only if someone uses the bare name (`STARBUCKS COFFEE #13035` → `STARBUCKS`, but `LUCKY'S MEATS` stays apart from `LUCKY'S CHINESE RESTAURANT`).

As of 2026-09-24: 29,781 establishments (20k from DineSafe, 9.8k licence-only), 22,059 locations (104 without coordinates), 403 chains; 94% have a business type and 83% an opening date. Licence-only establishments are mostly real: licensed but not yet inspected, closed before the DineSafe window, or retailers in multi-tenant buildings.

**Known limit:** an establishment's key is its lowest merged DineSafe id. If new data merges two establishments (or splits one), the key changes and the establishment gets a new id.
