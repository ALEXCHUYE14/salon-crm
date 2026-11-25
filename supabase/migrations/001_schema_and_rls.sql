-- =====================================================================
--  001_schema_and_rls.sql
--  CRM + Agenda + Caja/POS + Comisiones + Inventario
--  Barbería · Salón de Belleza · Modo Mixto
--  Destino: Supabase (PostgreSQL 15+). Ejecutar sobre una base limpia.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm    with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Ajustes del negocio (fila única)
-- ---------------------------------------------------------------------
create table public.business_settings (
  id                        uuid primary key default gen_random_uuid(),
  singleton                 boolean not null default true unique check (singleton),
  business_name             text not null default 'Mi Negocio' check (char_length(trim(business_name)) between 2 and 120),
  slogan                    text,
  tax_id                    text,
  phone                     text,
  email                     text,
  address                   text,
  logo_url                  text,
  operating_mode            text not null default 'hybrid'
                            check (operating_mode in ('barbershop', 'beauty_salon', 'hybrid')),
  enabled_modules           jsonb not null default '{
                              "agenda": true, "clients": true, "services": true, "team": true,
                              "pos": true, "inventory": true, "loyalty": true, "reports": true
                            }'::jsonb check (jsonb_typeof(enabled_modules) = 'object'),
  business_hours            jsonb not null default '[
                              {"day":0,"open":false,"start":"09:00","end":"14:00"},
                              {"day":1,"open":true,"start":"09:00","end":"20:00"},
                              {"day":2,"open":true,"start":"09:00","end":"20:00"},
                              {"day":3,"open":true,"start":"09:00","end":"20:00"},
                              {"day":4,"open":true,"start":"09:00","end":"20:00"},
                              {"day":5,"open":true,"start":"09:00","end":"21:00"},
                              {"day":6,"open":true,"start":"09:00","end":"21:00"}
                            ]'::jsonb check (jsonb_typeof(business_hours) = 'array'),
  timezone                  text not null default 'America/Lima',
  currency_code             text not null default 'PEN' check (char_length(currency_code) = 3),
  currency_symbol           text not null default 'S/' check (char_length(currency_symbol) between 1 and 5),
  locale                    text not null default 'es-PE',
  default_country_code      text not null default '51' check (default_country_code ~ '^[0-9]{1,4}$'),
  default_commission_type   text not null default 'percentage' check (default_commission_type in ('percentage', 'fixed')),
  default_commission_value  numeric(10,2) not null default 40 check (default_commission_value >= 0),
  product_commission_rate   numeric(5,2) not null default 10 check (product_commission_rate between 0 and 100),
  payment_methods           jsonb not null default '[
                              {"key":"cash","label":"Efectivo","enabled":true},
                              {"key":"card","label":"Tarjeta","enabled":true},
                              {"key":"transfer","label":"Transferencia","enabled":true},
                              {"key":"wallet","label":"Billetera digital","enabled":true}
                            ]'::jsonb check (jsonb_typeof(payment_methods) = 'array'),
  message_templates         jsonb not null default '[
                              {"key":"reminder","name":"Recordatorio de cita","body":"Hola {cliente}, te recordamos tu cita de {servicio} con {profesional} el {fecha} a las {hora} en {negocio}. Responde SÍ para confirmar."},
                              {"key":"reactivation","name":"Cliente inactivo","body":"Hola {cliente}, hace {dias} días que no te vemos en {negocio}. Esta semana tenemos espacios disponibles, ¿te reservamos una cita?"},
                              {"key":"birthday","name":"Cumpleaños","body":"¡Feliz cumpleaños, {cliente}! En {negocio} queremos celebrarlo contigo: tienes un detalle especial en tu próxima visita."},
                              {"key":"thanks","name":"Agradecimiento","body":"Gracias por tu visita, {cliente}. En {negocio} esperamos verte pronto."}
                            ]'::jsonb check (jsonb_typeof(message_templates) = 'array'),
  role_permissions          jsonb not null default '{
                              "admin": ["dashboard","agenda","clients","services","team","pos","inventory","loyalty","reports","settings"],
                              "receptionist": ["dashboard","agenda","clients","pos","inventory","loyalty"],
                              "specialist": ["dashboard","agenda","clients"]
                            }'::jsonb check (jsonb_typeof(role_permissions) = 'object'),
  slot_interval_minutes     integer not null default 15 check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  inactive_client_days      integer not null default 45 check (inactive_client_days between 7 and 730),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Equipo
-- ---------------------------------------------------------------------
create table public.staff_members (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid unique,
  full_name                text not null check (char_length(trim(full_name)) between 2 and 120),
  email                    text,
  phone                    text,
  role                     text not null default 'specialist'
                           check (role in ('owner', 'admin', 'receptionist', 'specialist')),
  specialty                text not null default 'both'
                           check (specialty in ('barber', 'stylist', 'both', 'none')),
  station_label            text,
  color                    text not null default '#3F5E4D' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_bookable              boolean not null default true,
  commission_type          text check (commission_type in ('percentage', 'fixed')),
  commission_value         numeric(10,2) check (commission_value >= 0),
  product_commission_rate  numeric(5,2) check (product_commission_rate between 0 and 100),
  work_schedule            jsonb not null default '[]'::jsonb check (jsonb_typeof(work_schedule) = 'array'),
  avatar_url               text,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint staff_commission_pair check ((commission_type is null) = (commission_value is null)),
  constraint staff_commission_pct  check (commission_type is distinct from 'percentage' or commission_value <= 100)
);
create unique index staff_members_email_key on public.staff_members (lower(email)) where email is not null;
create index staff_members_active_idx on public.staff_members (is_active, is_bookable);

do $$
begin
  if to_regclass('auth.users') is not null then
    alter table public.staff_members
      add constraint staff_members_user_fk foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Clientes
-- ---------------------------------------------------------------------
create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null check (char_length(trim(full_name)) between 2 and 120),
  phone               text,
  email               text,
  birth_date          date check (birth_date > date '1900-01-01'),
  birth_month         smallint generated always as (extract(month from birth_date)::smallint) stored,
  gender              text not null default 'unspecified' check (gender in ('female', 'male', 'other', 'unspecified')),
  segment             text not null default 'both' check (segment in ('barbershop', 'beauty_salon', 'both')),
  notes               text,
  tags                text[] not null default '{}',
  preferred_staff_id  uuid constraint clients_preferred_staff_fk references public.staff_members (id) on delete set null,
  marketing_opt_in    boolean not null default true,
  last_visit_at       timestamptz,
  visits_count        integer not null default 0 check (visits_count >= 0),
  total_spent         numeric(12,2) not null default 0 check (total_spent >= 0),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index clients_name_trgm_idx  on public.clients using gin (full_name extensions.gin_trgm_ops);
create index clients_phone_idx      on public.clients (phone);
create index clients_last_visit_idx on public.clients (last_visit_at);
create index clients_birth_month_idx on public.clients (birth_month);

-- ---------------------------------------------------------------------
-- 4. Catálogo de servicios y combos
-- ---------------------------------------------------------------------
create table public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(trim(name)) between 2 and 80),
  segment     text not null default 'both' check (segment in ('barbershop', 'beauty_salon', 'both')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.services (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid constraint services_category_fk references public.service_categories (id) on delete set null,
  name                text not null check (char_length(trim(name)) between 2 and 120),
  description         text,
  segment             text not null default 'both' check (segment in ('barbershop', 'beauty_salon', 'both')),
  duration_minutes    integer not null check (duration_minutes between 5 and 600),
  processing_minutes  integer not null default 0 check (processing_minutes between 0 and 480),
  price               numeric(10,2) not null check (price >= 0),
  commission_type     text check (commission_type in ('percentage', 'fixed')),
  commission_value    numeric(10,2) check (commission_value >= 0),
  is_combo            boolean not null default false,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint services_commission_pair check ((commission_type is null) = (commission_value is null)),
  constraint services_commission_pct  check (commission_type is distinct from 'percentage' or commission_value <= 100)
);
create index services_category_idx on public.services (category_id);
create index services_active_idx   on public.services (is_active, sort_order);

create table public.service_combo_items (
  combo_id    uuid not null,
  service_id  uuid not null,
  quantity    integer not null default 1 check (quantity between 1 and 10),
  primary key (combo_id, service_id),
  constraint service_combo_items_combo_fk   foreign key (combo_id)   references public.services (id) on delete cascade,
  constraint service_combo_items_service_fk foreign key (service_id) references public.services (id) on delete restrict,
  constraint service_combo_items_not_self   check (combo_id <> service_id)
);

-- ---------------------------------------------------------------------
-- 5. Agenda
-- ---------------------------------------------------------------------
create table public.appointments (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid constraint appointments_client_fk  references public.clients (id) on delete set null,
  walk_in_name         text,
  staff_id             uuid not null constraint appointments_staff_fk references public.staff_members (id) on delete restrict,
  service_id           uuid not null constraint appointments_service_fk references public.services (id) on delete restrict,
  starts_at            timestamptz not null,
  duration_minutes     integer not null check (duration_minutes between 5 and 600),
  processing_minutes   integer not null default 0 check (processing_minutes between 0 and 480),
  ends_at              timestamptz not null,
  status               text not null default 'scheduled'
                       check (status in ('scheduled', 'confirmed', 'waiting', 'in_service', 'completed', 'no_show', 'cancelled')),
  price                numeric(10,2) not null check (price >= 0),
  source               text not null default 'walk_in'
                       check (source in ('walk_in', 'phone', 'whatsapp', 'online', 'app')),
  notes                text,
  cancellation_reason  text,
  checked_in_at        timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_by           uuid constraint appointments_created_by_fk references public.staff_members (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint appointments_client_or_walkin check (client_id is not null or nullif(trim(walk_in_name), '') is not null),
  constraint appointments_time_order check (ends_at > starts_at),
  -- Prevención de choques horarios a nivel de base de datos
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'))
);
create index appointments_starts_idx        on public.appointments (starts_at);
create index appointments_staff_starts_idx  on public.appointments (staff_id, starts_at);
create index appointments_client_starts_idx on public.appointments (client_id, starts_at desc);
create index appointments_status_idx        on public.appointments (status);

-- ---------------------------------------------------------------------
-- 6. Ficha técnica dual (barbería / salón)
-- ---------------------------------------------------------------------
create table public.client_technical_records (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null constraint technical_records_client_fk references public.clients (id) on delete cascade,
  staff_id            uuid constraint technical_records_staff_fk references public.staff_members (id) on delete set null,
  appointment_id      uuid constraint technical_records_appointment_fk references public.appointments (id) on delete set null,
  record_type         text not null check (record_type in ('barber', 'color', 'hair_diagnosis', 'nails', 'skin', 'treatment')),
  service_date        date not null default current_date,
  -- Barbería
  cut_style           text,
  fade_type           text,
  clipper_guards      text,
  beard_style         text,
  finish              text,
  -- Salón de belleza
  color_formula       text,
  developer_volume    integer check (developer_volume in (10, 20, 30, 40)),
  processing_minutes  integer check (processing_minutes between 0 and 480),
  hair_diagnosis      text,
  nails_diagnosis     text,
  skin_diagnosis      text,
  -- Común
  products_used       text,
  result_notes        text,
  photos              text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index technical_records_client_idx on public.client_technical_records (client_id, service_date desc);

-- ---------------------------------------------------------------------
-- 7. Inventario
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,
  name          text not null check (char_length(trim(name)) between 2 and 120),
  item_type     text not null check (item_type in ('retail', 'supply')),
  segment       text not null default 'both' check (segment in ('barbershop', 'beauty_salon', 'both')),
  brand         text,
  unit          text not null default 'unidad',
  stock         numeric(12,2) not null default 0 check (stock >= 0),
  min_stock     numeric(12,2) not null default 0 check (min_stock >= 0),
  is_low_stock  boolean generated always as (stock <= min_stock) stored,
  cost          numeric(10,2) not null default 0 check (cost >= 0),
  price         numeric(10,2) check (price >= 0),
  supplier      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint inventory_retail_has_price check (item_type <> 'retail' or price is not null)
);
create index inventory_items_type_idx on public.inventory_items (item_type, is_active);
create index inventory_items_low_idx  on public.inventory_items (is_low_stock) where is_active;
create index inventory_items_name_trgm_idx on public.inventory_items using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 8. Caja, comisiones y transacciones
-- ---------------------------------------------------------------------
create table public.cash_registers (
  id              uuid primary key default gen_random_uuid(),
  opened_by       uuid constraint cash_registers_opened_by_fk references public.staff_members (id) on delete set null,
  closed_by       uuid constraint cash_registers_closed_by_fk references public.staff_members (id) on delete set null,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  opening_amount  numeric(12,2) not null default 0 check (opening_amount >= 0),
  expected_cash   numeric(12,2),
  counted_cash    numeric(12,2) check (counted_cash >= 0),
  difference      numeric(12,2),
  status          text not null default 'open' check (status in ('open', 'closed')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cash_registers_closed_consistency check (
    (status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null and counted_cash is not null)
  )
);
create unique index cash_registers_single_open on public.cash_registers ((true)) where status = 'open';
create index cash_registers_opened_idx on public.cash_registers (opened_at desc);

create table public.commission_payouts (
  id                 uuid primary key default gen_random_uuid(),
  staff_id           uuid not null constraint commission_payouts_staff_fk references public.staff_members (id) on delete restrict,
  period_start       date not null,
  period_end         date not null,
  commission_amount  numeric(12,2) not null default 0 check (commission_amount >= 0),
  tips_amount        numeric(12,2) not null default 0 check (tips_amount >= 0),
  total_amount       numeric(12,2) not null check (total_amount >= 0),
  items_count        integer not null default 0 check (items_count >= 0),
  notes              text,
  paid_at            timestamptz not null default now(),
  created_by         uuid constraint commission_payouts_created_by_fk references public.staff_members (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint commission_payouts_period check (period_end >= period_start)
);
create index commission_payouts_staff_idx on public.commission_payouts (staff_id, paid_at desc);

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  ticket_number     bigint generated by default as identity unique,
  cash_register_id  uuid not null constraint transactions_register_fk references public.cash_registers (id) on delete restrict,
  client_id         uuid constraint transactions_client_fk references public.clients (id) on delete set null,
  appointment_id    uuid constraint transactions_appointment_fk references public.appointments (id) on delete set null,
  created_by        uuid constraint transactions_created_by_fk references public.staff_members (id) on delete set null,
  tip_staff_id      uuid constraint transactions_tip_staff_fk references public.staff_members (id) on delete set null,
  tip_payout_id     uuid constraint transactions_tip_payout_fk references public.commission_payouts (id) on delete set null,
  subtotal          numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_amount   numeric(12,2) not null default 0 check (discount_amount >= 0),
  tip_amount        numeric(12,2) not null default 0 check (tip_amount >= 0),
  total             numeric(12,2) not null default 0 check (total >= 0),
  cash_received     numeric(12,2) check (cash_received >= 0),
  change_given      numeric(12,2) not null default 0 check (change_given >= 0),
  status            text not null default 'completed' check (status in ('completed', 'voided')),
  notes             text,
  void_reason       text,
  voided_at         timestamptz,
  voided_by         uuid constraint transactions_voided_by_fk references public.staff_members (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint transactions_discount_le_subtotal check (discount_amount <= subtotal),
  constraint transactions_total_consistent check (total = subtotal - discount_amount + tip_amount),
  constraint transactions_void_consistency check ((status = 'voided') = (voided_at is not null))
);
create index transactions_created_idx  on public.transactions (created_at desc);
create index transactions_register_idx on public.transactions (cash_register_id);
create index transactions_client_idx   on public.transactions (client_id, created_at desc);
create index transactions_tip_staff_idx on public.transactions (tip_staff_id) where tip_amount > 0;

create table public.transaction_items (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null constraint transaction_items_transaction_fk references public.transactions (id) on delete cascade,
  item_kind          text not null check (item_kind in ('service', 'product')),
  service_id         uuid constraint transaction_items_service_fk references public.services (id) on delete restrict,
  inventory_item_id  uuid constraint transaction_items_inventory_fk references public.inventory_items (id) on delete restrict,
  staff_id           uuid constraint transaction_items_staff_fk references public.staff_members (id) on delete set null,
  description        text not null,
  quantity           numeric(10,2) not null default 1 check (quantity > 0),
  unit_price         numeric(10,2) not null check (unit_price >= 0),
  discount           numeric(10,2) not null default 0 check (discount >= 0),
  line_total         numeric(12,2) not null default 0 check (line_total >= 0),
  commission_type    text check (commission_type in ('percentage', 'fixed')),
  commission_value   numeric(10,2) not null default 0,
  commission_amount  numeric(12,2) not null default 0 check (commission_amount >= 0),
  payout_id          uuid constraint transaction_items_payout_fk references public.commission_payouts (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint transaction_items_kind_ref check (
    (item_kind = 'service' and service_id is not null and inventory_item_id is null) or
    (item_kind = 'product' and inventory_item_id is not null and service_id is null)
  )
);
create index transaction_items_transaction_idx on public.transaction_items (transaction_id);
create index transaction_items_staff_idx       on public.transaction_items (staff_id, created_at);
create index transaction_items_service_idx     on public.transaction_items (service_id);
create index transaction_items_pending_idx     on public.transaction_items (staff_id) where payout_id is null;

create table public.transaction_payments (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null constraint transaction_payments_transaction_fk references public.transactions (id) on delete cascade,
  method          text not null check (method in ('cash', 'card', 'transfer', 'wallet')),
  amount          numeric(12,2) not null check (amount > 0),
  reference       text,
  created_at      timestamptz not null default now()
);
create index transaction_payments_transaction_idx on public.transaction_payments (transaction_id);

create table public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null constraint inventory_movements_item_fk references public.inventory_items (id) on delete cascade,
  movement_type   text not null check (movement_type in ('purchase', 'sale', 'usage', 'adjustment_in', 'adjustment_out', 'return')),
  quantity        numeric(12,2) not null check (quantity > 0),
  unit_cost       numeric(10,2) check (unit_cost >= 0),
  reference       text,
  transaction_id  uuid constraint inventory_movements_transaction_fk references public.transactions (id) on delete set null,
  staff_id        uuid constraint inventory_movements_staff_fk references public.staff_members (id) on delete set null,
  notes           text,
  created_by      uuid constraint inventory_movements_created_by_fk references public.staff_members (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index inventory_movements_item_idx    on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_created_idx on public.inventory_movements (created_at desc);

-- ---------------------------------------------------------------------
-- 9. Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_settings', 'staff_members', 'clients', 'client_technical_records', 'service_categories',
    'services', 'appointments', 'inventory_items', 'cash_registers', 'transactions'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'trg_' || t || '_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Funciones de identidad y roles (usadas por RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_staff_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.staff_members where user_id = auth.uid() and is_active limit 1;
$$;

create or replace function public.current_staff_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.staff_members where user_id = auth.uid() and is_active limit 1;
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_staff_id() is not null;
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_staff_role() = any (roles), false);
$$;

create or replace function public.business_tz()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select timezone from public.business_settings limit 1), 'America/Lima');
$$;

-- Vincula usuarios de Auth con el equipo (por email) o crea el primer propietario
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  update public.staff_members
     set user_id = new.id
   where lower(email) = lower(new.email)
     and user_id is null
  returning id into v_staff_id;

  if v_staff_id is null and not exists (select 1 from public.staff_members where user_id is not null) then
    insert into public.staff_members (user_id, full_name, email, role, specialty, is_bookable)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
      new.email,
      'owner',
      'none',
      false
    );
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Lógica de negocio en triggers
-- ---------------------------------------------------------------------

-- Citas: hereda duración/pose/precio del servicio y calcula ends_at
create or replace function public.appointments_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_duration   integer;
  v_processing integer;
  v_price      numeric;
begin
  if new.duration_minutes is null or new.processing_minutes is null or new.price is null then
    select s.duration_minutes, s.processing_minutes, s.price
      into v_duration, v_processing, v_price
      from public.services s
     where s.id = new.service_id;

    new.duration_minutes   := coalesce(new.duration_minutes, v_duration);
    new.processing_minutes := coalesce(new.processing_minutes, v_processing, 0);
    new.price              := coalesce(new.price, v_price, 0);
  end if;

  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes + new.processing_minutes);

  if new.status = 'waiting' and new.checked_in_at is null then
    new.checked_in_at := now();
  elsif new.status = 'in_service' and new.started_at is null then
    new.started_at := now();
  elsif new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := public.current_staff_id();
  end if;

  return new;
end;
$$;

create trigger trg_appointments_before_write
  before insert or update of starts_at, duration_minutes, processing_minutes, service_id, status, price
  on public.appointments
  for each row execute function public.appointments_before_write();

-- Ítems de venta: total de línea + comisión (servicio > especialista > negocio)
create or replace function public.transaction_items_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type          text;
  v_value         numeric;
  v_staff_type    text;
  v_staff_value   numeric;
  v_staff_product numeric;
  v_default_type  text;
  v_default_value numeric;
  v_default_prod  numeric;
begin
  new.line_total := round(new.quantity * new.unit_price - coalesce(new.discount, 0), 2);
  if new.line_total < 0 then
    raise exception 'El descuento de la línea "%" excede su importe', new.description using errcode = '22023';
  end if;

  if new.staff_id is null then
    new.commission_type   := null;
    new.commission_value  := 0;
    new.commission_amount := 0;
    return new;
  end if;

  select commission_type, commission_value, product_commission_rate
    into v_staff_type, v_staff_value, v_staff_product
    from public.staff_members where id = new.staff_id;

  select default_commission_type, default_commission_value, product_commission_rate
    into v_default_type, v_default_value, v_default_prod
    from public.business_settings limit 1;

  if new.item_kind = 'service' then
    select s.commission_type, s.commission_value into v_type, v_value
      from public.services s where s.id = new.service_id;
    if v_type is null then
      v_type := v_staff_type;
      v_value := v_staff_value;
    end if;
    if v_type is null then
      v_type := coalesce(v_default_type, 'percentage');
      v_value := coalesce(v_default_value, 0);
    end if;
  else
    v_type := 'percentage';
    v_value := coalesce(v_staff_product, v_default_prod, 0);
  end if;

  new.commission_type  := v_type;
  new.commission_value := coalesce(v_value, 0);
  new.commission_amount := case
    when v_type = 'fixed' then round(coalesce(v_value, 0) * new.quantity, 2)
    else round(new.line_total * coalesce(v_value, 0) / 100, 2)
  end;
  return new;
end;
$$;

create trigger trg_transaction_items_before_insert
  before insert on public.transaction_items
  for each row execute function public.transaction_items_before_insert();

-- Ítems de producto: descuentan stock automáticamente
create or replace function public.transaction_items_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.item_kind = 'product' then
    insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, transaction_id, staff_id, created_by)
    select new.inventory_item_id, 'sale', new.quantity, i.cost, 'Venta POS', new.transaction_id, new.staff_id, public.current_staff_id()
      from public.inventory_items i
     where i.id = new.inventory_item_id;
  end if;
  return new;
end;
$$;

create trigger trg_transaction_items_after_insert
  after insert on public.transaction_items
  for each row execute function public.transaction_items_after_insert();

-- Movimientos de inventario: actualizan stock con validación
create or replace function public.inventory_movements_apply()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_stock numeric;
  v_name  text;
  v_delta numeric;
begin
  select stock, name into v_stock, v_name from public.inventory_items where id = new.item_id for update;
  if not found then
    raise exception 'Producto de inventario no encontrado' using errcode = 'P0002';
  end if;

  v_delta := case when new.movement_type in ('purchase', 'adjustment_in', 'return') then new.quantity else -new.quantity end;

  if v_stock + v_delta < 0 then
    raise exception 'Stock insuficiente para "%": disponible %, solicitado %', v_name, v_stock, new.quantity
      using errcode = 'P0001';
  end if;

  update public.inventory_items set stock = stock + v_delta where id = new.item_id;

  if new.created_by is null then
    new.created_by := public.current_staff_id();
  end if;
  return new;
end;
$$;

create trigger trg_inventory_movements_apply
  before insert on public.inventory_movements
  for each row execute function public.inventory_movements_apply();

-- ---------------------------------------------------------------------
-- 12. RPC: Caja / POS
-- ---------------------------------------------------------------------

-- Venta atómica: transacción + ítems + pagos + cierre de cita + métricas del cliente
create or replace function public.create_sale(p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_register    uuid;
  v_tx          uuid;
  v_ticket      bigint;
  v_item        jsonb;
  v_pay         jsonb;
  v_subtotal    numeric := 0;
  v_discount    numeric := round(coalesce((p_payload ->> 'discount_amount')::numeric, 0), 2);
  v_tip         numeric := round(coalesce((p_payload ->> 'tip_amount')::numeric, 0), 2);
  v_total       numeric;
  v_paid        numeric := 0;
  v_cash_paid   numeric := 0;
  v_cash_recv   numeric := (p_payload ->> 'cash_received')::numeric;
  v_change      numeric := 0;
  v_client      uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_appointment uuid := nullif(p_payload ->> 'appointment_id', '')::uuid;
  v_tip_staff   uuid := nullif(p_payload ->> 'tip_staff_id', '')::uuid;
  v_has_service boolean := false;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para registrar cobros' using errcode = '42501';
  end if;

  select id into v_register from public.cash_registers where status = 'open' limit 1;
  if v_register is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de cobrar.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'La venta no tiene ítems' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    v_subtotal := v_subtotal + round(
      (v_item ->> 'quantity')::numeric * (v_item ->> 'unit_price')::numeric - coalesce((v_item ->> 'discount')::numeric, 0), 2);
    if v_item ->> 'item_kind' = 'service' then
      v_has_service := true;
    end if;
  end loop;

  if v_discount < 0 or v_tip < 0 then
    raise exception 'Descuento y propina no pueden ser negativos' using errcode = '22023';
  end if;
  if v_discount > v_subtotal then
    raise exception 'El descuento (%) supera el subtotal (%)', v_discount, v_subtotal using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount + v_tip;

  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    select coalesce(sum((value ->> 'amount')::numeric), 0),
           coalesce(sum((value ->> 'amount')::numeric) filter (where value ->> 'method' = 'cash'), 0)
      into v_paid, v_cash_paid
      from jsonb_array_elements(p_payload -> 'payments');
  end if;

  if round(v_paid, 2) <> round(v_total, 2) then
    raise exception 'Los pagos (%) no coinciden con el total (%)', round(v_paid, 2), round(v_total, 2) using errcode = '22023';
  end if;

  if v_cash_recv is not null then
    if v_cash_recv < v_cash_paid then
      raise exception 'El efectivo recibido es menor al monto en efectivo' using errcode = '22023';
    end if;
    v_change := v_cash_recv - v_cash_paid;
  end if;

  insert into public.transactions (
    cash_register_id, client_id, appointment_id, created_by, tip_staff_id,
    subtotal, discount_amount, tip_amount, total, cash_received, change_given, notes
  ) values (
    v_register, v_client, v_appointment, public.current_staff_id(), case when v_tip > 0 then v_tip_staff end,
    v_subtotal, v_discount, v_tip, v_total, v_cash_recv, v_change, nullif(p_payload ->> 'notes', '')
  )
  returning id, ticket_number into v_tx, v_ticket;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    insert into public.transaction_items (
      transaction_id, item_kind, service_id, inventory_item_id, staff_id, description, quantity, unit_price, discount
    ) values (
      v_tx,
      v_item ->> 'item_kind',
      nullif(v_item ->> 'service_id', '')::uuid,
      nullif(v_item ->> 'inventory_item_id', '')::uuid,
      nullif(v_item ->> 'staff_id', '')::uuid,
      coalesce(nullif(v_item ->> 'description', ''), 'Ítem'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'discount')::numeric, 0)
    );
  end loop;

  for v_pay in select value from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]'::jsonb))
  loop
    if coalesce((v_pay ->> 'amount')::numeric, 0) > 0 then
      insert into public.transaction_payments (transaction_id, method, amount, reference)
      values (v_tx, v_pay ->> 'method', (v_pay ->> 'amount')::numeric, nullif(v_pay ->> 'reference', ''));
    end if;
  end loop;

  if v_appointment is not null then
    update public.appointments set status = 'completed' where id = v_appointment and status <> 'completed';
  end if;

  if v_client is not null then
    update public.clients
       set total_spent   = total_spent + v_total,
           visits_count  = visits_count + case when v_has_service then 1 else 0 end,
           last_visit_at = case when v_has_service then now() else last_visit_at end
     where id = v_client;
  end if;

  return jsonb_build_object('id', v_tx, 'ticket_number', v_ticket, 'total', v_total, 'change', v_change);
end;
$$;

-- Anulación de venta: revierte stock y métricas del cliente
create or replace function public.void_transaction(p_transaction_id uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_tx public.transactions;
begin
  if not public.has_role('owner', 'admin') then
    raise exception 'Solo administración puede anular ventas' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la anulación' using errcode = '22023';
  end if;

  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if v_tx.status = 'voided' then
    raise exception 'La venta ya está anulada' using errcode = 'P0001';
  end if;
  if v_tx.tip_payout_id is not null or exists (
    select 1 from public.transaction_items where transaction_id = p_transaction_id and payout_id is not null
  ) then
    raise exception 'La venta tiene comisiones ya liquidadas y no puede anularse' using errcode = 'P0001';
  end if;

  insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, notes)
  select inventory_item_id, 'return', quantity, 'Anulación ticket #' || v_tx.ticket_number, v_tx.id, p_reason
    from public.transaction_items
   where transaction_id = p_transaction_id and item_kind = 'product';

  update public.transactions
     set status = 'voided', voided_at = now(), voided_by = public.current_staff_id(), void_reason = p_reason
   where id = p_transaction_id;

  if v_tx.client_id is not null then
    update public.clients set total_spent = greatest(total_spent - v_tx.total, 0) where id = v_tx.client_id;
  end if;
end;
$$;

-- Resumen de una caja (para arqueo)
create or replace function public.register_summary(p_register_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_reg    public.cash_registers;
  v_result jsonb;
begin
  select * into v_reg from public.cash_registers where id = p_register_id;
  if not found then
    raise exception 'Caja no encontrada' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'register_id', v_reg.id,
    'opening_amount', v_reg.opening_amount,
    'transactions', (select count(*) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'),
    'voided', (select count(*) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'voided'),
    'gross_total', coalesce((select sum(t.total) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'tips', coalesce((select sum(t.tip_amount) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'discounts', coalesce((select sum(t.discount_amount) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'by_method', coalesce((
      select jsonb_object_agg(m.method, m.amount)
        from (
          select p.method, sum(p.amount) as amount
            from public.transaction_payments p
            join public.transactions t on t.id = p.transaction_id
           where t.cash_register_id = v_reg.id and t.status = 'completed'
           group by p.method
        ) m
    ), '{}'::jsonb),
    'expected_cash', v_reg.opening_amount + coalesce((
      select sum(p.amount)
        from public.transaction_payments p
        join public.transactions t on t.id = p.transaction_id
       where t.cash_register_id = v_reg.id and t.status = 'completed' and p.method = 'cash'
    ), 0)
  ) into v_result;

  return v_result;
end;
$$;

-- Cierre de caja con arqueo
create or replace function public.close_cash_register(p_counted_cash numeric, p_notes text default null)
returns public.cash_registers
language plpgsql security invoker set search_path = public
as $$
declare
  v_reg      public.cash_registers;
  v_expected numeric;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para cerrar caja' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Ingresa el efectivo contado' using errcode = '22023';
  end if;

  select * into v_reg from public.cash_registers where status = 'open' for update;
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
-- 13. RPC: Comisiones
-- ---------------------------------------------------------------------
create or replace function public.commission_summary(p_from date, p_to date)
returns table (
  staff_id            uuid,
  full_name           text,
  role                text,
  items_count         bigint,
  base_amount         numeric,
  commission_total    numeric,
  commission_pending  numeric,
  tips_total          numeric,
  tips_pending        numeric
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
    select ti.staff_id, ti.line_total, ti.commission_amount, ti.payout_id
      from public.transaction_items ti
      join public.transactions t on t.id = ti.transaction_id
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
       and ti.staff_id is not null
  ),
  tips as (
    select t.tip_staff_id as staff_id, t.tip_amount, t.tip_payout_id
      from public.transactions t
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
       and t.tip_staff_id is not null and t.tip_amount > 0
  )
  select s.id,
         s.full_name,
         s.role,
         coalesce((select count(*) from items i where i.staff_id = s.id), 0)::bigint,
         coalesce((select sum(i.line_total) from items i where i.staff_id = s.id), 0)::numeric,
         coalesce((select sum(i.commission_amount) from items i where i.staff_id = s.id), 0)::numeric,
         coalesce((select sum(i.commission_amount) from items i where i.staff_id = s.id and i.payout_id is null), 0)::numeric,
         coalesce((select sum(x.tip_amount) from tips x where x.staff_id = s.id), 0)::numeric,
         coalesce((select sum(x.tip_amount) from tips x where x.staff_id = s.id and x.tip_payout_id is null), 0)::numeric
    from public.staff_members s
   where s.is_active
      or exists (select 1 from items i where i.staff_id = s.id)
   order by 6 desc, s.full_name;
end;
$$;

create or replace function public.settle_commissions(p_staff_id uuid, p_from date, p_to date, p_notes text default null)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tz     text := public.business_tz();
  v_start  timestamptz := (p_from::timestamp at time zone v_tz);
  v_end    timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
  v_comm   numeric;
  v_count  integer;
  v_tips   numeric;
  v_payout uuid;
begin
  if not public.has_role('owner', 'admin') then
    raise exception 'Solo administración puede liquidar comisiones' using errcode = '42501';
  end if;
  if p_to < p_from then
    raise exception 'El periodo es inválido' using errcode = '22023';
  end if;

  select coalesce(sum(ti.commission_amount), 0), count(*)
    into v_comm, v_count
    from public.transaction_items ti
    join public.transactions t on t.id = ti.transaction_id
   where ti.staff_id = p_staff_id and ti.payout_id is null
     and t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end;

  select coalesce(sum(t.tip_amount), 0)
    into v_tips
    from public.transactions t
   where t.tip_staff_id = p_staff_id and t.tip_payout_id is null and t.tip_amount > 0
     and t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end;

  if v_comm + v_tips = 0 then
    raise exception 'No hay comisiones pendientes en el periodo seleccionado' using errcode = 'P0001';
  end if;

  insert into public.commission_payouts (
    staff_id, period_start, period_end, commission_amount, tips_amount, total_amount, items_count, notes, created_by
  ) values (
    p_staff_id, p_from, p_to, v_comm, v_tips, v_comm + v_tips, v_count, nullif(p_notes, ''), public.current_staff_id()
  ) returning id into v_payout;

  update public.transaction_items ti
     set payout_id = v_payout
    from public.transactions t
   where t.id = ti.transaction_id
     and ti.staff_id = p_staff_id and ti.payout_id is null
     and t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end;

  update public.transactions t
     set tip_payout_id = v_payout
   where t.tip_staff_id = p_staff_id and t.tip_payout_id is null and t.tip_amount > 0
     and t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end;

  return v_payout;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. RPC: Dashboard y reportes (respetan RLS: security invoker)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_today(p_date date default null)
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
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end), 0),
    'tips', coalesce((
      select sum(t.tip_amount) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end), 0),
    'transactions', (
      select count(*) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end),
    'commissions', coalesce((
      select sum(ti.commission_amount)
        from public.transaction_items ti
        join public.transactions t on t.id = ti.transaction_id
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end), 0),
    'appointments', coalesce((
      select jsonb_object_agg(a.status, a.n)
        from (select status, count(*) as n from public.appointments
               where starts_at >= v_start and starts_at < v_end group by status) a), '{}'::jsonb),
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

create or replace function public.report_revenue_by_day(p_from date, p_to date)
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
     and t.created_at >= ((p_from + g.i)::timestamp at time zone v_tz)
     and t.created_at <  ((p_from + g.i + 1)::timestamp at time zone v_tz)
   group by g.i
   order by g.i;
end;
$$;

create or replace function public.report_staff_performance(p_from date, p_to date)
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
  ),
  tip_rows as (
    select t.tip_staff_id, sum(t.tip_amount) as amount
      from public.transactions t
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end and t.tip_staff_id is not null
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
   where s.is_bookable or i.staff_id is not null
   group by s.id, s.full_name
   order by 4 desc, s.full_name;
end;
$$;

create or replace function public.report_top_services(p_from date, p_to date, p_limit integer default 10)
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
   group by ti.service_id, sv.name
   order by 3 desc, 4 desc
   limit greatest(1, least(p_limit, 50));
end;
$$;

create or replace function public.report_payment_methods(p_from date, p_to date)
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
   group by p.method
   order by 2 desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Row Level Security
-- ---------------------------------------------------------------------
alter table public.business_settings        enable row level security;
alter table public.staff_members            enable row level security;
alter table public.clients                  enable row level security;
alter table public.client_technical_records enable row level security;
alter table public.service_categories       enable row level security;
alter table public.services                 enable row level security;
alter table public.service_combo_items      enable row level security;
alter table public.appointments             enable row level security;
alter table public.inventory_items          enable row level security;
alter table public.inventory_movements      enable row level security;
alter table public.cash_registers           enable row level security;
alter table public.commission_payouts       enable row level security;
alter table public.transactions             enable row level security;
alter table public.transaction_items        enable row level security;
alter table public.transaction_payments     enable row level security;

-- Ajustes
create policy settings_select on public.business_settings for select to authenticated using (public.is_staff());
create policy settings_update on public.business_settings for update to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

-- Equipo
create policy staff_select on public.staff_members for select to authenticated using (public.is_staff());
create policy staff_insert on public.staff_members for insert to authenticated with check (public.has_role('owner', 'admin'));
create policy staff_update on public.staff_members for update to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy staff_delete on public.staff_members for delete to authenticated using (public.has_role('owner'));

-- Clientes
create policy clients_select on public.clients for select to authenticated using (public.is_staff());
create policy clients_insert on public.clients for insert to authenticated with check (public.is_staff());
create policy clients_update on public.clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy clients_delete on public.clients for delete to authenticated using (public.has_role('owner', 'admin'));

-- Ficha técnica
create policy records_select on public.client_technical_records for select to authenticated using (public.is_staff());
create policy records_insert on public.client_technical_records for insert to authenticated with check (public.is_staff());
create policy records_update on public.client_technical_records for update to authenticated
  using (public.has_role('owner', 'admin') or staff_id = public.current_staff_id())
  with check (public.is_staff());
create policy records_delete on public.client_technical_records for delete to authenticated
  using (public.has_role('owner', 'admin') or staff_id = public.current_staff_id());

-- Catálogo
create policy categories_select on public.service_categories for select to authenticated using (public.is_staff());
create policy categories_write  on public.service_categories for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy services_select on public.services for select to authenticated using (public.is_staff());
create policy services_write  on public.services for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy combo_select on public.service_combo_items for select to authenticated using (public.is_staff());
create policy combo_write  on public.service_combo_items for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

-- Agenda (especialistas gestionan solo sus propias citas)
create policy appointments_select on public.appointments for select to authenticated using (public.is_staff());
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist')
              or (public.has_role('specialist') and staff_id = public.current_staff_id()));
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_role('owner', 'admin', 'receptionist')
         or (public.has_role('specialist') and staff_id = public.current_staff_id()))
  with check (public.has_role('owner', 'admin', 'receptionist')
              or (public.has_role('specialist') and staff_id = public.current_staff_id()));
create policy appointments_delete on public.appointments for delete to authenticated using (public.has_role('owner', 'admin'));

-- Inventario (los movimientos son un registro de auditoría: sin update/delete)
create policy inventory_select on public.inventory_items for select to authenticated using (public.is_staff());
create policy inventory_write  on public.inventory_items for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy movements_select on public.inventory_movements for select to authenticated using (public.is_staff());
create policy movements_insert on public.inventory_movements for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));

-- Caja
create policy registers_select on public.cash_registers for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist'));
create policy registers_insert on public.cash_registers for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));
create policy registers_update on public.cash_registers for update to authenticated
  using (public.has_role('owner', 'admin', 'receptionist')) with check (public.has_role('owner', 'admin', 'receptionist'));

-- Liquidaciones
create policy payouts_select on public.commission_payouts for select to authenticated
  using (public.has_role('owner', 'admin') or staff_id = public.current_staff_id());
create policy payouts_insert on public.commission_payouts for insert to authenticated
  with check (public.has_role('owner', 'admin'));

-- Ventas (los especialistas solo ven las ventas en las que participaron)
create policy transactions_select on public.transactions for select to authenticated
  using (
    public.has_role('owner', 'admin', 'receptionist')
    or tip_staff_id = public.current_staff_id()
    or exists (
      select 1 from public.transaction_items ti
       where ti.transaction_id = transactions.id and ti.staff_id = public.current_staff_id()
    )
  );
create policy transactions_insert on public.transactions for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));
create policy transactions_update on public.transactions for update to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

create policy items_select on public.transaction_items for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
create policy items_insert on public.transaction_items for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));
create policy items_update on public.transaction_items for update to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

create policy payments_select on public.transaction_payments for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist'));
create policy payments_insert on public.transaction_payments for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));

-- ---------------------------------------------------------------------
-- 16. Permisos de ejecución de RPC
-- ---------------------------------------------------------------------
revoke execute on function public.create_sale(jsonb)                               from public, anon;
revoke execute on function public.void_transaction(uuid, text)                      from public, anon;
revoke execute on function public.close_cash_register(numeric, text)                from public, anon;
revoke execute on function public.register_summary(uuid)                            from public, anon;
revoke execute on function public.settle_commissions(uuid, date, date, text)        from public, anon;
revoke execute on function public.commission_summary(date, date)                    from public, anon;
revoke execute on function public.dashboard_today(date)                             from public, anon;
revoke execute on function public.report_revenue_by_day(date, date)                 from public, anon;
revoke execute on function public.report_staff_performance(date, date)              from public, anon;
revoke execute on function public.report_top_services(date, date, integer)          from public, anon;
revoke execute on function public.report_payment_methods(date, date)                from public, anon;

grant execute on function public.create_sale(jsonb)                                 to authenticated;
grant execute on function public.void_transaction(uuid, text)                        to authenticated;
grant execute on function public.close_cash_register(numeric, text)                  to authenticated;
grant execute on function public.register_summary(uuid)                              to authenticated;
grant execute on function public.settle_commissions(uuid, date, date, text)          to authenticated;
grant execute on function public.commission_summary(date, date)                      to authenticated;
grant execute on function public.dashboard_today(date)                               to authenticated;
grant execute on function public.report_revenue_by_day(date, date)                   to authenticated;
grant execute on function public.report_staff_performance(date, date)                to authenticated;
grant execute on function public.report_top_services(date, date, integer)            to authenticated;
grant execute on function public.report_payment_methods(date, date)                  to authenticated;

-- ---------------------------------------------------------------------
-- 17. Realtime (solo agenda) y Storage
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.appointments;
    exception when duplicate_object then
      null;
    end;
  end if;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('business-assets', 'business-assets', true)
      on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('client-photos', 'client-photos', false)
      on conflict (id) do nothing;

    execute 'drop policy if exists "assets_public_read" on storage.objects';
    execute 'drop policy if exists "assets_admin_write" on storage.objects';
    execute 'drop policy if exists "assets_admin_update" on storage.objects';
    execute 'drop policy if exists "assets_admin_delete" on storage.objects';
    execute 'drop policy if exists "client_photos_staff_read" on storage.objects';
    execute 'drop policy if exists "client_photos_staff_write" on storage.objects';

    execute $p$create policy "assets_public_read" on storage.objects for select
      using (bucket_id = 'business-assets')$p$;
    execute $p$create policy "assets_admin_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'business-assets' and public.has_role('owner', 'admin'))$p$;
    execute $p$create policy "assets_admin_update" on storage.objects for update to authenticated
      using (bucket_id = 'business-assets' and public.has_role('owner', 'admin'))$p$;
    execute $p$create policy "assets_admin_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'business-assets' and public.has_role('owner', 'admin'))$p$;
    execute $p$create policy "client_photos_staff_read" on storage.objects for select to authenticated
      using (bucket_id = 'client-photos' and public.is_staff())$p$;
    execute $p$create policy "client_photos_staff_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'client-photos' and public.is_staff())$p$;
  end if;
end;
$$;
