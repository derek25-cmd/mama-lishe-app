-- Up Migration

-- Task 3's close-day endpoint accepts {wastePlates, notes?} per the Phase 4
-- brief, but pos.daily_summaries (migration 004, extended in 015) has
-- nowhere to put notes — flagged rather than silently dropping whatever a
-- vendor types when she closes her day (e.g. "rained, closed early").
alter table pos.daily_summaries add column notes text;

-- Down Migration

alter table pos.daily_summaries drop column if exists notes;
