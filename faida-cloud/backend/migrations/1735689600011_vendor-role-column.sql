-- Up Migration

-- DOC 05's vendor.vendors has no role column at all — it predates Phase 2's
-- RBAC role list (DOC 02 §5, adapted here: vendor, vendor_owner,
-- ops_curator, ops_admin, partner_readonly). JWT claims and RBAC middleware
-- need it, so it's added here explicitly rather than silently assumed.
-- New self-service (OTP) signups default to 'vendor'.
alter table vendor.vendors
  add column role text not null default 'vendor'
  check (role in ('vendor', 'vendor_owner', 'ops_curator', 'ops_admin', 'partner_readonly'));

-- Down Migration

alter table vendor.vendors drop column role;
