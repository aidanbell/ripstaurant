-- Initial schema, from PLAN.md "Schema (draft)".
--
-- Vocabularies are text + CHECK rather than enum types, so values can be renamed or
-- dropped later. They mirror contract/src/codes.ts; change them there first.
-- Address Points (and locations.address_point_id) arrive with the Phase 3 reference data.

create extension if not exists postgis;

-- Rejects UPDATE and DELETE on append-only tables.
create function reject_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create table cities (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  timezone text not null,
  bbox geometry(Polygon, 4326) not null
);

create table neighbourhoods (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- The city's own identifier, e.g. Toronto's AREA_SHORT_CODE.
  source_key text not null,
  name text not null,
  geom geometry(MultiPolygon, 4326) not null,
  unique (city_id, source_key),
  unique (city_id, name)
);
create index on neighbourhoods using gist (geom);

create table chains (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table establishments (
  id bigint generated always as identity primary key,
  canonical_name text not null check (canonical_name <> ''),
  -- Unconstrained until type assignment is settled (PLAN.md open questions); exported
  -- values must be a contract BusinessType.
  business_type text,
  cuisine text,
  chain_id bigint references chains,
  opened_on date
);
create index on establishments (chain_id);

create table locations (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- The export's location id (tor-176-dupont-st). Stable once assigned: event ids and
  -- detail file paths are built from it.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  address text not null,
  -- Null until geocoded.
  geom geometry(Point, 4326),
  neighbourhood_id bigint references neighbourhoods,
  unique (city_id, slug)
);
create index on locations using gist (geom);
create index on locations (neighbourhood_id);

create table occupancies (
  id bigint generated always as identity primary key,
  establishment_id bigint not null references establishments,
  location_id bigint not null references locations,
  first_seen date,
  last_seen date,
  unique (establishment_id, location_id),
  check (first_seen <= last_seen)
);
create index on occupancies (location_id);

-- Rows from bulk open datasets, one per record per fetch. The dataset and fetch time
-- are the citation.
create table source_records (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- Dataset name, e.g. dinesafe, business_licences.
  source text not null,
  -- The record's id within the dataset.
  source_key text not null,
  fetched_at timestamptz not null,
  raw_json jsonb not null,
  unique (city_id, source, source_key, fetched_at)
);
create trigger source_records_append_only
  before update or delete on source_records
  for each row execute function reject_change();

create table record_links (
  source_record_id bigint not null references source_records,
  establishment_id bigint references establishments,
  location_id bigint references locations,
  match_confidence real not null check (match_confidence between 0 and 1),
  unique nulls not distinct (source_record_id, establishment_id, location_id),
  check (num_nonnulls(establishment_id, location_id) > 0)
);
create index on record_links (establishment_id);
create index on record_links (location_id);

-- Every non-bulk source: news, social posts, business websites, scraped pages.
create table sources (
  id bigint generated always as identity primary key,
  city_id bigint references cities,
  -- The contract's SourceKind minus `dataset`, which lives in source_records.
  kind text not null check (
    kind in ('news_article', 'social_post', 'business_website', 'press_release', 'other')
  ),
  publisher text not null,
  url text not null unique,
  title text not null,
  author text,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  archived_url text,
  primary_source_url text,
  terms_note text,
  retracted_at timestamptz
);

create table source_extractions (
  id bigint generated always as identity primary key,
  source_id bigint not null references sources,
  -- Model id, or "manual".
  extractor text not null,
  prompt_version text not null,
  extracted_json jsonb not null,
  created_at timestamptz not null default now()
);
create index on source_extractions (source_id);

create table closure_events (
  id bigint generated always as identity primary key,
  occupancy_id bigint not null references occupancies,
  type text not null check (
    type in ('permanent', 'relocated', 'rebranded', 'format_change', 'ownership_change', 'temporary')
  ),
  -- `retracted` is never exported.
  status text not null check (status in ('announced', 'closed', 'reopened', 'retracted')),
  closed_on_earliest date,
  closed_on_latest date,
  -- Null until scored.
  confidence real check (confidence between 0 and 1),
  check (closed_on_earliest <= closed_on_latest)
);
create index on closure_events (occupancy_id);

create table evidence (
  id bigint generated always as identity primary key,
  source_id bigint references sources,
  source_record_id bigint references source_records,
  establishment_id bigint references establishments,
  closure_event_id bigint references closure_events,
  claim text not null check (
    claim in ('closed', 'announced', 'reopened', 'relocated', 'rebranded', 'reason', 'successor')
  ),
  match_status text not null default 'auto' check (
    match_status in ('auto', 'review', 'confirmed', 'rejected')
  ),
  note text,
  -- Proof is exactly one of a documented source or a bulk record.
  check (num_nonnulls(source_id, source_record_id) = 1),
  check (num_nonnulls(establishment_id, closure_event_id) > 0)
);
create index on evidence (source_id);
create index on evidence (source_record_id);
create index on evidence (establishment_id);
create index on evidence (closure_event_id);

create table closure_reasons (
  closure_event_id bigint not null references closure_events,
  reason_code text not null check (
    reason_code in (
      'rent_lease', 'redevelopment', 'health_enforcement', 'owner_retirement', 'sale',
      'construction_disruption', 'pandemic', 'financial', 'relocation', 'unknown'
    )
  ),
  kind text not null check (kind in ('stated', 'documented', 'signal')),
  evidence_id bigint not null references evidence,
  note text,
  primary key (closure_event_id, reason_code, kind, evidence_id)
);
create index on closure_reasons (evidence_id);

create table establishment_links (
  from_establishment_id bigint not null references establishments,
  to_establishment_id bigint not null references establishments,
  kind text not null check (kind in ('relocated_to', 'rebranded_as', 'successor')),
  primary key (from_establishment_id, to_establishment_id, kind),
  check (from_establishment_id <> to_establishment_id)
);
create index on establishment_links (to_establishment_id);
