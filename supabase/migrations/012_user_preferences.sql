-- Phase 4B / 4G: proactive assistant preferences per user.

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  proactive_tier text not null default 'off'
    check (proactive_tier in ('off', 'reminders_only', 'full')),
  brief_enabled boolean not null default false,
  brief_time_local time not null default '08:00',
  timezone text not null default 'UTC',
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  push_proactive_enabled boolean not null default true,
  last_brief_local_date date,
  updated_at timestamptz not null default now()
);

create index user_preferences_proactive_idx
  on user_preferences (proactive_tier, brief_enabled)
  where proactive_tier != 'off' or brief_enabled = true;

alter table user_preferences enable row level security;

create policy user_preferences_all_own on user_preferences
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
