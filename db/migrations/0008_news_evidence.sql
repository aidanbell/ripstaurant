-- News evidence (Phase 5). `bun run news` links documented sources to closure events and
-- establishments, and re-runs in place: one evidence row per source, subject and claim.
-- Like detect's index on source records, these let a re-run update its own rows; a row a
-- reviewer has confirmed or rejected is never overwritten (see the job).

create unique index evidence_source_event_claim_key
  on evidence (closure_event_id, source_id, claim)
  where source_id is not null and closure_event_id is not null;

-- A source that names a place we have no closure event for yet.
create unique index evidence_source_establishment_claim_key
  on evidence (establishment_id, source_id, claim)
  where source_id is not null and closure_event_id is null;
