-- DOC 05 §6 — schema: price
create schema if not exists price;

create table price.submissions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  market_id uuid not null references ref.markets,
  ingredient_id uuid not null references ref.ingredients,
  unit_name_sw text not null,
  quantity numeric not null default 1,
  price_tzs integer not null check (price_tzs > 0),
  lat double precision,
  lng double precision,
  in_geofence boolean,
  source text not null default 'shopping', -- shopping|prompt|ops|bulletin
  status text not null default 'pending', -- pending|accepted|rejected_outlier
  submitted_at timestamptz default now()
);

create table price.market_prices ( -- weekly published snapshot
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references ref.markets,
  ingredient_id uuid not null references ref.ingredients,
  week_start date not null,
  price_per_kg_tzs integer not null,
  sample_size integer not null,
  confidence text not null, -- high|medium|low|forecast
  pct_change_wow numeric,
  published_at timestamptz,
  unique (market_id, ingredient_id, week_start)
);

create table price.forecasts ( -- ML output
  market_id uuid not null references ref.markets,
  ingredient_id uuid not null references ref.ingredients,
  week_start date not null,
  price_per_kg_tzs integer not null,
  model_version text not null,
  primary key (market_id, ingredient_id, week_start)
);
