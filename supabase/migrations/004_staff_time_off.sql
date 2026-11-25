-- =====================================================================
--  004_staff_time_off.sql — Bloqueos y ausencias del personal
--
--  · Vacaciones, descanso médico, almuerzo, salida temprana, capacitación…
--  · La base de datos impide agendar (o mover) una cita sobre un bloqueo.
--  · Los especialistas pueden gestionar sus propios bloqueos; recepción y
--    administración, los de todo el equipo.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.staff_time_off (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null constraint staff_time_off_staff_fk references public.staff_members (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  kind        text not null default 'personal'
              check (kind in ('vacation', 'sick', 'break', 'personal', 'training', 'other')),
  reason      text check (reason is null or char_length(reason) <= 200),
  created_by  uuid constraint staff_time_off_created_by_fk references public.staff_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_time_off_order  check (ends_at > starts_at),
  constraint staff_time_off_length check (ends_at - starts_at <= interval '370 days')
);
create index if not exists staff_time_off_staff_idx on public.staff_time_off (staff_id, starts_at);
create index if not exists staff_time_off_range_idx on public.staff_time_off using gist (tstzrange(starts_at, ends_at, '[)'));

drop trigger if exists trg_staff_time_off_updated_at on public.staff_time_off;
create trigger trg_staff_time_off_updated_at
  before update on public.staff_time_off
  for each row execute function public.set_updated_at();

create or replace function public.staff_time_off_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.reason := nullif(trim(coalesce(new.reason, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := public.current_staff_id();
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_time_off_before_write on public.staff_time_off;
create trigger trg_staff_time_off_before_write
  before insert or update on public.staff_time_off
  for each row execute function public.staff_time_off_before_write();

-- ---------------------------------------------------------------------
-- Citas: no se pueden agendar sobre un bloqueo del profesional.
-- Se ejecuta DESPUÉS de trg_appointments_before_write (orden alfabético),
-- cuando ends_at ya está calculado.
-- ---------------------------------------------------------------------
create or replace function public.appointments_check_time_off()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_block public.staff_time_off;
begin
  -- Una cita cancelada/no asistida no ocupa el horario; una completada ya ocurrió (no debe bloquear un cobro)
  if new.status in ('cancelled', 'no_show', 'completed') then
    return new;
  end if;

  -- Solo se valida al crear, al mover/cambiar de profesional o al reactivar una cita
  if tg_op = 'UPDATE'
     and new.staff_id = old.staff_id
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and old.status not in ('cancelled', 'no_show') then
    return new;
  end if;

  select * into v_block
    from public.staff_time_off b
   where b.staff_id = new.staff_id
     and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
   order by b.starts_at
   limit 1;

  if found then
    raise exception '%', format(
      'El profesional no está disponible: tiene un bloqueo de %s a %s%s',
      to_char(v_block.starts_at at time zone public.business_tz(), 'DD/MM HH24:MI'),
      to_char(v_block.ends_at at time zone public.business_tz(), 'DD/MM HH24:MI'),
      coalesce(' (' || v_block.reason || ')', '')
    ) using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_time_off_check on public.appointments;
create trigger trg_appointments_time_off_check
  before insert or update on public.appointments
  for each row execute function public.appointments_check_time_off();

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.staff_time_off enable row level security;

drop policy if exists time_off_select on public.staff_time_off;
drop policy if exists time_off_insert on public.staff_time_off;
drop policy if exists time_off_update on public.staff_time_off;
drop policy if exists time_off_delete on public.staff_time_off;

create policy time_off_select on public.staff_time_off for select to authenticated using (public.is_staff());
create policy time_off_insert on public.staff_time_off for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
create policy time_off_update on public.staff_time_off for update to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id())
  with check (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
create policy time_off_delete on public.staff_time_off for delete to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());

grant select, insert, update, delete on public.staff_time_off to authenticated;

-- Realtime para que la agenda refleje los bloqueos al instante
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.staff_time_off;
    exception when duplicate_object then
      null;
    end;
  end if;
end;
$$;
