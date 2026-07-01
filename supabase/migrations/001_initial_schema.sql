-- Initial schema for the chat-first personal AI assistant.
-- Run this in the Supabase SQL editor (or via Supabase CLI).

-- ---------------------------------------------------------------------------
-- users — single row for v1; foreign keys stay clean for future auth
-- ---------------------------------------------------------------------------
create table users (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Default user for single-user v1 (set DEFAULT_USER_ID in .env.local to this id)
insert into users (id) values ('a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- conversations — one active thread per user in v1
-- ---------------------------------------------------------------------------
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_active_idx on conversations(user_id, is_active);

-- ---------------------------------------------------------------------------
-- messages — canonical text for every turn (voice transcripts land here later)
-- ---------------------------------------------------------------------------
create type message_role as enum ('user', 'assistant');

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            message_role not null,
  content         text not null,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- memories — durable facts; embedding column added when pgvector is enabled
-- ---------------------------------------------------------------------------
create table memories (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  content           text not null,
  category          text,
  source_message_id uuid references messages(id),
  created_at        timestamptz not null default now()
);

create index memories_user_idx on memories(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- workouts — exercise logs extracted from natural language
-- ---------------------------------------------------------------------------
create table workouts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  logged_at         timestamptz not null default now(),
  exercise          text not null,
  sets              int,
  reps              int,
  weight_kg         numeric,
  duration_min      int,
  notes             text,
  source_message_id uuid references messages(id)
);

create index workouts_user_idx on workouts(user_id, logged_at desc);

-- ---------------------------------------------------------------------------
-- reminders — stored tasks; notification fields reserved for later
-- ---------------------------------------------------------------------------
create type reminder_status as enum ('pending', 'done', 'cancelled');

create table reminders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  title                text not null,
  due_at               timestamptz,
  status               reminder_status not null default 'pending',
  notified_at          timestamptz,
  notification_channel text,
  source_message_id    uuid references messages(id),
  created_at           timestamptz not null default now()
);

create index reminders_user_pending_idx on reminders(user_id, status, due_at);

-- v1: no auth yet — RLS disabled for local single-user dev
alter table users disable row level security;
alter table conversations disable row level security;
alter table messages disable row level security;
alter table memories disable row level security;
alter table workouts disable row level security;
alter table reminders disable row level security;
