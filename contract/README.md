# @ripstaurant/contract

The format of the site's data files, defined once and shared by the pipeline (which writes them) and the frontend (which reads them). Zod schemas give runtime validation; TypeScript types come from the same definitions.

```ts
import {
  CityList,
  LocationDetail,
  Manifest,
  type ClosureRow,
} from "@ripstaurant/contract";
```

## Files

```
manifest.json                         always fetched fresh; points at each city's current list
toronto/closures.<hash>.json          one per city, loaded once; content-hashed, cache forever
toronto/locations/<location-id>.json  one per location, fetched when a location is opened
```

**Loading data in the frontend:**

1. Fetch `manifest.json` and pick the city.
2. Fetch the city's `list` path. It drives the map, list, filters and search.
3. When someone opens a closure, fetch `locationPath(city, row.loc)` for the full history and sources.

## List file (`CityList`)

One compact row per closure event (`ClosureRow`):

| Field                  | Meaning                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | Event id, stable across exports (`tor-176-dupont-st~big-crow`)                                                                                                      |
| `loc`                  | Location id; several rows can share one (two restaurants closed at 176 Dupont)                                                                                      |
| `name`, `addr`         | Display name and address                                                                                                                                            |
| `hood`                 | Index into the file's `hoods` array (158 Toronto neighbourhoods)                                                                                                    |
| `ll`                   | `[longitude, latitude]`, the order MapLibre expects                                                                                                                 |
| `type`                 | `permanent` · `relocated` · `rebranded` · `format_change` · `ownership_change` · `temporary`. Show `DEFAULT_VISIBLE_TYPES` by default; the rest sit behind a filter |
| `status`               | `announced` (future) · `closed` · `reopened`                                                                                                                        |
| `d`                    | Date range `[earliest, latest]`; see below                                                                                                                          |
| `bt`                   | Business type                                                                                                                                                       |
| `rs`                   | Stated/documented reason codes, most significant first. `[]` = no known reason                                                                                      |
| `yrs`, `chain`, `next` | Optional: years in business, part of a chain, what replaced it                                                                                                      |

**Dates are ranges**, because most closures are only known to within a window:

| `d`                             | Display as                       |
| ------------------------------- | -------------------------------- |
| `["2025-04-27", "2025-04-27"]`  | Apr 27, 2025                     |
| `["2023-09-14", "2025-07-09"]`  | between Sep 2023 and Jul 2025    |
| `[null, "2022-09-08"]`          | by Sep 8, 2022                   |
| `[null, null]` (announced only) | closing soon, date not announced |

Sort with `sortDate(d)` (the latest known end). The list is already sorted: undated announcements first, then newest first.

## Detail file (`LocationDetail`)

A location's full history, oldest first (`occupants`). Occupants before the 2022-03-01 window appear for context, without events. An occupant with an `event` has its reasons (`stated` / `documented` / `signal`, each with our own short summary), what came `next`, and `evidence`. Every reason and piece of evidence points into `sources` by index: the DineSafe and licence datasets, or a news article with its URL and date.

## Sample data

| Command                    | Output                                     | Use                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run sample`           | `contract/sample/` (committed)             | 25 real closures at 23 Toronto addresses, from Phase 0 research, covering every case the UI must handle: announced (with and without a date), reopened, relocated, format change, date windows, "by" dates, no reason, several reasons, two closures at one address |
| `bun run sample:synthetic` | `contract/sample-synthetic/` (git-ignored) | 10,000 synthetic rows (351 KB gzipped) for performance testing; add `--synthetic 50000` for GTA scale. No detail files                                                                                                                                              |

Both directories use the real export layout, so the frontend can serve either as static files (e.g. copy or symlink into `web/public/data/`).

The curated sample is built from `fixtures/toronto.ts`: edit the fixture, run `bun run sample`, commit both.

## Changing the contract

1. Edit the schema in `src/`.
2. If the change breaks existing files, bump `CONTRACT_VERSION` in `src/common.ts`.
3. `bun run sample && bun test && bun run typecheck`. TypeScript then flags every place in the pipeline and frontend that needs updating.
