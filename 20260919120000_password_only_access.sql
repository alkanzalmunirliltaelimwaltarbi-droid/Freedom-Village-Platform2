-- Final password-only access model.
-- The browser never stores the access password. Supabase Auth creates an anonymous session,
-- and the Edge Function authorizes that session after checking the password hash stored here.

create table if not exists public.access_config (
  id integer primary key check (id=1),
  access_password_hash text not null,
  access_password_salt text not null,
  admin_password_hash text not null,
  admin_password_salt text not null,
  pbkdf2_iterations integer not null default 310000,
  updated_at timestamptz not null default now()
);

-- High-entropy initial passwords. Change them later through the documented SQL/management flow.
insert into public.access_config(id, access_password_hash, access_password_salt, admin_password_hash, admin_password_salt, pbkdf2_iterations)
values (
  1,
  '6c5ddeb42401bbc877daf804fb577c6f4bbebf054d1eded9e7a41e0099b73087',
  '6d37ef3d7d6cef2cf568e40e4fbbdff5',
  '6ff8d263120606e5fdee6863e96c127dc57f7437d0654a8dead8777fe3c58f4c',
  '276fc80c78cd1dcb86f4cbdf5b416fa9',
  310000
)
on conflict (id) do nothing;

alter table public.access_config enable row level security;
drop policy if exists access_config_none on public.access_config;
-- No browser role can read this table. The Edge Function uses the privileged secret key.

create or replace function public.has_access()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt()->'app_metadata'->>'access_granted')::boolean, false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false)
     and public.has_access();
$$;

-- Lock down every application table to authorized anonymous sessions.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id=auth.uid() or public.is_admin());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id=auth.uid() and public.has_access());
create policy profiles_update on public.profiles for update to authenticated
  using (id=auth.uid() and public.has_access())
  with check (id=auth.uid() and public.has_access() and is_admin=false);
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin());

drop policy if exists content_select on public.content_items;
drop policy if exists content_admin_insert on public.content_items;
drop policy if exists content_admin_update on public.content_items;
drop policy if exists content_admin_delete on public.content_items;
create policy content_select on public.content_items for select to authenticated using (public.has_access());
create policy content_admin_insert on public.content_items for insert to authenticated with check (public.is_admin());
create policy content_admin_update on public.content_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy content_admin_delete on public.content_items for delete to authenticated using (public.is_admin());

drop policy if exists requests_select on public.requests;
drop policy if exists requests_insert on public.requests;
drop policy if exists requests_update on public.requests;
drop policy if exists requests_delete on public.requests;
create policy requests_select on public.requests for select to authenticated using (public.has_access() and (user_id=auth.uid() or public.is_admin()));
create policy requests_insert on public.requests for insert to authenticated with check (public.has_access() and user_id=auth.uid());
create policy requests_update on public.requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy requests_delete on public.requests for delete to authenticated using (public.is_admin());

drop policy if exists prayer_select on public.prayer_times;
drop policy if exists prayer_admin_write on public.prayer_times;
create policy prayer_select on public.prayer_times for select to authenticated using (public.has_access());
create policy prayer_admin_write on public.prayer_times for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_select on public.app_settings;
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.has_access());
create policy settings_admin_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Storage: anyone with a valid application session can read public assets; only admin sessions write/delete.
drop policy if exists assets_public_read on storage.objects;
drop policy if exists assets_admin_insert on storage.objects;
drop policy if exists assets_admin_update on storage.objects;
drop policy if exists assets_admin_delete on storage.objects;
create policy assets_public_read on storage.objects for select using (bucket_id='public-assets');
create policy assets_admin_insert on storage.objects for insert to authenticated with check (bucket_id='public-assets' and public.is_admin());
create policy assets_admin_update on storage.objects for update to authenticated using (bucket_id='public-assets' and public.is_admin()) with check (bucket_id='public-assets' and public.is_admin());
create policy assets_admin_delete on storage.objects for delete to authenticated using (bucket_id='public-assets' and public.is_admin());

grant select on public.content_items, public.prayer_times, public.app_settings, public.profiles, public.requests to authenticated;
grant insert on public.requests to authenticated;
grant update, delete on public.requests to authenticated;
grant insert, update, delete on public.content_items, public.prayer_times, public.app_settings to authenticated;
grant insert, update, delete on public.profiles to authenticated;

-- Anonymous users do not need a public profile row. Keep legacy permanent-user profiles intact.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
