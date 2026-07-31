-- Up Migration

-- Task 4's refresh_token grant needs the original OAuth scope to survive
-- rotation so the re-issued access token keeps the same scope claim.
-- Refresh tokens are deliberately opaque (no embedded claims, per Task 3),
-- so there's nowhere else for this to live. Null for OTP-issued sessions
-- (no scope at all — those tokens carry a role claim instead).
alter table vendor.refresh_tokens add column oauth_scope text;

-- Down Migration

alter table vendor.refresh_tokens drop column oauth_scope;
