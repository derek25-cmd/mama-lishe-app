-- Up Migration

-- DOC 05 §2 — schema: ref (reference data, ops-owned)
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists ref;

create table ref.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null
);

create table ref.markets (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references ref.regions,
  name text not null,
  lat double precision,
  lng double precision,
  geofence_radius_m integer default 800,
  is_active boolean default true
);

create table ref.ingredients (
  id uuid primary key default gen_random_uuid(),
  name_sw text not null,
  name_en text not null,
  category text not null, -- nafaka|mboga|nyama|viungo|mafuta|...
  canonical_unit text not null check (canonical_unit in ('g','ml')),
  is_active boolean default true
);

-- Informal unit conversion: the defensible dataset
create table ref.ingredient_units (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ref.ingredients,
  market_id uuid references ref.markets, -- null = national default
  unit_name_sw text not null, -- fungu|kopo|sado|debe|kiroba|kilo|lita
  grams_per_unit numeric not null check (grams_per_unit > 0),
  valid_from date not null default current_date,
  valid_to date,
  source text not null default 'ops',
  unique (ingredient_id, market_id, unit_name_sw, valid_from)
);

create table ref.base_recipes (
  id uuid primary key default gen_random_uuid(),
  name_sw text not null,
  name_en text not null,
  category text,
  base_plates integer not null default 10,
  version integer not null default 1,
  is_active boolean default true
);

create table ref.base_recipe_ingredients (
  recipe_id uuid references ref.base_recipes,
  ingredient_id uuid references ref.ingredients,
  qty_per_base numeric not null check (qty_per_base > 0),
  is_optional boolean default false,
  primary key (recipe_id, ingredient_id)
);

-- Down Migration

drop schema if exists ref cascade;
