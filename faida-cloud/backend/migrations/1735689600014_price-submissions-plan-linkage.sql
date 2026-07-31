-- Up Migration

-- DOC 05's price.submissions has no way to idempotently key a submission to
-- the cook_plan_shopping row it came from. Phase 3's shopping-confirm route
-- (Task 5) must insert one price.submissions row per confirmed shopping
-- line without creating duplicates on a retried request — the same
-- ON CONFLICT DO NOTHING pattern used for clone-on-first-use (migration
-- 013) needs a real conflict target here. Both columns are nullable so
-- existing/ops-sourced submissions (source != 'shopping') are unaffected;
-- the partial unique index only applies once both are set.
alter table price.submissions
  add column plan_id uuid references costing.cook_plans,
  add column shopping_id uuid references costing.cook_plan_shopping;

create unique index submissions_plan_shopping_key
  on price.submissions (plan_id, shopping_id)
  where plan_id is not null and shopping_id is not null;

-- Down Migration

drop index if exists price.submissions_plan_shopping_key;
alter table price.submissions
  drop column if exists plan_id,
  drop column if exists shopping_id;
