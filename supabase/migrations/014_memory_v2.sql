-- Phase 4D: Sophisticated memory system.
-- Adds typed taxonomy, pgvector embeddings, relationship graph, salience, and lifecycle fields.
-- Run after 013_proactive_notifications.sql

-- Enable pgvector (already available on Supabase; safe to re-run)
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- New enum types
-- ---------------------------------------------------------------------------
create type memory_type as enum (
  'fact',         -- static personal facts: name, age, location, education, job
  'preference',   -- likes/dislikes/habits: food, music, communication style
  'routine',      -- recurring patterns: gym Mon/Wed, standup at 9am, morning routine
  'episodic',     -- timestamped events: "met professor Mar 12", "had interview at X"
  'goal',         -- aspirations: "wants HD average", "aiming to run a marathon"
  'relationship', -- people: family, friends, professors, colleagues
  'skill'         -- abilities: "knows Python", "plays guitar", "speaks French"
);

create type memory_source_type as enum (
  'auto_capture', -- server extracted from user message text
  'tool_save',    -- Claude called the save_memory tool
  'user_manual'   -- user added via Memory Manager UI
);

-- ---------------------------------------------------------------------------
-- New columns on memories
-- ---------------------------------------------------------------------------
alter table memories
  add column if not exists memory_type      memory_type,
  add column if not exists embedding        vector(1536),
  add column if not exists salience         float not null default 0.6,
  add column if not exists last_accessed_at timestamptz,
  add column if not exists access_count     int not null default 0,
  add column if not exists is_pinned        boolean not null default false,
  add column if not exists is_archived      boolean not null default false,
  add column if not exists source_type      memory_source_type,
  add column if not exists valid_from       timestamptz,
  add column if not exists valid_until      timestamptz,
  add column if not exists confidence       float not null default 0.8,
  add column if not exists metadata         jsonb;

-- ---------------------------------------------------------------------------
-- Memory relationships table
-- ---------------------------------------------------------------------------
create table if not exists memory_links (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  from_memory_id uuid not null references memories(id) on delete cascade,
  to_memory_id   uuid not null references memories(id) on delete cascade,
  link_type      text not null check (link_type in (
                   'related', 'contradicts', 'refines', 'context_of', 'part_of'
                 )),
  created_at     timestamptz not null default now(),
  unique (from_memory_id, to_memory_id, link_type)
);

-- RLS for memory_links matching pattern in 004_auth_rls.sql
alter table memory_links enable row level security;

create policy memory_links_all_own on memory_links
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists memories_type_idx      on memories(user_id, memory_type);
create index if not exists memories_salience_idx  on memories(user_id, salience desc) where is_archived = false;
create index if not exists memories_pinned_idx    on memories(user_id) where is_pinned = true;
create index if not exists memories_archived_idx  on memories(user_id, is_archived);
create index if not exists memory_links_from_idx  on memory_links(from_memory_id);
create index if not exists memory_links_to_idx    on memory_links(to_memory_id);
create index if not exists memory_links_user_idx  on memory_links(user_id);

-- NOTE: The IVFFlat vector index must be created AFTER backfilling embeddings.
-- Run this separately once backfill is complete:
--   create index memories_embedding_idx on memories
--     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
