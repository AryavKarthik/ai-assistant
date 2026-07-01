-- Optional: faster text search on memories (run after 001_initial_schema.sql)
create extension if not exists pg_trgm;

create index if not exists memories_content_trgm_idx
  on memories using gin (content gin_trgm_ops);
