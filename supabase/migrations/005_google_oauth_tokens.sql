-- Phase 2H: Google OAuth token storage (encrypted refresh tokens).

create table google_oauth_tokens (
  user_id            uuid primary key references users(id) on delete cascade,
  encrypted_refresh  text not null,
  scopes             text[] not null default '{}',
  calendar_connected boolean not null default false,
  connected_email    text,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index google_oauth_tokens_calendar_idx
  on google_oauth_tokens (user_id)
  where calendar_connected = true;

alter table google_oauth_tokens enable row level security;

create policy google_oauth_tokens_all_own on google_oauth_tokens
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
