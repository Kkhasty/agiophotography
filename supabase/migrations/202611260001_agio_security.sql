-- Agio Photography: secure Supabase foundation
-- Safe to run alongside the existing agio_records table.
-- Does not delete existing records or change your live website.

create table if not exists public.agio_staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('super_admin','administrator','staff','photographer')),
  photographer_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agio_staff_profiles enable row level security;

create or replace function public.agio_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agio_staff_profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role in ('super_admin','administrator')
  );
$$;

revoke all on function public.agio_is_admin() from public;
grant execute on function public.agio_is_admin() to authenticated;

drop policy if exists "Staff can read own profile" on public.agio_staff_profiles;
create policy "Staff can read own profile"
on public.agio_staff_profiles for select
to authenticated
using (user_id = auth.uid() or public.agio_is_admin());

drop policy if exists "Admins can manage staff profiles" on public.agio_staff_profiles;
create policy "Admins can manage staff profiles"
on public.agio_staff_profiles for all
to authenticated
using (public.agio_is_admin())
with check (public.agio_is_admin());

-- Existing agio_records remains the data store for the current site's records.
-- Public visitors can read only the public catalogue and approved reviews.
alter table public.agio_records enable row level security;

drop policy if exists "Public can view photography services" on public.agio_records;
drop policy if exists "Visitors can submit bookings and inquiries" on public.agio_records;
drop policy if exists "Agio public catalogue read" on public.agio_records;
drop policy if exists "Agio admins manage records" on public.agio_records;

create policy "Agio public catalogue read"
on public.agio_records for select
to anon, authenticated
using (
  collection in ('Services','Photographers')
  or (collection = 'Reviews' and coalesce(data->>'status','') = 'approved')
);

create policy "Agio admins manage records"
on public.agio_records for all
to authenticated
using (public.agio_is_admin())
with check (public.agio_is_admin());

revoke insert, update, delete on public.agio_records from anon;
grant select on public.agio_records to anon, authenticated;
grant insert, update, delete on public.agio_records to authenticated;

-- The Edge Functions use the server-only service role key and perform
-- authorization checks before reading or changing private records.
