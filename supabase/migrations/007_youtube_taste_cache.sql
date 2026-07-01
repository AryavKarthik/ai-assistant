-- Phase 2I-b: cached YouTube taste profile per user.

create table youtube_taste_cache (
  user_id       uuid primary key references users(id) on delete cascade,
  profile_json  jsonb not null,
  refreshed_at  timestamptz not null default now()
);

alter table youtube_taste_cache enable row level security;

create policy youtube_taste_cache_all_own on youtube_taste_cache
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
