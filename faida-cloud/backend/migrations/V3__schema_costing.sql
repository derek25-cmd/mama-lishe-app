-- DOC 05 §4 — schema: costing
create schema if not exists costing;

create table costing.vendor_recipes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  base_recipe_id uuid references ref.base_recipes,
  name_sw text not null,
  base_plates integer not null default 10,
  sell_price_tzs integer check (sell_price_tzs >= 0),
  is_active boolean default true,
  updated_at timestamptz default now()
);

create table costing.vendor_recipe_ingredients (
  recipe_id uuid references costing.vendor_recipes on delete cascade,
  ingredient_id uuid references ref.ingredients,
  qty_per_base numeric not null check (qty_per_base > 0),
  primary key (recipe_id, ingredient_id)
);

create table costing.cook_plans (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  client_id text not null,
  plan_date date not null,
  status text not null default 'planned', -- planned|shopping_done|closed
  planned_cost_tzs integer,
  actual_cost_tzs integer,
  price_week date, -- snapshot week used
  created_at timestamptz default now(),
  unique (vendor_id, client_id)
);

create table costing.cook_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references costing.cook_plans on delete cascade,
  recipe_id uuid not null references costing.vendor_recipes,
  plates integer not null check (plates between 1 and 2000),
  cost_per_plate_tzs integer,
  recommended_price_tzs integer
);

create table costing.cook_plan_shopping (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references costing.cook_plans on delete cascade,
  ingredient_id uuid not null references ref.ingredients,
  qty_canonical numeric not null,
  display_unit text not null,
  display_qty numeric not null,
  est_cost_tzs integer not null,
  actual_cost_tzs integer, -- confirmed -> feeds price.submissions
  bought boolean default false
);
