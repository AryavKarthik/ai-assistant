alter table conversations
  add column if not exists thread_section text not null default 'main';

update conversations
set thread_section = 'main'
where thread_section is null or thread_section not in ('main', 'side');

alter table conversations
  drop constraint if exists conversations_thread_section_check;

alter table conversations
  add constraint conversations_thread_section_check
  check (thread_section in ('main', 'side'));

create index if not exists conversations_user_section_idx
  on conversations(user_id, thread_section, updated_at desc);
