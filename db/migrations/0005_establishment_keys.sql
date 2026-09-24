-- Entity resolution (Phase 4). `bun run resolve` rebuilds establishments, locations,
-- occupancies and record_links from source_records on every run. Establishments get a
-- stable key so a re-run updates them in place and their ids survive for the evidence
-- and review decisions that will point at them.

alter table establishments
  add column city_id bigint not null references cities,
  -- Where the establishment comes from: "dinesafe:<id>" (the lowest DineSafe id among
  -- those merged into it) or "licence:<number>" (a licence with no DineSafe match).
  add column source_key text not null,
  add constraint establishments_city_source_key unique (city_id, source_key),
  -- The contract's BusinessType (contract/src/codes.ts); null = not known.
  add constraint establishments_business_type_check check (
    business_type in (
      'restaurant', 'bar', 'cafe', 'bakery', 'take_out', 'food_retail', 'brewery', 'market'
    )
  );
