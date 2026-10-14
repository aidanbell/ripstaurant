-- Hand-verified verdicts on published closures: the ground-truth sample (docs/data-gaps.md,
-- step 1) and, later, the manual review queue. Keyed by the published event id
-- (`tor-176-dupont-st~big-crow`), not closure_events.id, so resolve and detect stay free
-- to delete an event that turns out to be false; the verdict is how we know it should go.

create table review_decisions (
  id bigint generated always as identity primary key,
  city_id bigint not null references cities,
  -- The export's event id (ClosureRow.id).
  event_id text not null,
  -- Which batch drew it, e.g. "ground-truth-2026-09"; null for one-off reviews.
  sample text,
  -- The list row as published when drawn, to compare against later exports.
  published jsonb not null,
  -- Null until reviewed. not_a_closure: the event isn't a closure at all (a venue stand,
  -- a unit mix-up), whether or not the business still operates.
  verdict text check (verdict in ('closed', 'open', 'not_a_closure')),
  -- First of the month it closed, when found.
  closed_month date check (closed_month = date_trunc('month', closed_month)),
  source_url text,
  note text,
  drawn_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (city_id, event_id, sample),
  check ((verdict is null) = (reviewed_at is null)),
  check (closed_month is null or verdict = 'closed')
);
