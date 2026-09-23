# RIPstaurant

## Concept

RIPstaurant is a web app to view restaurants that have shut down or closed recently. The site is a typical split between a map view and a list view, to see restaurants that have shuttered and figure out any potential reason why. The real product here is the dataset, which will allow for people to draw their own conclusions based on the reason why a restaurant closed down, if none is provided.

## Scope

The area that we will target initially will be Toronto, which will give an absolutely massive amount of data and restaurants. Later we can target larger cities, but for now we will scope our data to just Toronto, and later the GTA.

- **Time window:** closures from **2022-03-01** onward (Ontario's final reopening step), giving ~4.5 years of history to backfill. Closures that began during the pandemic but landed after this date are in scope and can carry `pandemic` as a reason.
- **Automation:** the pipeline should be automated end to end. Manual review is the exception (low-confidence matches, disputed reasons), not the workflow.
- **Data access:** everything we use is already public, so the site's data files being easy to download is fine. A formal dataset release (versioned, documented downloads) comes later, once the data is proven reliable (see [Licensing](#licensing)).
- **Priorities:** speed and ease of use for visitors, a good developer experience, and performance from the start, so the same system can expand to other cities where similar data exists.

## UI

As mentioned, the UI will be a simple split between a map view, to see a simplified map of the city, with tombstones as icons to mark each closed restaurant. The list view will allow for more sorting and filtering, by dates, name, neighborhood, etc.

- Relocations and rebrands get their own icons, and can be toggled on/off.
- A location's detail view shows its full history: every establishment that has occupied the address, and how each one ended.
- Reasons are shown split into **Stated reason** and **Signals** (see [Reasons](#reasons)); the site presents evidence, it doesn't speculate.

## Data

Research behind this section: [docs/research/phase-0-findings.md](docs/research/phase-0-findings.md).

### What counts as a closure

A closure is an **event** on a location, not a flag on a restaurant.

| Type | Meaning | On map |
|---|---|---|
| `permanent` | Establishment stopped operating for good at this location | Tombstone |
| `relocated` | Same establishment moved to a new address | Relocation icon, linked to new location |
| `rebranded` | Same operation (owner/kitchen/concept) continued under a new name | Rebrand icon, linked to successor |
| `format_change` | Business continues but stops operating as a restaurant here (delivery-only, wholesale-only, ghost kitchen) | Tombstone variant |
| `ownership_change` | New owner, name kept | Hidden by default |
| `temporary` | Renovation, health closure, seasonal; reopened | Hidden by default |

Each event also has a **status**: `announced` (a future closure, usually from news), `closed`, `reopened`, or `retracted` (the source corrected itself).

A single chain location closing is a `permanent` closure of that location; the establishment is linked to a `chain` so brand-wide trends can be filtered.

Relocations and rebrands matter for pattern-finding: a location with high turnover (many closures, frequent relocations *away*) may be one that doesn't suit restaurants.

### Sources

| Source | Role | Redistributable |
|---|---|---|
| City of Toronto Open Data: **DineSafe** | Discovers closures (inspections stop); health closures as documented reasons. 2001 → today | Yes (Open Government Licence – Toronto, with attribution) |
| City of Toronto Open Data: **Business licences** | Confirms closures (cancellation, with a lag); address history and owners for successors, ownership changes, rebrands | Yes |
| City of Toronto Open Data: **Building permits** | Restaurant → other-use conversions confirm closures; other → restaurant finds successors; demolitions as documented reasons | Yes |
| City of Toronto Open Data: **Development applications** | Redevelopment of a site as a documented reason | Yes |
| City of Toronto Open Data: **Address Points**, **Neighbourhoods** | Address normalization, geocoding, neighbourhood assignment | Yes |
| **News** (blogTO primary, Daily Hive secondary; Toronto Life manual only) | Stated reasons and announced closures, extracted with Claude | Facts + links only |
| **Social** (Reddit via official API later; Instagram link-only) | Owner announcements, community reports | Facts + links only |
| **OpenStreetMap** | Minor: occasional confirmation of recent closures | ODbL (share-alike on public release) |
| **Wayback Machine** | Archived copies of cited sources; when a restaurant's website went dark | Links only |
| **Google Places / Yelp** | **Not used.** ToS forbids storing/redistributing | No |

AGCO liquor licences were considered and skipped; the sources above are enough.

### Scraping

Scraping is used to *verify* and *enrich* candidates found in the open datasets (e.g. is the restaurant's website/Instagram still active, is there a closure announcement), not as the primary discovery source.

- Respect `robots.txt` and site ToS; rate-limit and identify with a descriptive user agent. Never work around blocks (e.g. Toronto Life's Cloudflare 403).
- Store what was observed (status, date, URL) and our extracted facts, never copied content.
- Every scraped page or article becomes a documented `sources` row (see [Provenance](#provenance)).

### Pipeline

1. **Ingest:** each bulk dataset has a fetcher that saves the raw file to object storage and writes append-only `source_records`. DineSafe, licences, permits and development applications are pulled twice a month; the DineSafe current feed holds ~3 years, so nothing is lost between pulls.
2. **Normalize:** clean names, match addresses to City Address Points, attach coordinates and neighbourhood. Handle both DineSafe schemas and both licence category names.
3. **Resolve entities:** link records to `establishments`, `locations` and `occupancies` with a match confidence. Re-runnable from raw records without refetching.
4. **Detect closures:** candidate `closure_events` from signals: inspections stop, licence cancelled (unless a same-name licence follows, which means `ownership_change`), restaurant → other-use permit, a new occupant at the address.
5. **News:** diff blogTO/Daily Hive sitemaps → fetch new closure-worded articles → Claude extraction → `sources` + `source_extractions` → match to establishments (name + address, or name + neighbourhood polygon) → `evidence` and stated `closure_reasons`. Drop events before 2022-03-01 and non-food businesses.
6. **Verify & enrich:** scrape checks for low-confidence candidates; classify relocations and rebrands (same name/owner at a new address; new name at the same address with overlapping owner).
7. **Score:** each closure event gets a confidence from its combined evidence. Events above a threshold are exported; the rest go to a review queue.
8. **Export:** write the public dataset as static files for the site.

### Reasons

Every reason carries its provenance. This is both a data-quality and a legal concern: we're making claims about named businesses.

- **`stated`**: an owner or official said so, recorded through a documented source.
- **`documented`**: a public record shows it (health-closure order, demolition permit).
- **`signal`**: a nearby fact, not a claim (e.g. transit construction on the block during a given period).

Reason codes: `rent_lease`, `redevelopment`, `health_enforcement`, `owner_retirement`, `sale`, `construction_disruption`, `pandemic`, `financial`, `relocation`, `unknown`.

Only record a stated reason when the source actually states it. In the extraction test the model was stricter about this than a human reader (see findings), and that's the behaviour we want.

### Schema (draft)

```
cities              id, slug, name, timezone, bbox
chains              id, name
establishments      id, canonical_name, business_type, cuisine?, chain_id?, opened_on?
locations           id, city_id, address_point_id, address, geom (PostGIS), neighbourhood_id
occupancies         id, establishment_id, location_id, first_seen, last_seen
source_records      id, city_id, source, source_key, fetched_at, raw_json   -- append-only, bulk open datasets
record_links        source_record_id, establishment_id?, location_id?, match_confidence
sources             id, city_id?, kind, publisher, url, title, author?, published_at?, retrieved_at,
                    archived_url?, primary_source_url?, terms_note?, retracted_at?
source_extractions  id, source_id, extractor (model or "manual"), prompt_version, extracted_json, created_at
evidence            id, source_id?, source_record_id?, establishment_id?, closure_event_id?,
                    claim (closed|announced|reopened|relocated|rebranded|reason|successor),
                    match_status (auto|review|confirmed|rejected), note
closure_events      id, occupancy_id, type, status (announced|closed|reopened|retracted),
                    closed_on_earliest, closed_on_latest, confidence
closure_reasons     closure_event_id, reason_code, kind (stated|documented|signal), evidence_id, note
establishment_links from_establishment_id, to_establishment_id, kind (relocated_to|rebranded_as|successor)
```

Closure dates are stored as a **range** (`closed_on_earliest`–`closed_on_latest`), since most are only known to within an inspection interval or a licence-cancellation lag.

### Provenance

- **Bulk open datasets** (DineSafe, business licences, permits, development applications, Address Points) arrive as `source_records` through scheduled ingests. The dataset and fetch time are the citation.
- **Everything else** (news articles, social posts, a business's own website, anything found by scraping, one-off finds) gets a **documented `sources` row**: its `kind` (`news_article`, `social_post`, `business_website`, `press_release`, `other`), publisher, URL, publish and retrieval dates, a Wayback `archived_url` so the citation survives link rot, the `primary_source_url` when an article cites the owner's own post, and `retracted_at` for corrections.

Every claim points at its proof through `evidence`, whether that's a `source_records` row or a `sources` row. Reasons reference evidence rather than holding a bare URL. LLM output is kept in `source_extractions` with the model and prompt version, so extractions can be re-run and compared.

### Licensing

Attribution on the site (Open Government Licence – Toronto) covers our obligations for the site's data files. Before a formal dataset release:

- Using OSM data means the published dataset must likely be released under ODbL (share-alike). Decide whether OSM-derived records are worth that, or exclude them from the public export.
- Publish as versioned CSV/GeoJSON with a changelog so the data can be cited.

## Stack

Open-source tools wherever possible, chosen for reliability, speed and ease of access:

- **PostgreSQL + PostGIS**: the database of record
- **Bun + TypeScript**: pipeline jobs and tooling (Bun's built-in Postgres client, no ORM needed to start)
- **React + Vite + MapLibre GL**: the frontend
- **Protomaps (PMTiles)**: a self-hosted Toronto basemap served as one static file, with no tile-server bill
- **Claude API**: news extraction (`claude-opus-5`, structured output); measured at $0.0126/article

## Architecture

**The public site is static.** The pipeline writes to Postgres; after each run it exports the verified dataset as GeoJSON/JSON files, and the frontend loads those and filters and sorts in the browser. That works because a few thousand closures is a small payload.

- The database is never exposed to the internet. Only the pipeline (and us) connect to it.
- No API server to run, scale or secure. The site is just files on a CDN: fast and nearly free.
- Search over data already in the browser is faster than any server round trip, so static is also the fastest option for visitors.
- The export decides which fields are public. Internal details (confidence scores, match statuses, licence owner names, review notes) stay in the database.

```
  schedulers (cron)                 pipeline jobs (Bun)                storage
 ┌───────────────┐   runs    ┌──────────────────────────┐  writes  ┌──────────────────┐
 │ twice monthly │ ────────▶ │ ingest: DineSafe,        │ ───────▶ │ Postgres+PostGIS │
 │ daily         │           │ licences, permits, ...   │          │ (Neon, private)  │
 └───────────────┘           │ news: sitemap diff →     │          └──────────────────┘
  (GitHub Actions)           │ Claude extraction        │  raw snapshots
                             │ resolve → detect → score │ ───────▶ object storage (R2)
                             │ export                   │          raw CSV, article HTML
                             └────────────┬─────────────┘
                                          │ manifest + per-city JSON
                                          ▼
                                   Cloudflare Pages  ◀── React app + PMTiles basemap
                                          ▲
                                       visitors
```

**Scale check (measured 2026-09-23).** There are ~8,000 food licence cancellations since 2022-03 after removing same-name re-licences (ownership changes), or ~5,000 counting eating/drinking only. A list file of 10,000 closures (name, street, neighbourhood, lat/lng, date, type, top reason) is **343 KB gzipped**. Filtering it ("on Queen St, closed before 2025") takes <1 ms and a typo-tolerant name search ~2 ms. At 50,000 records (GTA-sized): 1.7 MB, 2–8 ms. So the site works in two layers:

1. **List file** (`{city}/closures.{hash}.json`), loaded once and held in memory. It drives the map, the list, filters and search (MiniSearch/uFuzzy for typo-tolerant ranking). The frontend converts rows to GeoJSON for MapLibre in the browser, which keeps the file compact.
2. **Detail files** (one per location), fetched only when a location is opened: full address history, all reasons with sources.

The frontend reaches data only through a small module (`searchClosures()`, `getLocation()`), so it never knows whether results come from memory or a server.

**When to add a backend:** any of (a) search must cover content too large to ship (full histories, article text), (b) one city passes ~100k records, or we want cross-city search, (c) features that write data (inaccuracy reports, submissions). Limiting bulk copying is *not* a goal: all our inputs are public. The backend would be a **Cloudflare Worker** (runs per request, free tier 100k requests/day) querying Neon behind the same data module. It's not an always-on server, and nothing else in the architecture changes.

### Multi-city and performance

Designed in from the first migration, because retrofitting it touches everything:

- **City is a dimension of the data.** A `cities` table; `city_id` on locations, source records and sources. URLs are per city (`/toronto`).
- **One export per city.** `toronto/closures.json` plus `toronto/locations/{id}.json`. Each city's payload stays bounded however many cities we add. Cross-city search, if we want it, is a small combined name index or a Worker.
- **Source adapters.** The pipeline defines interfaces per source type (inspections, business licences, permits, address reference, news) with a Toronto implementation of each. A new city means new adapters that map into the same schema, not a new pipeline. Candidate cities need a research pass like Phase 0 first.
- **Compact list format.** Short keys, enum codes instead of repeated strings, coordinates rounded to 5 decimals (~1 m).
- **Search in a web worker** so typing never blocks the map. MapLibre clustering at low zoom.
- **Cache-friendly deploys.** Export files have content-hashed names and are cached indefinitely by browsers and the CDN. A small manifest points to the current version, so a new export shows up immediately.
- **Headroom.** If one city ever outgrows a single list file (~100k points), the pipeline builds vector tiles of the closures (PMTiles, like the basemap), still without a server.
- **Shared contract package.** `contract/` defines the export format once (Zod schema + TypeScript types). The pipeline validates every export against it before deploying; the frontend imports the same types and develops against a sample file that's guaranteed to match.

**Hosting (Option A):** Neon (Postgres + PostGIS) + GitHub Actions (scheduled jobs) + Cloudflare R2 (raw snapshots) + Cloudflare Pages (site and basemap), **~$2–5/month** plus Claude API usage. Alternatives and pricing: [docs/hosting-options.md](docs/hosting-options.md).

## Development plan

Phase 0 (research) is done. Infrastructure goes up early so snapshots start collecting while the rest is built.

| Phase | Goal | Deliverables |
|---|---|---|
| **0. Research** ✅ | Know the sources | [Findings](docs/research/phase-0-findings.md); [news extraction test](research/news-extraction/) |
| **1. Foundation** | Repo, local dev, cloud skeleton | Public GitHub repo; Bun workspace (`db/`, `pipeline/`, `contract/`, `web/`); ✅ export contract + sample files ([`contract/`](contract/)); `web/` scaffold (Vite + React); SQL migrations for the draft schema; local Postgres+PostGIS via Docker; Neon + R2 + GitHub Actions set up with secrets |
| **2. Snapshots live** | History starts accumulating | Scheduled job that pulls DineSafe, licences, permits and dev applications twice a month → gzipped raw file to R2 + `source_records` rows |
| **3. Reference data & normalizing** | Everything lands on a real address | Load Address Points + Neighbourhoods; address normalizer (units, `None`, St/Street) matched to Address Points; parsers for both DineSafe schemas and both licence category names |
| **4. Entities & closure detection** | The core dataset | `establishments` / `locations` / `occupancies` from DineSafe + licences; closure candidates; ownership-change rule; confidence scoring; backfill to 2022-03-01 |
| **5. News pipeline** | Stated reasons & announced closures | Daily sitemap diff → fetch → Claude extraction → `sources` / `source_extractions` / `evidence`; name + address/neighbourhood matching; backlog via Batches API (~$5) |
| **6. Review loop** | Handle the uncertain cases | Review queue for low-confidence matches and closures. Starts as a local CLI or small local web page against the cloud DB, with no hosting or auth needed |
| **7. Export & frontend** | The public site | Export job → manifest + per-city list + per-location detail files, validated against `contract/`; React + MapLibre map with tombstone markers; list view with filters (date, neighbourhood, reason, type); location history view; PMTiles basemap |
| **8. Launch hardening** | Safe to share | Job failure alerts (GitHub emails on failed workflows), DB backup/restore test, Wayback archiving of cited sources, attribution page (Open Government Licence – Toronto), cost check |

Phases 3–5 can overlap once the Phase 1 schema is settled. The frontend (Phase 7) can start now: the export contract and sample files exist in [`contract/`](contract/).

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-23 | Toronto only; closures from 2022-03-01 | Ontario's final reopening step; ~4.5 years of history |
| 2026-09-23 | Automate end to end; manual review only for exceptions | Scale: ~2,000 food licence cancellations a year |
| 2026-09-23 | ~~Dataset private for now~~ → site data files may be freely downloadable; formal release later | All inputs are public already; prioritize speed and ease of use over restricting access |
| 2026-09-23 | Track relocations and rebrands, not just closures | Location-level patterns (turnover, unsuitable sites) |
| 2026-09-23 | Pull bulk datasets twice a month, not daily | The DineSafe feed keeps ~3 years; daily adds nothing |
| 2026-09-23 | Skip AGCO liquor licences | Existing sources cover discovery and confirmation |
| 2026-09-23 | Document every non-bulk source (`sources` + `evidence`) | Every public claim must trace to a citation |
| 2026-09-23 | News extraction with `claude-opus-5` at effort `medium` | Good quality at $0.0126/article |
| 2026-09-23 | Static public site; no API server | Simpler, cheaper, keeps the DB private |
| 2026-09-23 | In-browser search over a list file; details fetched per location; data access behind one module | 10k closures = 343 KB gzipped, searched in ~2 ms; a Worker API can replace the module later (see Architecture triggers) |
| 2026-09-23 | Priorities: speed, ease of use, developer experience; multi-city ready from the start | Expand to other cities where similar open data exists |
| 2026-09-23 | City as a data dimension, per-city exports, source adapters, shared `contract/` package | Bounded payloads per city; one pipeline for all cities; one definition of the export format |
| 2026-09-23 | Export format v1: manifest + content-hashed per-city list (compact rows, date ranges, neighbourhood indices) + per-location detail files with indexed sources; list rows derived from detail files | See [contract/README.md](contract/README.md). 10k rows = 351 KB gzipped |
| 2026-09-23 | Hosting Option A (Neon + GitHub Actions + Cloudflare) | ~$2–5/month; standard parts, easy to move |
| 2026-09-23 | Public GitHub repo | Free Actions minutes; data and credentials are never committed |

## Open questions

- How do we assign establishment type to current-feed DineSafe establishments with no archive history (licence category? name?)
- Confidence threshold for showing a closure publicly.
- Rebrand vs. format change: when a business goes delivery-only *and* its team opens a new concept in the space (Ghost Chicken → No Vacancy), which wins?
- Rebrand detection rules: what evidence is enough to call two establishments "the same operation"?
- Reddit: is the official API (and its terms) worth it for community-reported closures?
