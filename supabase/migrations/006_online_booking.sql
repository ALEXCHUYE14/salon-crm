-- =====================================================================
--  006_online_booking.sql — Reserva online pública (/reservar)
--
--  Seguridad: el visitante anónimo NO tiene acceso a ninguna tabla. Solo puede
--  ejecutar tres funciones SECURITY DEFINER que validan todo:
--    · public_booking_info()          → datos públicos del negocio y catálogo reservable
--    · public_available_slots(...)    → horarios libres reales
--    · public_create_booking(payload) → crea la cita (origen "online")
--  Antispam: máx. 3 reservas online pendientes por teléfono y tope global por hora.
--  La reserva online está DESACTIVADA por defecto (Ajustes → Reserva online).
--  Re-ejecutable.
-- =====================================================================

alter table public.business_settings
  add column if not exists online_booking_enabled boolean not null default false,
  add column if not exists online_booking_days_ahead integer not null default 30,
  add column if not exists online_booking_min_notice_minutes integer not null default 60,
  add column if not exists online_booking_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_days_check') then
    alter table public.business_settings add constraint business_settings_online_days_check
      check (online_booking_days_ahead between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_notice_check') then
    alter table public.business_settings add constraint business_settings_online_notice_check
      check (online_booking_min_notice_minutes between 0 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_note_check') then
    alter table public.business_settings add constraint business_settings_online_note_check
      check (online_booking_note is null or char_length(online_booking_note) <= 300);
  end if;
end;
$$;

alter table public.services add column if not exists online_bookable boolean not null default true;

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------

-- ¿Puede este profesional atender este segmento de servicio?
create or replace function public.staff_can_serve(p_specialty text, p_segment text)
returns boolean
language sql immutable
as $$
  select case
    when p_specialty = 'none' then false
    when p_segment = 'both' or p_specialty = 'both' then true
    when p_segment = 'barbershop' then p_specialty = 'barber'
    when p_segment = 'beauty_salon' then p_specialty = 'stylist'
    else false
  end;
$$;

-- ¿El segmento es visible según el modo operativo del negocio?
create or replace function public.segment_visible(p_segment text, p_mode text)
returns boolean
language sql immutable
as $$
  select case p_mode
    when 'barbershop' then p_segment in ('barbershop', 'both')
    when 'beauty_salon' then p_segment in ('beauty_salon', 'both')
    else true
  end;
$$;

-- Nombre público del profesional: "Carlos M."
create or replace function public.public_staff_name(p_full_name text)
returns text
language sql immutable
as $$
  select case
    when array_length(regexp_split_to_array(trim(p_full_name), '\s+'), 1) > 1
      then split_part(trim(p_full_name), ' ', 1) || ' ' ||
           left((regexp_split_to_array(trim(p_full_name), '\s+'))[2], 1) || '.'
    else trim(p_full_name)
  end;
$$;

-- ---------------------------------------------------------------------
-- 1) Información pública
-- ---------------------------------------------------------------------
create or replace function public.public_booking_info()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s public.business_settings;
begin
  select * into s from public.business_settings limit 1;
  if not found then
    return jsonb_build_object('enabled', false);
  end if;
  if not s.online_booking_enabled then
    return jsonb_build_object('enabled', false, 'business_name', s.business_name, 'phone', s.phone);
  end if;

  return jsonb_build_object(
    'enabled', true,
    'business_name', s.business_name,
    'slogan', s.slogan,
    'logo_url', s.logo_url,
    'phone', s.phone,
    'address', s.address,
    'timezone', s.timezone,
    'currency_symbol', s.currency_symbol,
    'locale', s.locale,
    'days_ahead', s.online_booking_days_ahead,
    'min_notice_minutes', s.online_booking_min_notice_minutes,
    'note', s.online_booking_note,
    'business_hours', s.business_hours,
    'today', (now() at time zone s.timezone)::date,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.service_categories c
       where c.is_active and public.segment_visible(c.segment, s.operating_mode)
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'description', v.description, 'category_id', v.category_id,
               'segment', v.segment, 'duration_minutes', v.duration_minutes + v.processing_minutes, 'price', v.price)
             order by v.sort_order, v.name)
        from public.services v
       where v.is_active and v.online_bookable and public.segment_visible(v.segment, s.operating_mode)
         and exists (select 1 from public.staff_members m
                      where m.is_active and m.is_bookable and public.staff_can_serve(m.specialty, v.segment))
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'name', public.public_staff_name(m.full_name), 'specialty', m.specialty, 'color', m.color)
             order by m.full_name)
        from public.staff_members m
       where m.is_active and m.is_bookable and m.specialty <> 'none'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Horarios disponibles de un día
-- ---------------------------------------------------------------------
create or replace function public.public_available_slots(p_service_id uuid, p_date date, p_staff_id uuid default null)
returns table (slot_time text, staff_id uuid)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  s           public.business_settings;
  v_service   public.services;
  v_tz        text;
  v_today     date;
  v_total     integer;
  v_interval  integer;
  v_earliest  timestamptz;
  v_dow       integer;
  v_bh        jsonb;
begin
  select * into s from public.business_settings limit 1;
  if not found or not s.online_booking_enabled then
    return;
  end if;
  v_tz := s.timezone;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date < v_today or p_date > v_today + s.online_booking_days_ahead then
    return;
  end if;

  select * into v_service from public.services
   where id = p_service_id and is_active and online_bookable and public.segment_visible(segment, s.operating_mode);
  if not found then
    return;
  end if;

  v_total    := v_service.duration_minutes + v_service.processing_minutes;
  v_interval := s.slot_interval_minutes;
  v_earliest := now() + make_interval(mins => s.online_booking_min_notice_minutes);
  v_dow      := extract(dow from p_date)::integer;

  select value into v_bh from jsonb_array_elements(s.business_hours) where (value ->> 'day')::integer = v_dow limit 1;
  if v_bh is null or coalesce((v_bh ->> 'open')::boolean, false) = false then
    return;
  end if;

  return query
  with staff as (
    select m.id, m.full_name,
           -- Ventana de trabajo: turno del profesional ∩ horario del negocio (sin turno definido = horario del negocio)
           greatest((v_bh ->> 'start')::time, coalesce((ws ->> 'start')::time, (v_bh ->> 'start')::time)) as w_start,
           least((v_bh ->> 'end')::time, coalesce((ws ->> 'end')::time, (v_bh ->> 'end')::time)) as w_end
      from public.staff_members m
      left join lateral (
        select value as ws from jsonb_array_elements(m.work_schedule)
         where (value ->> 'day')::integer = v_dow limit 1
      ) w on true
     where m.is_active and m.is_bookable
       and public.staff_can_serve(m.specialty, v_service.segment)
       and (p_staff_id is null or m.id = p_staff_id)
       -- Si tiene turnos definidos y ninguno es para este día, no trabaja
       and (jsonb_array_length(m.work_schedule) = 0 or w.ws is not null)
  ),
  candidates as (
    select st.id as staff_id, st.full_name,
           ((p_date::timestamp + st.w_start) + make_interval(mins => g.n * v_interval)) at time zone v_tz as starts_at
      from staff st
      cross join lateral generate_series(
        0, greatest(-1, floor((extract(epoch from (st.w_end - st.w_start)) / 60 - v_total) / v_interval)::integer)
      ) as g(n)
     where st.w_end > st.w_start
  ),
  free as (
    select c.staff_id, c.full_name, c.starts_at
      from candidates c
     where c.starts_at >= v_earliest
       and not exists (
         select 1 from public.appointments a
          where a.staff_id = c.staff_id
            and a.status not in ('cancelled', 'no_show')
            and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_total), '[)')
       )
       and not exists (
         select 1 from public.staff_time_off b
          where b.staff_id = c.staff_id
            and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_total), '[)')
       )
  ),
  load as (
    -- Carga del día por profesional, para repartir las reservas "sin preferencia"
    select f.staff_id, (
      select count(*) from public.appointments a
       where a.staff_id = f.staff_id and a.status not in ('cancelled', 'no_show')
         and a.starts_at >= (p_date::timestamp at time zone v_tz) and a.starts_at < ((p_date + 1)::timestamp at time zone v_tz)
    ) as n
      from (select distinct staff_id from free) f
  )
  select distinct on (f.starts_at)
         to_char(f.starts_at at time zone v_tz, 'HH24:MI'), f.staff_id
    from free f
    join load l on l.staff_id = f.staff_id
   order by f.starts_at, l.n, f.full_name;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Crear la reserva
-- ---------------------------------------------------------------------
create or replace function public.public_create_booking(p_payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  s            public.business_settings;
  v_service    public.services;
  v_tz         text;
  v_date       date;
  v_time       text := p_payload ->> 'time';
  v_staff_req  uuid;
  v_staff      uuid;
  v_name       text := trim(coalesce(p_payload ->> 'name', ''));
  v_phone_raw  text := trim(coalesce(p_payload ->> 'phone', ''));
  v_phone      text;
  v_email      text := nullif(lower(trim(coalesce(p_payload ->> 'email', ''))), '');
  v_notes      text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_client     uuid;
  v_appt       uuid;
  v_starts     timestamptz;
  v_staff_name text;
begin
  select * into s from public.business_settings limit 1;
  if not found or not s.online_booking_enabled then
    raise exception 'La reserva online no está disponible en este momento' using errcode = 'P0001';
  end if;
  v_tz := s.timezone;

  -- Validación de datos de contacto
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Escribe tu nombre (entre 2 y 80 caracteres)' using errcode = '22023';
  end if;
  v_phone := regexp_replace(v_phone_raw, '\D', '', 'g');
  if char_length(v_phone) < 6 or char_length(v_phone) > 15 then
    raise exception 'Escribe un teléfono válido' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'El correo no es válido' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 300 then
    raise exception 'El comentario no puede superar 300 caracteres' using errcode = '22023';
  end if;
  if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Elige un horario' using errcode = '22023';
  end if;
  begin
    v_date := (p_payload ->> 'date')::date;
    v_staff_req := nullif(p_payload ->> 'staff_id', '')::uuid;
    select * into v_service from public.services where id = (p_payload ->> 'service_id')::uuid;
  exception when others then
    raise exception 'Datos de reserva inválidos' using errcode = '22023';
  end;
  if v_service.id is null or not v_service.is_active or not v_service.online_bookable then
    raise exception 'El servicio elegido no está disponible' using errcode = 'P0001';
  end if;

  -- Antispam: reservas online pendientes por teléfono y tope global
  if (select count(*) from public.appointments a
        join public.clients c on c.id = a.client_id
       where a.source = 'online' and a.status in ('scheduled', 'confirmed') and a.starts_at > now()
         and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = right(v_phone, 9)) >= 3 then
    raise exception 'Ya tienes 3 reservas pendientes. Escríbenos si necesitas otra cita.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments where source = 'online' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Estamos recibiendo muchas reservas. Inténtalo en unos minutos.' using errcode = 'P0001';
  end if;

  -- El horario debe seguir libre (misma regla que la lista de horarios)
  select f.staff_id into v_staff
    from public.public_available_slots(v_service.id, v_date, v_staff_req) f
   where f.slot_time = v_time
   limit 1;
  if v_staff is null then
    raise exception 'Ese horario ya no está disponible. Elige otro, por favor.' using errcode = 'P0001';
  end if;
  v_starts := (v_date::timestamp + v_time::time) at time zone v_tz;

  -- Cliente: se reutiliza la ficha por teléfono (últimos 9 dígitos) o se crea una nueva
  select id into v_client from public.clients
   where is_active and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_phone, 9)
   order by updated_at desc
   limit 1;
  if v_client is null then
    insert into public.clients (full_name, phone, email, segment, notes, tags)
    values (v_name, v_phone, v_email, v_service.segment, 'Registrado desde la reserva online', '{online}')
    returning id into v_client;
  end if;

  begin
    insert into public.appointments (client_id, staff_id, service_id, starts_at, status, source, notes)
    values (v_client, v_staff, v_service.id, v_starts, 'scheduled', 'online',
            case when v_notes is not null then 'Reserva online: ' || v_notes else 'Reserva online' end)
    returning id into v_appt;
  exception
    when exclusion_violation or raise_exception then
      raise exception 'Ese horario acaba de ser reservado. Elige otro, por favor.' using errcode = 'P0001';
  end;

  select public.public_staff_name(full_name) into v_staff_name from public.staff_members where id = v_staff;

  return jsonb_build_object(
    'reference', upper(left(replace(v_appt::text, '-', ''), 8)),
    'service', v_service.name,
    'staff', v_staff_name,
    'date', v_date,
    'time', v_time,
    'duration_minutes', v_service.duration_minutes + v_service.processing_minutes,
    'price', v_service.price
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos: solo estas funciones quedan expuestas al público
-- ---------------------------------------------------------------------
revoke execute on function public.public_booking_info() from public;
revoke execute on function public.public_available_slots(uuid, date, uuid) from public;
revoke execute on function public.public_create_booking(jsonb) from public;
grant execute on function public.public_booking_info() to anon, authenticated;
grant execute on function public.public_available_slots(uuid, date, uuid) to anon, authenticated;
grant execute on function public.public_create_booking(jsonb) to anon, authenticated;

-- Utilidades: inmutables y sin datos sensibles; no hace falta exponerlas
revoke execute on function public.staff_can_serve(text, text) from public, anon;
revoke execute on function public.segment_visible(text, text) from public, anon;
revoke execute on function public.public_staff_name(text) from public, anon;
grant execute on function public.staff_can_serve(text, text) to authenticated;
grant execute on function public.segment_visible(text, text) to authenticated;
grant execute on function public.public_staff_name(text) to authenticated;
