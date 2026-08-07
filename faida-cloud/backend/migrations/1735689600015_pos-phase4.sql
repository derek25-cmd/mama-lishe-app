-- Up Migration

-- Phase 4 — POS/Deni/Expenses/Sync. Brings the pos schema (created in
-- migration 004, RLS armed in 009) up to DOC 05 §5's full end state, and
-- adds the role-level guard the void/settle paths need.
--
-- Note on repo state: migrations 001-007 currently have uncommitted local
-- edits adding CHECK constraints (bounds on geofence_radius_m, points,
-- target_margin_pct, etc.) that were never turned into a real migration —
-- node-pg-migrate treats already-applied migrations as immutable, so
-- editing that file text has no effect on the deployed database at all.
-- That draft also included `check (profit_tzs >= 0)` on
-- pos.daily_summaries, which is a genuine bug: a loss day has negative
-- profit by definition (its own inline comment even says so). This
-- migration applies the daily_summaries bounds checks that draft intended,
-- deliberately excluding that one.

-- ---------- pos.sales ----------

alter table pos.sales
  add column void_reason text,
  add column voided_at timestamptz,
  add column received_at timestamptz not null default now();

alter table pos.sales
  add constraint sales_deni_requires_customer
  check (payment_method <> 'deni' or deni_customer_id is not null);

-- ---------- pos.expenses ----------

alter table pos.expenses
  add constraint expenses_category_check
  check (category in ('malighafi','mkaa','usafiri','kodi','maji','nyingine'));

-- ---------- pos.daily_summaries ----------

alter table pos.daily_summaries
  add column recomputed_at timestamptz;

alter table pos.daily_summaries
  add constraint daily_summaries_revenue_check check (revenue_tzs >= 0),
  add constraint daily_summaries_cogs_check check (cogs_tzs >= 0),
  add constraint daily_summaries_other_exp_check check (other_exp_tzs >= 0),
  add constraint daily_summaries_plates_sold_check check (plates_sold >= 0),
  add constraint daily_summaries_plates_planned_check check (plates_planned >= 0),
  add constraint daily_summaries_waste_plates_check check (waste_plates >= 0),
  add constraint daily_summaries_deni_issued_check check (deni_issued_tzs >= 0);
  -- profit_tzs intentionally has no lower-bound check — a loss day is a
  -- negative profit, not an invalid one.

-- ---------- pos.deni_customers: case-insensitive name uniqueness ----------

-- "mama juma" and "Mama Juma " must resolve to the same customer (Task 2's
-- upsertDeniCustomer). The plain unique(vendor_id, name) from migration 004
-- only caught exact-string duplicates; a functional unique index on the
-- normalized form catches the real-world case, as defense-in-depth
-- alongside the service-layer normalization.
alter table pos.deni_customers drop constraint deni_customers_vendor_id_name_key;
create unique index deni_customers_vendor_name_norm_key
  on pos.deni_customers (vendor_id, lower(trim(name)));

-- ---------- indexes: upgrade to cursor-pagination-supporting composites ----------

-- DOC 02 §3 requires keyset (cursor) pagination, never offset — these
-- replace the 2-column indexes from migration 008 with 3-column ones whose
-- trailing `id` matches the (sold_at, id) / (spent_at, id) tiebreaker the
-- List endpoints page on. A query that only filters on (vendor_id, sold_at)
-- still uses this index as a prefix match, so nothing regresses.
drop index pos.sales_vendor_day;
create index sales_vendor_sold_id on pos.sales (vendor_id, sold_at desc, id desc);

drop index pos.expenses_vendor_day;
create index expenses_vendor_spent_id on pos.expenses (vendor_id, spent_at desc, id desc);

-- ---------- role-level guard: narrowly-scoped column grant for voiding ----------

-- pos.sales was granted only select+insert to faida_app in migration 009
-- specifically so the application role cannot rewrite a recorded sale's
-- money or quantity — "corrections via voided flag, not UPDATE" per that
-- migration's own comment. Voiding needs *some* UPDATE path though. Chosen
-- over a SECURITY DEFINER function: a column-level grant is enforced by
-- Postgres itself (any UPDATE touching total_tzs/quantity/unit_price_tzs/
-- sold_at/etc. is rejected at the privilege-check layer, before RLS or
-- application code ever runs), it still goes through the existing
-- sales_self RLS policy exactly like any other UPDATE (no policy logic to
-- duplicate or re-audit), and it carries none of a SECURITY DEFINER
-- function's search_path/privilege-escalation footguns.
grant update (voided, void_reason, voided_at) on pos.sales to faida_app;

-- Down Migration

revoke update (voided, void_reason, voided_at) on pos.sales from faida_app;

drop index if exists pos.expenses_vendor_spent_id;
create index expenses_vendor_day on pos.expenses (vendor_id, spent_at desc);

drop index if exists pos.sales_vendor_sold_id;
create index sales_vendor_day on pos.sales (vendor_id, sold_at desc);

drop index if exists pos.deni_customers_vendor_name_norm_key;
alter table pos.deni_customers add constraint deni_customers_vendor_id_name_key unique (vendor_id, name);

alter table pos.daily_summaries
  drop constraint if exists daily_summaries_revenue_check,
  drop constraint if exists daily_summaries_cogs_check,
  drop constraint if exists daily_summaries_other_exp_check,
  drop constraint if exists daily_summaries_plates_sold_check,
  drop constraint if exists daily_summaries_plates_planned_check,
  drop constraint if exists daily_summaries_waste_plates_check,
  drop constraint if exists daily_summaries_deni_issued_check;

alter table pos.daily_summaries drop column if exists recomputed_at;

alter table pos.expenses drop constraint if exists expenses_category_check;

alter table pos.sales drop constraint if exists sales_deni_requires_customer;

alter table pos.sales
  drop column if exists void_reason,
  drop column if exists voided_at,
  drop column if exists received_at;
