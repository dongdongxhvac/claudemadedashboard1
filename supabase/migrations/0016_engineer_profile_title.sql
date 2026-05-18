-- Migration 0016 — Add engineer_profiles.title (free-form job title).
--
-- Used by the User Profiles admin tab. Examples: "Lead Engineer",
-- "Building Engineer", "BMS Specialist", "Apprentice". Free text so admin
-- doesn't need a schema change every time a new title is needed.

alter table engineer_profiles
  add column if not exists title text;
