-- Toronto, the first city. bbox matches the contract sample (contract/scripts/build-sample.ts).

insert into cities (slug, name, timezone, bbox)
values (
  'toronto',
  'Toronto',
  'America/Toronto',
  ST_MakeEnvelope(-79.6393, 43.581, -79.1153, 43.8555, 4326)
);
