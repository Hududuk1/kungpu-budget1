create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_key text not null default 'kungpu-calendar',
  title text not null,
  starts_on date not null,
  start_time time,
  end_time time,
  all_day boolean not null default true,
  person text not null check (person in ('꿍', '푸', '둘')),
  category text not null default '기타',
  location text not null default '',
  memo text not null default '',
  color text not null default '#86b995',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_memos (
  calendar_key text primary key,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.calendar_events enable row level security;
alter table public.calendar_memos enable row level security;

drop policy if exists "calendar public read events" on public.calendar_events;
drop policy if exists "calendar public insert events" on public.calendar_events;
drop policy if exists "calendar public update events" on public.calendar_events;
drop policy if exists "calendar public delete events" on public.calendar_events;
drop policy if exists "calendar public read memos" on public.calendar_memos;
drop policy if exists "calendar public insert memos" on public.calendar_memos;
drop policy if exists "calendar public update memos" on public.calendar_memos;

create policy "calendar public read events"
on public.calendar_events for select
to authenticated
using (calendar_key = 'kungpu-calendar');

create policy "calendar public insert events"
on public.calendar_events for insert
to authenticated
with check (calendar_key = 'kungpu-calendar');

create policy "calendar public update events"
on public.calendar_events for update
to authenticated
using (calendar_key = 'kungpu-calendar')
with check (calendar_key = 'kungpu-calendar');

create policy "calendar public delete events"
on public.calendar_events for delete
to authenticated
using (calendar_key = 'kungpu-calendar');

create policy "calendar public read memos"
on public.calendar_memos for select
to authenticated
using (calendar_key = 'kungpu-calendar');

create policy "calendar public insert memos"
on public.calendar_memos for insert
to authenticated
with check (calendar_key = 'kungpu-calendar');

create policy "calendar public update memos"
on public.calendar_memos for update
to authenticated
using (calendar_key = 'kungpu-calendar')
with check (calendar_key = 'kungpu-calendar');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_events'
  ) then
    alter publication supabase_realtime add table public.calendar_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_memos'
  ) then
    alter publication supabase_realtime add table public.calendar_memos;
  end if;
end $$;

select 'calendar ready' as result;
