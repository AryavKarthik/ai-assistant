-- Assistant message metadata: trust tags, action receipts, model label.
alter table messages
  add column if not exists metadata jsonb;

create index if not exists messages_metadata_gin_idx
  on messages using gin (metadata);
