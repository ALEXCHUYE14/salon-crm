-- =====================================================================
--  015_branches.sql — Multisede
--
--  · Crea "Sede principal" y asigna todo lo existente a ella: con una sola sede
--    el sistema funciona exactamente igual que antes.
--  · Por sede: equipo, agenda, caja abierta (una por sede), ventas y reportes.
--  · Inventario: compartido entre sedes (almacén central).
--  · Las funciones que buscan "la caja abierta" usan la sede indicada; si no se
--    indica y hay varias cajas abiertas, usan la sede del usuario.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 80),
  address     text check (address is null or char_length(address) <= 200),
  phone       text check (phone is null or char_length(phone) <= 40),
  is_main     boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists branches_name_key on public.branches (lower(trim(name)));
create unique index if not exists branches_single_main on public.branches ((true)) where is_main;

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at before update on public.branches for each row execute function public.set_updated_at();

insert into public.branches (name, address, phone, is_main)
select 'Sede principal', s.address, s.phone, true
  from (select address, phone from public.business_settings limit 1) s
 where not exists (select 1 from public.branches where is_main);
insert into public.branches (name, is_main)
select 'Sede principal', true where not exists (select 1 from public.branches where is_main);

create or replace function public.main_branch_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.branches where is_main limit 1;
$$;

-- La sede principal no se puede desactivar ni dejar de ser principal sin otra
create or replace function public.branches_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las sedes no se eliminan; desactívala en su lugar' using errcode = 'P0001';
  end if;
  if old.is_main and (not new.is_main or not new.is_active) then
    raise exception 'La sede principal debe seguir activa' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_branches_guard on public.branches;
create trigger trg_branches_guard before update or delete on public.branches for each row execute function public.branches_guard();

-- ---------------------------------------------------------------------
-- Columnas de sede (con relleno de lo existente)
-- ---------------------------------------------------------------------
alter table public.staff_members  add column if not exists branch_id uuid constraint staff_members_branch_fk references public.branches (id) on delete restrict;
alter table public.appointments   add column if not exists branch_id uuid constraint appointments_branch_fk references public.branches (id) on delete restrict;
alter table public.cash_registers add column if not exists branch_id uuid constraint cash_registers_branch_fk references public.branches (id) on delete restrict;
alter table public.transactions   add column if not exists branch_id uuid constraint transactions_branch_fk references public.branches (id) on delete restrict;

update public.staff_members  set branch_id = public.main_branch_id() where branch_id is null;
update public.cash_registers set branch_id = public.main_branch_id() where branch_id is null;
update public.appointments a set branch_id = coalesce((select s.branch_id from public.staff_members s where s.id = a.staff_id), public.main_branch_id()) where a.branch_id is null;
update public.transactions t set branch_id = coalesce((select r.branch_id from public.cash_registers r where r.id = t.cash_register_id), public.main_branch_id()) where t.branch_id is null;

alter table public.staff_members  alter column branch_id set not null;
alter table public.appointments   alter column branch_id set not null;
alter table public.cash_registers alter column branch_id set not null;
alter table public.transactions   alter column branch_id set not null;

create index if not exists appointments_branch_starts_idx on public.appointments (branch_id, starts_at);
create index if not exists transactions_branch_created_idx on public.transactions (branch_id, created_at desc);

-- Una caja abierta POR SEDE
drop index if exists public.cash_registers_single_open;
create unique index if not exists cash_registers_open_per_branch on public.cash_registers (branch_id) where status = 'open';

-- Valores por defecto
create or replace function public.branch_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'staff_members' then
    new.branch_id := coalesce(new.branch_id, public.main_branch_id());
  elsif tg_table_name = 'appointments' then
    if tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id then
      new.branch_id := coalesce(
        case when tg_op = 'INSERT' then new.branch_id end,
        (select branch_id from public.staff_members where id = new.staff_id),
        public.main_branch_id());
    end if;
  elsif tg_table_name = 'cash_registers' then
    new.branch_id := coalesce(new.branch_id, (select branch_id from public.staff_members where id = public.current_staff_id()), public.main_branch_id());
  elsif tg_table_name = 'transactions' then
    new.branch_id := coalesce((select branch_id from public.cash_registers where id = new.cash_register_id), public.main_branch_id());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_branch_default on public.staff_members;
create trigger trg_staff_branch_default before insert or update on public.staff_members for each row execute function public.branch_defaults();
drop trigger if exists trg_appointments_branch_default on public.appointments;
create trigger trg_appointments_branch_default before insert or update on public.appointments for each row execute function public.branch_defaults();
drop trigger if exists trg_registers_branch_default on public.cash_registers;
create trigger trg_registers_branch_default before insert on public.cash_registers for each row execute function public.branch_defaults();
drop trigger if exists trg_transactions_branch_default on public.transactions;
create trigger trg_transactions_branch_default before insert on public.transactions for each row execute function public.branch_defaults();

-- ---------------------------------------------------------------------
-- Caja abierta de una sede
-- ---------------------------------------------------------------------
create or replace function public.open_register_for(p_branch uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_branch is not null then
    select id into v_id from public.cash_registers where status = 'open' and branch_id = p_branch limit 1;
    return v_id;
  end if;
  if (select count(*) from public.cash_registers where status = 'open') > 1 then
    select r.id into v_id from public.cash_registers r
     where r.status = 'open' and r.branch_id = (select branch_id from public.staff_members where id = public.current_staff_id())
     limit 1;
    return v_id;
  end if;
  select id into v_id from public.cash_registers where status = 'open' limit 1;
  return v_id;
end;
$$;

-- Ajusta las funciones existentes para usar la caja de la sede (reemplazo verificado del texto)
do $$
declare
  v_def text;
  r record;
begin
  for r in
    select * from (values
      ('public.create_sale(jsonb)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1;',
       'v_register := public.open_register_for(nullif(p_payload ->> ''branch_id'', '''')::uuid);'),
      ('public.record_deposit(uuid, numeric, text, text)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1 for update;',
       'v_register := public.open_register_for(v_appt.branch_id);'),
      ('public.resolve_deposit(uuid, text, text)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1 for update;',
       'v_register := public.open_register_for((select a.branch_id from public.appointments a where a.id = v_dep.appointment_id));'),
      ('public.receive_purchase_order(uuid, boolean)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1;',
       'v_register := public.open_register_for(null);')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn);
    if position(r.old_text in v_def) > 0 then
      execute replace(v_def, r.old_text, r.new_text);
    elsif position(r.new_text in v_def) = 0 then
      raise exception 'No se pudo adaptar % a multisede', r.fn;
    end if;
  end loop;
end;
$$;

-- Cierre de caja de una sede (reemplaza la versión sin sede)
drop function if exists public.close_cash_register(numeric, text);
create or replace function public.close_cash_register(p_counted_cash numeric, p_notes text default null, p_branch_id uuid default null)
returns public.cash_registers
language plpgsql security invoker set search_path = public
as $$
declare
  v_reg      public.cash_registers;
  v_id       uuid;
  v_expected numeric;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para cerrar caja' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Ingresa el efectivo contado' using errcode = '22023';
  end if;

  v_id := public.open_register_for(p_branch_id);
  select * into v_reg from public.cash_registers where id = v_id for update;
  if not found then
    raise exception 'No hay una caja abierta' using errcode = 'P0002';
  end if;

  v_expected := (public.register_summary(v_reg.id) ->> 'expected_cash')::numeric;

  update public.cash_registers
     set status        = 'closed',
         closed_at     = now(),
         closed_by     = public.current_staff_id(),
         expected_cash = v_expected,
         counted_cash  = p_counted_cash,
         difference    = p_counted_cash - v_expected,
         notes         = coalesce(nullif(p_notes, ''), notes)
   where id = v_reg.id
  returning * into v_reg;

  return v_reg;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard y reportes con filtro opcional de sede
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_today(date);
create or replace function public.dashboard_today(p_date date default null, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_tz    text := public.business_tz();
  v_day   date := coalesce(p_date, (now() at time zone v_tz)::date);
  v_start timestamptz := (v_day::timestamp at time zone v_tz);
  v_end   timestamptz := ((v_day + 1)::timestamp at time zone v_tz);
  v_out   jsonb;
begin
  select jsonb_build_object(
    'date', v_day,
    'revenue', coalesce((
      select sum(t.subtotal - t.discount_amount) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'tips', coalesce((
      select sum(t.tip_amount) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'transactions', (
      select count(*) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)),
    'commissions', coalesce((
      select sum(ti.commission_amount)
        from public.transaction_items ti
        join public.transactions t on t.id = ti.transaction_id
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'appointments', coalesce((
      select jsonb_object_agg(a.status, a.n)
        from (select status, count(*) as n from public.appointments
               where starts_at >= v_start and starts_at < v_end
                 and (p_branch_id is null or branch_id = p_branch_id)
               group by status) a), '{}'::jsonb),
    'low_stock_count', (select count(*) from public.inventory_items where is_active and is_low_stock),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'stock', i.stock, 'min_stock', i.min_stock,
               'unit', i.unit, 'item_type', i.item_type))
        from (select id, name, stock, min_stock, unit, item_type
                from public.inventory_items
               where is_active and is_low_stock
               order by (stock - min_stock), name
               limit 8) i), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

drop function if exists public.report_revenue_by_day(date, date);
create or replace function public.report_revenue_by_day(p_from date, p_to date, p_branch_id uuid default null)
returns table (day date, revenue numeric, tips numeric, tx_count bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz text := public.business_tz();
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select (p_from + g.i)::date,
         coalesce(sum(t.subtotal - t.discount_amount), 0)::numeric,
         coalesce(sum(t.tip_amount), 0)::numeric,
         count(t.id)::bigint
    from generate_series(0, p_to - p_from) as g(i)
    left join public.transactions t
      on t.status = 'completed'
     and (p_branch_id is null or t.branch_id = p_branch_id)
     and t.created_at >= ((p_from + g.i)::timestamp at time zone v_tz)
     and t.created_at <  ((p_from + g.i + 1)::timestamp at time zone v_tz)
   group by g.i
   order by g.i;
end;
$$;

drop function if exists public.report_staff_performance(date, date);
create or replace function public.report_staff_performance(p_from date, p_to date, p_branch_id uuid default null)
returns table (
  staff_id uuid, full_name text, services_count bigint, services_revenue numeric,
  products_revenue numeric, commission numeric, tips numeric
)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  with items as (
    select ti.staff_id, ti.item_kind, ti.quantity, ti.line_total, ti.commission_amount
      from public.transaction_items ti
      join public.transactions t on t.id = ti.transaction_id
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
       and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  tip_rows as (
    select t.tip_staff_id, sum(t.tip_amount) as amount
      from public.transactions t
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end and t.tip_staff_id is not null
       and (p_branch_id is null or t.branch_id = p_branch_id)
     group by t.tip_staff_id
  )
  select s.id,
         s.full_name,
         coalesce(sum(i.quantity) filter (where i.item_kind = 'service'), 0)::bigint,
         coalesce(sum(i.line_total) filter (where i.item_kind = 'service'), 0)::numeric,
         coalesce(sum(i.line_total) filter (where i.item_kind = 'product'), 0)::numeric,
         coalesce(sum(i.commission_amount), 0)::numeric,
         coalesce(max(tr.amount), 0)::numeric
    from public.staff_members s
    left join items i on i.staff_id = s.id
    left join tip_rows tr on tr.tip_staff_id = s.id
   where (s.is_bookable and (p_branch_id is null or s.branch_id = p_branch_id)) or i.staff_id is not null
   group by s.id, s.full_name
   order by 4 desc, s.full_name;
end;
$$;

drop function if exists public.report_top_services(date, date, integer);
create or replace function public.report_top_services(p_from date, p_to date, p_limit integer default 10, p_branch_id uuid default null)
returns table (service_id uuid, service_name text, quantity numeric, revenue numeric)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  select ti.service_id,
         coalesce(sv.name, max(ti.description)),
         sum(ti.quantity)::numeric,
         sum(ti.line_total)::numeric
    from public.transaction_items ti
    join public.transactions t on t.id = ti.transaction_id
    left join public.services sv on sv.id = ti.service_id
   where ti.item_kind = 'service' and t.status = 'completed'
     and t.created_at >= v_start and t.created_at < v_end
     and (p_branch_id is null or t.branch_id = p_branch_id)
   group by ti.service_id, sv.name
   order by 3 desc, 4 desc
   limit greatest(1, least(p_limit, 50));
end;
$$;

drop function if exists public.report_payment_methods(date, date);
create or replace function public.report_payment_methods(p_from date, p_to date, p_branch_id uuid default null)
returns table (method text, amount numeric, payments bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  select p.method, sum(p.amount)::numeric, count(*)::bigint
    from public.transaction_payments p
    join public.transactions t on t.id = p.transaction_id
   where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
     and (p_branch_id is null or t.branch_id = p_branch_id)
   group by p.method
   order by 2 desc;
end;
$$;

drop function if exists public.report_cash_movements(date, date);
create or replace function public.report_cash_movements(p_from date, p_to date, p_branch_id uuid default null)
returns table (movement_type text, category text, amount numeric, movements bigint)
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
  select m.movement_type, m.category, sum(m.amount)::numeric, count(*)::bigint
    from public.cash_movements m
    join public.cash_registers r on r.id = m.cash_register_id
   where m.created_at >= v_start and m.created_at < v_end
     and (p_branch_id is null or r.branch_id = p_branch_id)
   group by m.movement_type, m.category
   order by 3 desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Reserva online por sede
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- Info pública: agrega sedes y la sede de cada profesional
  v_def := pg_get_functiondef('public.public_booking_info()'::regprocedure);
  if position('''branch_id'', m.branch_id' in v_def) = 0 then
    v_def := replace(v_def,
      '''id'', m.id, ''name'', public.public_staff_name(m.full_name), ''specialty'', m.specialty, ''color'', m.color)',
      '''id'', m.id, ''name'', public.public_staff_name(m.full_name), ''specialty'', m.specialty, ''color'', m.color, ''branch_id'', m.branch_id)');
    v_def := replace(v_def,
      '''today'', (now() at time zone s.timezone)::date,',
      '''today'', (now() at time zone s.timezone)::date,
    ''branches'', coalesce((select jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name, ''address'', b.address) order by b.is_main desc, b.name)
                             from public.branches b where b.is_active), ''[]''::jsonb),');
    if position('''branch_id'', m.branch_id' in v_def) = 0 or position('''branches''' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_booking_info a multisede';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Horarios: filtro opcional por sede (nueva firma; reemplaza la anterior)
do $$
declare
  v_def text;
begin
  if to_regprocedure('public.public_available_slots(uuid, date, uuid)') is not null then
    v_def := pg_get_functiondef('public.public_available_slots(uuid, date, uuid)'::regprocedure);
    v_def := replace(v_def, 'p_staff_id uuid DEFAULT NULL::uuid)', 'p_staff_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)');
    v_def := replace(v_def,
      'and (p_staff_id is null or m.id = p_staff_id)',
      'and (p_staff_id is null or m.id = p_staff_id)
       and (p_branch_id is null or m.branch_id = p_branch_id)');
    if position('p_branch_id uuid DEFAULT NULL::uuid)' in v_def) = 0 or position('m.branch_id = p_branch_id' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_available_slots a multisede';
    end if;
    drop function public.public_available_slots(uuid, date, uuid);
    execute v_def;
  end if;

  -- Crear reserva: respeta la sede elegida (en el mismo bloque, después de la nueva firma de horarios)
  v_def := pg_get_functiondef('public.public_create_booking(jsonb)'::regprocedure);
  if position('p_payload ->> ''branch_id''' in v_def) = 0 then
    v_def := replace(v_def,
      'public.public_available_slots(v_service.id, v_date, v_staff_req)',
      'public.public_available_slots(v_service.id, v_date, v_staff_req, nullif(p_payload ->> ''branch_id'', '''')::uuid)');
    if position('p_payload ->> ''branch_id''' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_create_booking a multisede';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.branches enable row level security;
drop policy if exists branches_select on public.branches;
drop policy if exists branches_write on public.branches;
create policy branches_select on public.branches for select to authenticated using (public.is_staff());
create policy branches_write on public.branches for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
grant select, insert, update on public.branches to authenticated;

revoke execute on function public.open_register_for(uuid) from public, anon;
grant execute on function public.open_register_for(uuid) to authenticated;
revoke execute on function public.main_branch_id() from public, anon;
grant execute on function public.main_branch_id() to authenticated;
revoke execute on function public.close_cash_register(numeric, text, uuid) from public, anon;
grant execute on function public.close_cash_register(numeric, text, uuid) to authenticated;
revoke execute on function public.dashboard_today(date, uuid) from public, anon;
grant execute on function public.dashboard_today(date, uuid) to authenticated;
revoke execute on function public.report_revenue_by_day(date, date, uuid) from public, anon;
grant execute on function public.report_revenue_by_day(date, date, uuid) to authenticated;
revoke execute on function public.report_staff_performance(date, date, uuid) from public, anon;
grant execute on function public.report_staff_performance(date, date, uuid) to authenticated;
revoke execute on function public.report_top_services(date, date, integer, uuid) from public, anon;
grant execute on function public.report_top_services(date, date, integer, uuid) to authenticated;
revoke execute on function public.report_payment_methods(date, date, uuid) from public, anon;
grant execute on function public.report_payment_methods(date, date, uuid) to authenticated;
revoke execute on function public.report_cash_movements(date, date, uuid) from public, anon;
grant execute on function public.report_cash_movements(date, date, uuid) to authenticated;
revoke execute on function public.public_available_slots(uuid, date, uuid, uuid) from public;
grant execute on function public.public_available_slots(uuid, date, uuid, uuid) to anon, authenticated;
revoke execute on function public.public_create_booking(jsonb) from public;
grant execute on function public.public_create_booking(jsonb) to anon, authenticated;
revoke execute on function public.public_booking_info() from public;
grant execute on function public.public_booking_info() to anon, authenticated;
