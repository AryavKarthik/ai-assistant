-- Add voice preferences JSONB column to user_preferences.
-- Used by the Nova Mac Electron app to store VoicePreferences as a JSON blob.

alter table user_preferences
  add column if not exists voice jsonb not null default '{}';
