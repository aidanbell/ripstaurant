-- Snapshots (Phase 2). Each pull of a bulk dataset is an `ingests` row pointing at the
-- full raw file in object storage. source_records keeps only the rows each dataset's
-- filter selects, and only when their content is new: an unchanged row isn't stored
-- again on the next pull. Widening a filter means re-reading the raw files, not refetching.

create table ingests (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- Dataset name, e.g. dinesafe, business_licences.
  source text not null,
  resource_url text not null,
  fetched_at timestamptz not null,
  -- Object key of the gzipped raw file, and the sha256 of the file as downloaded.
  raw_key text not null unique,
  raw_sha256 text not null,
  -- Rows in the raw file, and rows the dataset's filter selected.
  row_count integer not null check (row_count >= 0),
  kept_count integer not null check (kept_count between 0 and row_count)
);
create index on ingests (city_id, source, fetched_at);
create trigger ingests_append_only
  before update or delete on ingests
  for each row execute function reject_change();

-- Records get their fetch time and citation from their ingest. source_key isn't unique
-- in every dataset (a permit revision can appear twice), so rows are identified by content.
alter table source_records
  drop constraint source_records_city_id_source_source_key_fetched_at_key,
  drop column fetched_at,
  add column ingest_id bigint not null references ingests,
  add column content_hash bytea not null,
  add constraint source_records_content_key unique (city_id, source, content_hash);
create index on source_records (source, source_key);
create index on source_records (ingest_id);
