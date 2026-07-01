-- Reminder lifecycle: track completion time and support 24h auto-cleanup.

alter table reminders
  add column if not exists completed_at timestamptz;

create index if not exists reminders_completed_cleanup_idx
  on reminders(status, completed_at)
  where status = 'done';
