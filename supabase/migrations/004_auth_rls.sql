-- Phase 2H: Supabase Auth + row-level security.
-- public.users.id should match auth.users.id (created via ensureAppUser on login).

alter table users enable row level security;

create policy users_select_own on users
  for select using (id = auth.uid());

create policy users_insert_own on users
  for insert with check (id = auth.uid());

alter table conversations enable row level security;

create policy conversations_all_own on conversations
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table messages enable row level security;

create policy messages_all_own on messages
  for all using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

alter table memories enable row level security;

create policy memories_all_own on memories
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table workouts enable row level security;

create policy workouts_all_own on workouts
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table reminders enable row level security;

create policy reminders_all_own on reminders
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
