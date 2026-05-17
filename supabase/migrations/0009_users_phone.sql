-- Migration 0009 — Add phone column to public.users for engineer contact info.
alter table users add column if not exists phone text;
