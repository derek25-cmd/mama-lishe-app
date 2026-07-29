-- DOC 05 §3 — schema: vendor
create schema if not exists vendor;

create table vendor.vendors (
  id uuid primary key, -- = auth subject id
  phone text unique not null,
  display_name text not null,
  business_type text not null check (business_type in ('mama_lishe','duka','other')),
  market_id uuid references ref.markets,
  region_id uuid references ref.regions,
  language text not null default 'sw',
  target_margin_pct numeric not null default 40,
  points integer not null default 0,
  status text not null default 'active', -- active|suspended|deleted
  consent_pdpa_at timestamptz,
  created_at timestamptz default now()
);

create table vendor.branches ( -- multi-branch (P3)
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references vendor.vendors,
  name text not null,
  market_id uuid references ref.markets,
  is_active boolean default true
);

create table vendor.devices (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  fcm_token text,
  platform text,
  app_version text,
  last_seen_at timestamptz,
  unique (vendor_id, fcm_token)
);

create table vendor.rewards_ledger (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  delta integer not null,
  reason text not null, -- price_submit|streak|redeem
  ref_id uuid,
  created_at timestamptz default now()
);
