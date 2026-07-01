-- Allow conversation deletion when memories/workouts/reminders reference messages.
alter table memories
  drop constraint if exists memories_source_message_id_fkey;

alter table memories
  add constraint memories_source_message_id_fkey
  foreign key (source_message_id) references messages(id) on delete set null;

alter table workouts
  drop constraint if exists workouts_source_message_id_fkey;

alter table workouts
  add constraint workouts_source_message_id_fkey
  foreign key (source_message_id) references messages(id) on delete set null;

alter table reminders
  drop constraint if exists reminders_source_message_id_fkey;

alter table reminders
  add constraint reminders_source_message_id_fkey
  foreign key (source_message_id) references messages(id) on delete set null;
