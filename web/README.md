# RIPstaurant web

The public site: a map and list of closed Toronto restaurants. React + TypeScript + Vite.

The site is fully static. It loads pre-built data files (a manifest, one list file per city, one detail file per location) and does all filtering, sorting and search in the browser. There is no API server. The data format lives in [`../contract`](../contract/README.md); import its types rather than redefining them.

## Setup

`web` is a workspace package: install from the repo root (`bun install`). Tooling config comes from the root. The tsconfigs extend `../tsconfig.base.json`, `eslint.config.mjs` extends the root ESLint config with React rules, and Prettier and EditorConfig apply from the root.

Still to do (Phase 1):

1. Add dependencies:
   ```sh
   bun add --cwd web maplibre-gl pmtiles @ripstaurant/contract
   ```
2. Serve sample data at `/data`:
   ```sh
   ln -s ../../contract/sample web/public/data            # curated sample (25 closures)
   # or: ln -s ../../contract/sample-synthetic web/public/data   (10k rows, perf testing)
   ```
   The root `.gitignore` already excludes `data/`, so exported data never goes in the repo.

## Scripts

Run from `web/`:

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `bun run dev`     | Dev server with hot reload         |
| `bun run build`   | Type-check and build to `dist/`    |
| `bun run preview` | Serve the production build locally |

Lint, format and type-check from the repo root: `bun run lint`, `bun run format`, `bun run typecheck`.

## Loading data

```ts
import {
  CityList,
  LocationDetail,
  Manifest,
  locationPath,
} from "@ripstaurant/contract";

const manifest = Manifest.parse(
  await (await fetch("/data/manifest.json")).json(),
);
const city = manifest.cities[0];
const list = CityList.parse(await (await fetch(`/data/${city.list}`)).json());
// later, when a closure is opened:
const detail = LocationDetail.parse(
  await (await fetch(`/data/${locationPath(city.slug, row.loc)}`)).json(),
);
```

- `manifest.json` is always fetched fresh. List files are content-hashed, so they can be cached forever.
- `ll` is `[longitude, latitude]`, the order MapLibre expects.
- `hood` is an index into `list.hoods`.
- Dates are ranges (`d: [earliest, latest]`). See the contract README for how to display each form, and use `sortDate()` to sort.
- Show `DEFAULT_VISIBLE_TYPES` by default; `ownership_change` and `temporary` sit behind a filter.

Keep all data access in one module (e.g. `src/data.ts` with `searchClosures()` and `getLocation()`), so components never know where data comes from. If we ever add a search API, only that module changes.

## Performance targets

Build with the synthetic 10k file (`bun run sample:synthetic` at the repo root), not only the 25-row sample:

- Search runs in a web worker, so typing never blocks the map.
- Map points use MapLibre clustering at low zoom; rows become GeoJSON in the browser.
- The list is virtualized (only visible rows rendered).
- Detail files are fetched on demand, never up front.

## Map

MapLibre GL with a Protomaps basemap (a single PMTiles file, served statically). Closures render as tombstone markers; relocations and rebrands get their own icons.
