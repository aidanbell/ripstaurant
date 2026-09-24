-- Closure detection (Phase 4). `bun run detect` rebuilds closure events, their evidence
-- and reasons, and establishment links from the resolved entities on every run. Events
-- are keyed within their occupancy so a re-run updates them in place, keeping their ids
-- for review decisions and news evidence later.

alter table closure_events
  -- "end" (how the occupancy ended), "temporary:<date>" (a health closure that reopened),
  -- "ownership:<licence number>" (a new owner's licence under the same name).
  add column key text not null,
  add constraint closure_events_occupancy_key unique (occupancy_id, key);

-- Evidence from bulk records is detect's own: one row per event, record and claim.
-- Documented sources (news, from Phase 5) and reviewed rows are never rewritten by it.
create unique index evidence_record_claim_key
  on evidence (closure_event_id, source_record_id, claim)
  where source_record_id is not null;
