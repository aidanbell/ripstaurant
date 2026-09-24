-- Reference data (Phase 3): the City's Address Points, which every record's address is
-- matched to. Loaded by `bun run reference` along with neighbourhoods. Unlike
-- source_records it's a current copy: rows are updated in place when the City changes
-- them, and kept with `removed_at` when they leave the feed, since locations point here.

create table address_points (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- The City's ADDRESS_POINT_ID.
  source_key text not null,
  -- Display form, e.g. "429A Yonge St".
  address text not null,
  -- Normalized number + street, e.g. "429A YONGE ST". Built by pipeline/src/address.ts,
  -- which parses every dataset's addresses into the same form. Not unique: an address
  -- can have several points (land, structure, entrance).
  match_key text not null,
  geom geometry(Point, 4326) not null,
  neighbourhood_id bigint references neighbourhoods,
  removed_at timestamptz,
  unique (city_id, source_key)
);
create index on address_points (city_id, match_key);
create index on address_points using gist (geom);
create index on address_points (neighbourhood_id);

-- A location is identified by its own address and unit (its slug), not by its address
-- point: a missing number can be matched to a neighbour (219 Queen St W → 217), which
-- gives it coordinates and a neighbourhood but mustn't merge it with the real 217.
-- Unit is normalized ("Unit-108A", "#108A" → "108A"); null = none.
alter table locations
  add column unit text check (unit <> ''),
  add column address_point_id bigint references address_points,
  -- How the address point was found (AddressMatcher in pipeline/src/address.ts). Null = unmatched.
  add column address_match text check (
    address_match in ('id', 'exact', 'unit_trimmed', 'suffix_dropped', 'nearby')
  ),
  add check ((address_point_id is null) = (address_match is null));
create index on locations (address_point_id);
