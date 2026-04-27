alter table if exists public.tasks
  add column if not exists notes text;

alter table if exists public.tasks
  add column if not exists created_at timestamptz default timezone('utc', now());

update public.tasks
set
  notes = coalesce(notes, ''),
  created_at = coalesce(created_at, timezone('utc', now()))
where notes is null or created_at is null;

alter table if exists public.tasks
  alter column notes set default '',
  alter column notes set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null;
