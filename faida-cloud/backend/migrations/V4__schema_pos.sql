-- DOC 05 §5 — schema: pos
create schema if not exists pos;

create table pos.sales (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  branch_id uuid references vendor.branches,
  client_id text not null,
  sold_at timestamptz not null,
  recipe_id uuid references costing.vendor_recipes, -- null in duka mode
  item_name text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_tzs integer not null check (unit_price_tzs >= 0),
  total_tzs integer not null check (total_tzs >= 0),
  payment_method text not null default 'cash'
    check (payment_method in ('cash','mpesa','tigopesa','airtel','deni')),
  deni_customer_id uuid,
  voided boolean default false,
  unique (vendor_id, client_id)
);

create table pos.deni_customers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  name text not null,
  phone text,
  unique (vendor_id, name)
);

alter table pos.sales
  add constraint sales_deni_customer_fk
  foreign key (deni_customer_id) references pos.deni_customers;

create table pos.deni_payments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  client_id text not null,
  deni_customer_id uuid not null references pos.deni_customers,
  amount_tzs integer not null check (amount_tzs > 0),
  paid_at timestamptz not null,
  unique (vendor_id, client_id)
);

create table pos.expenses (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  client_id text not null,
  spent_at timestamptz not null,
  category text not null, -- malighafi|mkaa|usafiri|kodi|maji|nyingine
  description text,
  amount_tzs integer not null check (amount_tzs >= 0),
  plan_id uuid references costing.cook_plans,
  unique (vendor_id, client_id)
);

create table pos.daily_summaries (
  vendor_id uuid not null references vendor.vendors,
  summary_date date not null,
  revenue_tzs integer not null default 0,
  cogs_tzs integer not null default 0,
  other_exp_tzs integer not null default 0,
  profit_tzs integer not null default 0,
  plates_sold integer default 0,
  plates_planned integer default 0,
  waste_plates integer default 0,
  deni_issued_tzs integer default 0,
  closed_at timestamptz,
  primary key (vendor_id, summary_date)
);
