-- =====================================================================
--  011_visit_surveys.sql — Encuesta de satisfacción después de la visita
--
--  · Recepción genera un enlace único por ticket (token aleatorio de 128 bits).
--  · El cliente responde sin cuenta en /encuesta/<token>: una sola vez y dentro
--    de 30 días. El público solo accede vía dos funciones validadas.
--  · Reporte: promedio por profesional y comentarios recientes.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.visit_surveys (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique check (token ~ '^[0-9a-f]{32}$'),
  transaction_id  uuid not null unique constraint visit_surveys_transaction_fk references public.transactions (id) on delete cascade,
  client_id       uuid constraint visit_surveys_client_fk references public.clients (id) on delete set null,
  staff_id        uuid constraint visit_surveys_staff_fk references public.staff_members (id) on delete set null,
  rating          smallint check (rating between 1 and 5),
  comment         text check (comment is null or char_length(comment) <= 500),
  created_by      uuid constraint visit_surveys_created_by_fk references public.staff_members (id) on delete set null,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  constraint visit_surveys_answer check ((rating is null) = (answered_at is null))
);
create index if not exists visit_surveys_staff_idx on public.visit_surveys (staff_id, answered_at desc);
create index if not exists visit_surveys_answered_idx on public.visit_surveys (answered_at desc) where answered_at is not null;

-- Genera (o reutiliza) la encuesta de un ticket
create or replace function public.create_visit_survey(p_transaction_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_tx    public.transactions;
  v_token text;
  v_staff uuid;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para enviar encuestas' using errcode = '42501';
  end if;
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found or v_tx.status <> 'completed' then
    raise exception 'La venta no existe o fue anulada' using errcode = 'P0002';
  end if;

  select token into v_token from public.visit_surveys where transaction_id = p_transaction_id;
  if v_token is not null then
    return v_token;
  end if;

  -- Profesional principal: el del servicio de mayor importe
  select staff_id into v_staff from public.transaction_items
   where transaction_id = p_transaction_id and item_kind = 'service' and staff_id is not null
   order by quantity * unit_price desc
   limit 1;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.visit_surveys (token, transaction_id, client_id, staff_id, created_by)
  values (v_token, p_transaction_id, v_tx.client_id, v_staff, public.current_staff_id());
  return v_token;
end;
$$;

-- Lectura pública mínima (sin datos personales salvo el nombre de pila)
create or replace function public.public_get_survey(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v public.visit_surveys;
  s public.business_settings;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into v from public.visit_surveys where token = p_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into s from public.business_settings limit 1;
  return jsonb_build_object(
    'found', true,
    'business_name', s.business_name,
    'logo_url', s.logo_url,
    'client_name', (select split_part(trim(full_name), ' ', 1) from public.clients where id = v.client_id),
    'staff_name', (select public.public_staff_name(full_name) from public.staff_members where id = v.staff_id),
    'services', coalesce((select jsonb_agg(distinct description) from public.transaction_items
                           where transaction_id = v.transaction_id and item_kind = 'service'), '[]'::jsonb),
    'answered', v.answered_at is not null,
    'expired', v.created_at < now() - interval '30 days'
  );
end;
$$;

create or replace function public.public_submit_survey(p_token text, p_rating integer, p_comment text default null)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v public.visit_surveys;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    raise exception 'Encuesta no encontrada' using errcode = 'P0002';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Elige una calificación de 1 a 5' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 500 then
    raise exception 'El comentario no puede superar 500 caracteres' using errcode = '22023';
  end if;
  select * into v from public.visit_surveys where token = p_token for update;
  if not found then
    raise exception 'Encuesta no encontrada' using errcode = 'P0002';
  end if;
  if v.answered_at is not null then
    raise exception 'Esta encuesta ya fue respondida. ¡Gracias!' using errcode = 'P0001';
  end if;
  if v.created_at < now() - interval '30 days' then
    raise exception 'El enlace de la encuesta venció' using errcode = 'P0001';
  end if;
  update public.visit_surveys
     set rating = p_rating, comment = nullif(trim(coalesce(p_comment, '')), ''), answered_at = now()
   where id = v.id;
  return true;
end;
$$;

-- Promedio por profesional (respeta RLS)
create or replace function public.report_survey_summary(p_from date, p_to date)
returns table (staff_id uuid, full_name text, responses bigint, average numeric, promoters bigint, detractors bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select v.staff_id, coalesce(m.full_name, 'Sin asignar'), count(*)::bigint, round(avg(v.rating), 2)::numeric,
         count(*) filter (where v.rating = 5)::bigint, count(*) filter (where v.rating <= 3)::bigint
    from public.visit_surveys v
    left join public.staff_members m on m.id = v.staff_id
   where v.answered_at >= v_start and v.answered_at < v_end
   group by v.staff_id, m.full_name
   order by 4 desc, 3 desc;
end;
$$;

alter table public.visit_surveys enable row level security;
drop policy if exists visit_surveys_select on public.visit_surveys;
create policy visit_surveys_select on public.visit_surveys for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
grant select on public.visit_surveys to authenticated;
revoke insert, update, delete on public.visit_surveys from authenticated;

revoke execute on function public.create_visit_survey(uuid) from public, anon;
grant execute on function public.create_visit_survey(uuid) to authenticated;
revoke execute on function public.public_get_survey(text) from public;
revoke execute on function public.public_submit_survey(text, integer, text) from public;
grant execute on function public.public_get_survey(text) to anon, authenticated;
grant execute on function public.public_submit_survey(text, integer, text) to anon, authenticated;
revoke execute on function public.report_survey_summary(date, date) from public, anon;
grant execute on function public.report_survey_summary(date, date) to authenticated;
