alter table if exists public.tasks
  add column if not exists due_date date;
