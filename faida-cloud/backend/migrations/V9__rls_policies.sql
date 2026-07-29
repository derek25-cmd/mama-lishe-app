-- DOC 05 §11 — Integrity, Retention & RLS
--
-- Design note (not spelled out verbatim in DOC 05, applied consistently):
-- the API connects to Postgres as a single owning role (POSTGRES_USER) but
-- issues `set local role faida_app; set local app.vendor_id = '<uuid>';
-- set local app.role = '<jwt role>';` at the start of every request/transaction
-- (see Task 5). Table owners bypass RLS by default in Postgres, so all
-- vendor-scoped tables are granted to faida_app (not owned by it) and use
-- FORCE ROW LEVEL SECURITY so the restriction also holds if ownership ever
-- changes. ops_admin is granted a bypass via the policy USING clause rather
-- than BYPASSRLS, so the audit trail of "who saw what" stays inside RLS.

create role faida_app nologin noinherit;

grant usage on schema ref, vendor, costing, pos, price, notify to faida_app;
grant select on all tables in schema ref to faida_app; -- ops-owned, read-only to vendors

-- ---------- vendor ----------
alter table vendor.vendors enable row level security;
alter table vendor.vendors force row level security;
create policy vendors_self on vendor.vendors
  using (id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on vendor.vendors to faida_app;

alter table vendor.branches enable row level security;
alter table vendor.branches force row level security;
create policy branches_self on vendor.branches
  using (owner_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (owner_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update, delete on vendor.branches to faida_app;

alter table vendor.devices enable row level security;
alter table vendor.devices force row level security;
create policy devices_self on vendor.devices
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update, delete on vendor.devices to faida_app;

alter table vendor.rewards_ledger enable row level security;
alter table vendor.rewards_ledger force row level security;
create policy rewards_self on vendor.rewards_ledger
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert on vendor.rewards_ledger to faida_app; -- ledger: no update/delete

-- ---------- costing ----------
alter table costing.vendor_recipes enable row level security;
alter table costing.vendor_recipes force row level security;
create policy vendor_recipes_self on costing.vendor_recipes
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update, delete on costing.vendor_recipes to faida_app;

alter table costing.vendor_recipe_ingredients enable row level security;
alter table costing.vendor_recipe_ingredients force row level security;
create policy vendor_recipe_ingredients_self on costing.vendor_recipe_ingredients
  using (exists (
           select 1 from costing.vendor_recipes r
           where r.id = recipe_id
             and (r.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')))
  with check (exists (
           select 1 from costing.vendor_recipes r
           where r.id = recipe_id
             and (r.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')));
grant select, insert, update, delete on costing.vendor_recipe_ingredients to faida_app;

alter table costing.cook_plans enable row level security;
alter table costing.cook_plans force row level security;
create policy cook_plans_self on costing.cook_plans
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on costing.cook_plans to faida_app;

alter table costing.cook_plan_items enable row level security;
alter table costing.cook_plan_items force row level security;
create policy cook_plan_items_self on costing.cook_plan_items
  using (exists (
           select 1 from costing.cook_plans p
           where p.id = plan_id
             and (p.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')))
  with check (exists (
           select 1 from costing.cook_plans p
           where p.id = plan_id
             and (p.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')));
grant select, insert, update on costing.cook_plan_items to faida_app;

alter table costing.cook_plan_shopping enable row level security;
alter table costing.cook_plan_shopping force row level security;
create policy cook_plan_shopping_self on costing.cook_plan_shopping
  using (exists (
           select 1 from costing.cook_plans p
           where p.id = plan_id
             and (p.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')))
  with check (exists (
           select 1 from costing.cook_plans p
           where p.id = plan_id
             and (p.vendor_id = current_setting('app.vendor_id', true)::uuid
                  or current_setting('app.role', true) = 'ops_admin')));
grant select, insert, update on costing.cook_plan_shopping to faida_app;

-- ---------- pos (ledger tables: no update/delete at role level) ----------
alter table pos.sales enable row level security;
alter table pos.sales force row level security;
create policy sales_self on pos.sales
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
-- services set app.vendor_id per request from the verified JWT
grant select, insert on pos.sales to faida_app; -- corrections via voided flag, not UPDATE

alter table pos.deni_customers enable row level security;
alter table pos.deni_customers force row level security;
create policy deni_customers_self on pos.deni_customers
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on pos.deni_customers to faida_app;

alter table pos.deni_payments enable row level security;
alter table pos.deni_payments force row level security;
create policy deni_payments_self on pos.deni_payments
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert on pos.deni_payments to faida_app; -- ledger: no update/delete

alter table pos.expenses enable row level security;
alter table pos.expenses force row level security;
create policy expenses_self on pos.expenses
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert on pos.expenses to faida_app; -- ledger: no update/delete

alter table pos.daily_summaries enable row level security;
alter table pos.daily_summaries force row level security;
create policy daily_summaries_self on pos.daily_summaries
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on pos.daily_summaries to faida_app; -- nightly reconciliation job re-derives

-- ---------- price ----------
alter table price.submissions enable row level security;
alter table price.submissions force row level security;
create policy submissions_self on price.submissions
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert on price.submissions to faida_app;

-- market_prices / forecasts are market-wide (not vendor-scoped): readable by all vendors
grant select on price.market_prices, price.forecasts to faida_app;

-- ---------- notify ----------
alter table notify.notifications enable row level security;
alter table notify.notifications force row level security;
create policy notifications_self on notify.notifications
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on notify.notifications to faida_app;

alter table notify.preferences enable row level security;
alter table notify.preferences force row level security;
create policy preferences_self on notify.preferences
  using (vendor_id = current_setting('app.vendor_id', true)::uuid
         or current_setting('app.role', true) = 'ops_admin')
  with check (vendor_id = current_setting('app.vendor_id', true)::uuid
              or current_setting('app.role', true) = 'ops_admin');
grant select, insert, update on notify.preferences to faida_app;

-- ---------- audit (ops/system only, append-only) ----------
grant usage on schema audit to faida_app;
grant select, insert on audit.log to faida_app; -- update/delete already revoked from PUBLIC in V7
