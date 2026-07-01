-- Phase 2I: per-service Google connection flags.

alter table google_oauth_tokens
  add column if not exists gmail_connected boolean not null default false,
  add column if not exists youtube_connected boolean not null default false,
  add column if not exists gmail_connected_at timestamptz,
  add column if not exists youtube_connected_at timestamptz;

create index if not exists google_oauth_tokens_gmail_idx
  on google_oauth_tokens (user_id)
  where gmail_connected = true;

create index if not exists google_oauth_tokens_youtube_idx
  on google_oauth_tokens (user_id)
  where youtube_connected = true;
