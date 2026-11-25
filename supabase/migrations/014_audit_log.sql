-- =====================================================================
--  014_audit_log.sql — Registro de auditoría (solo agregar)
--
--  · Un trigger genérico registra quién cambió qué, con valor anterior y nuevo.
--  · Solo se registran las columnas relevantes de cada tabla (menos ruido).
--  · Nadie puede editar ni borrar el registro desde la app (sin permisos de
--    escritura); solo propietario/administración pueden consultarlo.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_staff_id  uuid constraint audit_log_actor_fk references public.staff_members (id) on delete set null,
  actor_name      text,
  table_name      text not null,
  record_id       text,
  action          text not null check (action in ('insert', 'update', 'delete')),
  changes         jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, occurred_at desc);
create index if not exists audit_log_record_idx on public.audit_log (record_id);

-- tg_argv: columnas a vigilar en UPDATE (vacío = todas salvo updated_at)
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new     jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_watch   text[] := tg_argv;
  v_actor   uuid := public.current_staff_id();
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new)
    loop
      continue when v_key in ('updated_at', 'created_at');
      continue when array_length(v_watch, 1) > 0 and not (v_key = any (v_watch));
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new - 'created_at' - 'updated_at';
  else
    v_changes := v_old - 'created_at' - 'updated_at';
  end if;

  insert into public.audit_log (actor_staff_id, actor_name, table_name, record_id, action, changes)
  values (
    v_actor,
    (select full_name from public.staff_members where id = v_actor),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    lower(tg_op),
    v_changes
  );
  return coalesce(new, old);
end;
$$;

-- Tablas auditadas
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('business_settings',     'update',                  array[]::text[]),
      ('staff_members',         'insert or update or delete', array['full_name','email','role','is_active','is_bookable','commission_type','commission_value','product_commission_rate']),
      ('services',              'insert or update or delete', array['name','price','duration_minutes','processing_minutes','commission_type','commission_value','is_active','online_bookable']),
      ('transactions',          'update',                  array['status','void_reason','voided_by']),
      ('cash_registers',        'insert or update',        array['status','opening_amount','counted_cash','expected_cash','difference']),
      ('cash_movements',        'insert or delete',        array[]::text[]),
      ('appointments',          'update or delete',        array['status','starts_at','staff_id','price','cancellation_reason']),
      ('clients',               'update or delete',        array['full_name','phone','is_active']),
      ('inventory_items',       'insert or update or delete', array['name','price','cost','min_stock','is_active']),
      ('commission_payouts',    'insert',                  array[]::text[]),
      ('appointment_deposits',  'insert or update',        array['status','amount']),
      ('prepaid_plans',         'insert or update or delete', array['name','price','sessions','credit','validity_days','is_active']),
      ('purchase_orders',       'insert or update or delete', array['status','supplier_id'])
    ) as t(tbl, events, cols)
  loop
    if to_regclass('public.' || spec.tbl) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', spec.tbl);
    execute format(
      'create trigger trg_audit_%1$s after %2$s on public.%1$I for each row execute function public.audit_row(%3$s)',
      spec.tbl, spec.events,
      coalesce((select string_agg(quote_literal(c), ', ') from unnest(spec.cols) c), '')
    );
  end loop;
end;
$$;

alter table public.audit_log enable row level security;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated using (public.has_role('owner', 'admin'));
grant select on public.audit_log to authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;
revoke execute on function public.audit_row() from public, anon, authenticated;
