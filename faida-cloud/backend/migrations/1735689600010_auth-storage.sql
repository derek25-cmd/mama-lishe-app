-- Up Migration

-- Phase 2 — auth storage. Lives in the vendor schema per spec. These tables
-- are managed exclusively by trusted server-side auth code (lib/auth/*),
-- never queried on a vendor's behalf through the general RLS-gated data
-- path, so unlike Phase 1's vendor-scoped tables they intentionally do NOT
-- carry RLS policies — the auth layer itself is the access boundary here.

create table vendor.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  family_id uuid not null,
  token_hash text not null unique, -- sha-256 hex digest, never plaintext
  device_label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text -- e.g. 'reuse_detected' | 'logout' | 'logout_all' | 'device_cap'
);

create index refresh_tokens_vendor_family on vendor.refresh_tokens (vendor_id, family_id);
create index refresh_tokens_active on vendor.refresh_tokens (vendor_id) where revoked_at is null;

create table vendor.oauth_clients (
  client_id text primary key,
  client_secret_hash text, -- null for public clients (PKCE-only)
  name text not null,
  redirect_uris text[] not null,
  allowed_scopes text[] not null,
  is_active boolean not null default true
);

create table vendor.oauth_codes (
  code_hash text primary key, -- sha-256 hex digest, never plaintext
  client_id text not null references vendor.oauth_clients,
  vendor_id uuid not null references vendor.vendors,
  scopes text[] not null,
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'), -- plain rejected per RFC 7636
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index oauth_codes_active on vendor.oauth_codes (client_id) where consumed_at is null;

insert into vendor.oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_active)
values (
  'faida-ops-dashboard',
  null,
  'Faida Ops Dashboard',
  array['https://ops.your-domain.com/callback'],
  array['vendor.read', 'vendor.write', 'prices.read', 'prices.write'],
  true
);

-- Down Migration

drop table if exists vendor.oauth_codes;
drop table if exists vendor.oauth_clients;
drop table if exists vendor.refresh_tokens;
