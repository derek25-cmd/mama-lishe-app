-- DOC 05 §7 — schema: notify
create schema if not exists notify;

create table notify.notifications (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor.vendors,
  kind text not null,
  title_sw text not null,
  body_sw text not null,
  deeplink text,
  channels text[] not null default '{inapp}', -- inapp|push|sms|email
  read_at timestamptz,
  created_at timestamptz default now()
);

create table notify.preferences (
  vendor_id uuid primary key references vendor.vendors,
  push boolean default true,
  sms_digest boolean default false,
  quiet_start time,
  quiet_end time
);
