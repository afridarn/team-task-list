-- =====================================================================
-- INAP Task Hub - Supabase schema
-- Run ONCE in: Supabase Dashboard > SQL Editor > New query > paste > Run
-- Safe to re-run (idempotent).
--
-- Security model (enforced by the database, not by the web page):
--   * Nobody can read or write anything without signing in (anon has no access).
--   * A new account is INACTIVE until an admin activates it, so even if sign-ups
--     were left open by mistake, strangers could not see any data.
--   * members: read all tasks, create tasks, edit only tasks assigned to or
--     created by them.   admins: everything, incl. delete, users, import.
--   * Every task change is written to audit_log by a trigger (cannot be skipped
--     or forged from the browser).
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  role         text not null default 'member' check (role in ('admin', 'member')),
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.tasks (
  id           bigint generated always as identity primary key,
  task_type    text not null default '' check (char_length(task_type) <= 60),
  domain       text not null default '' check (char_length(domain) <= 80),
  title        text not null check (char_length(btrim(title)) between 1 and 300),
  assignee_id  uuid references public.profiles(id) on delete set null,
  customer_pic text not null default '' check (char_length(customer_pic) <= 200),
  status       text not null default 'Pending' check (status in ('Pending', 'On Work', 'Finished')),
  progress     integer not null default 0 check (progress between 0 and 100),
  priority     text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  deadline     timestamp,                                  -- wall-clock time, no timezone
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  summary      text not null default '' check (char_length(summary) <= 20000),
  notes        text not null default '' check (char_length(notes) <= 20000),
  created_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);
create index if not exists tasks_assignee_idx on public.tasks(assignee_id);
create index if not exists tasks_status_idx   on public.tasks(status);

create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  user_id  uuid,
  username text,
  action   text not null,
  task_id  bigint,
  detail   text not null default ''
);
create index if not exists audit_task_idx on public.audit_log(task_id);

-- ------------------------------------------------------ helper functions
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

revoke all on function public.is_active() from public, anon;
revoke all on function public.is_admin()  from public, anon;
grant execute on function public.is_active() to authenticated;
grant execute on function public.is_admin()  to authenticated;

-- ---------------------------------------- new auth user -> profile (inactive)
-- The very first account becomes an active admin so you can get started.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, display_name, role, active)
  values (new.id,
          coalesce(new.email, ''),
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'user'), '@', 1)),
          case when first_user then 'admin' else 'member' end,
          first_user);
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- accounts that already existed before this script ran (earliest one = admin)
insert into public.profiles (id, email, display_name, role, active)
select u.id, coalesce(u.email, ''), split_part(coalesce(u.email, 'user'), '@', 1),
       case when u.created_at = (select min(created_at) from auth.users) then 'admin' else 'member' end,
       u.created_at = (select min(created_at) from auth.users)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- --------------------------------------------- task housekeeping (server side)
create or replace function public.tasks_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();                          -- cannot be forged
    new.created_at := coalesce(new.created_at, now());     -- import keeps original dates
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();

  if new.status = 'Finished' then
    new.progress := 100;
    if tg_op = 'INSERT' then
      new.finished_at := coalesce(new.finished_at, now());
    elsif old.status = 'Finished' then
      new.finished_at := coalesce(old.finished_at, now());
    else
      new.finished_at := now();
    end if;
  else
    new.finished_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- ----------------------------------------------------------------- audit
create or replace function public.audit_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text; diff jsonb := '{}'::jsonb; k text; o jsonb; n jsonb;
begin
  select coalesce(display_name, email) into who from public.profiles where id = auth.uid();
  who := coalesce(who, 'system');
  if tg_op = 'INSERT' then
    insert into public.audit_log (user_id, username, action, task_id, detail)
    values (auth.uid(), who, 'task_created', new.id, left(new.title, 200));
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'updated_by', 'finished_at', 'created_at', 'created_by')
         and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(left(coalesce(o ->> k, ''), 80), left(coalesce(n ->> k, ''), 80)));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.audit_log (user_id, username, action, task_id, detail)
      values (auth.uid(), who, 'task_updated', new.id, diff::text);
    end if;
  else
    insert into public.audit_log (user_id, username, action, task_id, detail)
    values (auth.uid(), who, 'task_deleted', old.id, left(old.title, 200));
  end if;
  return null;
end $$;
revoke all on function public.audit_task() from public, anon, authenticated;

drop trigger if exists tasks_audit on public.tasks;
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.audit_task();

-- ----------------------------------- profile guard: keep at least one admin
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'At least one active admin is required.';
  end if;
  if new.role is distinct from old.role or new.active is distinct from old.active
     or new.display_name is distinct from old.display_name then
    select coalesce(display_name, email) into who from public.profiles where id = auth.uid();
    insert into public.audit_log (user_id, username, action, detail)
    values (auth.uid(), coalesce(who, 'system'), 'user_updated',
            old.email || ': ' || old.role || '/' || case when old.active then 'active' else 'inactive' end
            || ' -> ' || new.role || '/' || case when new.active then 'active' else 'inactive' end);
  end if;
  return new;
end $$;
revoke all on function public.profiles_guard() from public, anon, authenticated;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ------------------------------------------------- privileges + row security
revoke all on table public.profiles, public.tasks, public.audit_log from anon, public;
grant select, update on public.profiles  to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select on public.audit_log to authenticated;

alter table public.profiles  enable row level security;
alter table public.tasks     enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());       -- an inactive user may read only their own row

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_active());

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_active());

-- members may edit only tasks assigned to them or created by them; admins may edit all
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_active() and (public.is_admin() or assignee_id = auth.uid() or created_by = auth.uid()))
  with check (public.is_active());

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin());

-- audit log: readable by active users, writable only by the triggers above
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_active());
