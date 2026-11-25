-- =====================================================================
--  012_client_photos.sql — Fotos de antes y después por cliente
--
--  · Los archivos viven en el bucket PRIVADO "client-photos" (creado en 001);
--    se ven solo con URLs firmadas temporales.
--  · Ruta: <client_id>/<uuid>.<ext>. Límite 5 MB, solo JPG/PNG/WEBP.
--  · Borra la foto quien la subió o administración.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.client_photos (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null constraint client_photos_client_fk references public.clients (id) on delete cascade,
  path        text not null unique check (char_length(path) between 10 and 300),
  kind        text not null default 'after' check (kind in ('before', 'after', 'other')),
  caption     text check (caption is null or char_length(caption) <= 200),
  taken_on    date not null default current_date,
  created_by  uuid constraint client_photos_created_by_fk references public.staff_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- La ruta debe empezar con la carpeta del propio cliente
  constraint client_photos_path_owner check (path like client_id::text || '/%')
);
create index if not exists client_photos_client_idx on public.client_photos (client_id, taken_on desc, created_at desc);

create or replace function public.client_photos_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.created_by := public.current_staff_id();
  new.created_at := now();
  new.caption := nullif(trim(coalesce(new.caption, '')), '');
  return new;
end;
$$;

drop trigger if exists trg_client_photos_before_insert on public.client_photos;
create trigger trg_client_photos_before_insert before insert on public.client_photos
  for each row execute function public.client_photos_before_insert();

alter table public.client_photos enable row level security;
drop policy if exists client_photos_select on public.client_photos;
drop policy if exists client_photos_insert on public.client_photos;
drop policy if exists client_photos_delete on public.client_photos;
create policy client_photos_select on public.client_photos for select to authenticated using (public.is_staff());
create policy client_photos_insert on public.client_photos for insert to authenticated with check (public.is_staff());
create policy client_photos_delete on public.client_photos for delete to authenticated
  using (public.has_role('owner', 'admin') or created_by = public.current_staff_id());
grant select, insert, delete on public.client_photos to authenticated;

-- Storage: límites del bucket y política de borrado
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set public = false,
           file_size_limit = 5242880,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
     where id = 'client-photos';

    execute 'drop policy if exists "client_photos_staff_delete" on storage.objects';
    execute $p$create policy "client_photos_staff_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'client-photos' and (public.has_role('owner', 'admin') or owner = auth.uid()))$p$;
  end if;
end;
$$;
