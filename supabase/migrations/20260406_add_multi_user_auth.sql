alter table public.tasks
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.notes
add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists notes_user_id_idx on public.notes(user_id);

alter table public.tasks enable row level security;
alter table public.notes enable row level security;

drop policy if exists "Users can read own tasks" on public.tasks;
create policy "Users can read own tasks"
on public.tasks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks"
on public.tasks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
on public.tasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own tasks" on public.tasks;
create policy "Users can delete own tasks"
on public.tasks
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own notes" on public.notes;
create policy "Users can read own notes"
on public.notes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own notes" on public.notes;
create policy "Users can insert own notes"
on public.notes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own notes" on public.notes;
create policy "Users can update own notes"
on public.notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notes" on public.notes;
create policy "Users can delete own notes"
on public.notes
for delete
to authenticated
using (auth.uid() = user_id);
