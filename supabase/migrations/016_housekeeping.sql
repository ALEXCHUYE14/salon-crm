-- =====================================================================
--  016_housekeeping.sql — Limpieza periódica para contener el tamaño de la BD
--
--  Solo borra datos que ya no aportan valor:
--    · audit_log con más de 400 días (13 meses: permite comparar contra el año anterior)
--    · encuestas NO respondidas con más de 90 días (el enlace vence a los 30)
--  Nunca toca ventas, citas, clientes, caja, comisiones ni inventario.
--  Si la extensión pg_cron está activa (Database → Extensions), se programa
--  cada domingo. Si no, el propietario puede ejecutar: select public.purge_old_records();
--  Re-ejecutable.
-- =====================================================================

create or replace function public.purge_old_records_job()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_audit   integer := 0;
  v_surveys integer := 0;
begin
  if to_regclass('public.audit_log') is not null then
    delete from public.audit_log where occurred_at < now() - interval '400 days';
    get diagnostics v_audit = row_count;
  end if;
  if to_regclass('public.visit_surveys') is not null then
    delete from public.visit_surveys where answered_at is null and created_at < now() - interval '90 days';
    get diagnostics v_surveys = row_count;
  end if;
  return jsonb_build_object('audit_log', v_audit, 'visit_surveys', v_surveys);
end;
$$;

-- Versión para la app: solo el propietario
create or replace function public.purge_old_records()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_role('owner') then
    raise exception 'Solo el propietario puede ejecutar la limpieza' using errcode = '42501';
  end if;
  return public.purge_old_records_job();
end;
$$;

revoke execute on function public.purge_old_records_job() from public, anon, authenticated;
revoke execute on function public.purge_old_records() from public, anon;
grant execute on function public.purge_old_records() to authenticated;

-- Programación semanal (domingo 03:30 hora de Lima = 08:30 UTC), solo si pg_cron existe
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('salon-housekeeping', '30 8 * * 0', 'select public.purge_old_records_job();');
    exception when others then
      raise notice 'No se pudo programar la limpieza automática: %', sqlerrm;
    end;
  end if;
end;
$$;
