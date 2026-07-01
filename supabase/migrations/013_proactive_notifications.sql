-- Phase 4B: proactive notifications (briefs, nudges, follow-ups).

create table proactive_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null
    check (type in ('daily_brief', 'deadline_nudge', 'overdue_nudge', 'conflict_nudge', 'follow_up')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}',
  status text not null default 'unread'
    check (status in ('unread', 'read', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index proactive_notifications_user_status_idx
  on proactive_notifications (user_id, status, created_at desc);

create index proactive_notifications_user_type_idx
  on proactive_notifications (user_id, type, created_at desc);

alter table proactive_notifications enable row level security;

create policy proactive_notifications_all_own on proactive_notifications
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
