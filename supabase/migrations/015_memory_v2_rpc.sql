-- Phase 4D: RPC functions for hybrid vector search and access tracking.
-- Run after 014_memory_v2.sql and after enabling pgvector.

-- Vector similarity search — called from lib/memory/search.ts searchByVector()
create or replace function search_memories_by_vector(
  p_user_id   uuid,
  p_embedding vector(1536),
  p_limit     int default 20
)
returns table (
  id             uuid,
  content        text,
  category       text,
  memory_type    memory_type,
  salience       float,
  is_pinned      boolean,
  valid_from     timestamptz,
  created_at     timestamptz
)
language sql
stable
as $$
  select
    id,
    content,
    category,
    memory_type,
    salience,
    is_pinned,
    valid_from,
    created_at
  from memories
  where user_id = p_user_id
    and is_archived = false
    and embedding is not null
  order by embedding <=> p_embedding
  limit p_limit;
$$;

-- Batch access tracking — called from lib/db/memories.ts updateMemoryAccess()
create or replace function increment_memory_access(
  memory_ids uuid[]
)
returns void
language sql
as $$
  update memories
  set
    access_count     = access_count + 1,
    last_accessed_at = now()
  where id = any(memory_ids);
$$;

-- Grant execute to authenticated users
grant execute on function search_memories_by_vector to authenticated;
grant execute on function increment_memory_access   to authenticated;
