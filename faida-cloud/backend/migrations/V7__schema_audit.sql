-- DOC 05 §7 — schema: audit
create schema if not exists audit;

create table audit.log ( -- append-only, hash-chained
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  prev_hash bytea,
  row_hash bytea not null
);

-- row_hash = sha256(prev_hash || row-canonical-json); prev_hash = row_hash of the
-- immediately preceding row (by id). Callers insert with row_hash left null;
-- the trigger computes it, chaining to the previous row.
create or replace function audit.compute_row_hash() returns trigger as $$
declare
  last_hash bytea;
  canonical text;
begin
  select row_hash into last_hash from audit.log order by id desc limit 1;
  canonical := jsonb_build_object(
    'at', new.at, 'actor_id', new.actor_id, 'actor_role', new.actor_role,
    'action', new.action, 'entity', new.entity, 'entity_id', new.entity_id,
    'before', new.before, 'after', new.after
  )::text;
  new.prev_hash := last_hash;
  new.row_hash := digest(coalesce(last_hash, ''::bytea) || convert_to(canonical, 'UTF8'), 'sha256');
  return new;
end;
$$ language plpgsql;

create extension if not exists pgcrypto; -- provides digest()

create trigger audit_log_hash_chain
  before insert on audit.log
  for each row execute function audit.compute_row_hash();

-- Append-only: forbid UPDATE/DELETE at the role level. Revoked from PUBLIC;
-- application roles are granted INSERT/SELECT only in V9.
revoke update, delete on audit.log from public;
