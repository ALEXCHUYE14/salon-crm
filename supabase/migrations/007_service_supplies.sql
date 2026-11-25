-- =====================================================================
--  007_service_supplies.sql — Recetas: insumos que consume cada servicio
--
--  · Al cobrar un servicio se descuenta automáticamente su receta del inventario
--    (movimiento "usage" ligado al ticket).
--  · Un combo sin receta propia consume la receta de sus servicios componentes.
--  · Si el stock registrado no alcanza, NO se bloquea el cobro: se descuenta lo
--    disponible y se anota el faltante en el movimiento (aparecerá en stock bajo).
--  · Al anular la venta, los insumos consumidos vuelven al inventario.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.service_supplies (
  service_id  uuid not null constraint service_supplies_service_fk references public.services (id) on delete cascade,
  item_id     uuid not null constraint service_supplies_item_fk references public.inventory_items (id) on delete restrict,
  quantity    numeric(12,2) not null check (quantity > 0 and quantity <= 10000),
  primary key (service_id, item_id)
);
create index if not exists service_supplies_item_idx on public.service_supplies (item_id);

-- ---------------------------------------------------------------------
-- Ítems de venta: productos descuentan stock; servicios consumen su receta
-- ---------------------------------------------------------------------
create or replace function public.transaction_items_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket bigint;
  r        record;
  v_stock  numeric;
  v_use    numeric;
begin
  if new.item_kind = 'product' then
    insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, transaction_id, staff_id, created_by)
    select new.inventory_item_id, 'sale', new.quantity, i.cost, 'Venta POS', new.transaction_id, new.staff_id, public.current_staff_id()
      from public.inventory_items i
     where i.id = new.inventory_item_id;
    return new;
  end if;

  if new.item_kind <> 'service' or new.service_id is null then
    return new;
  end if;

  select ticket_number into v_ticket from public.transactions where id = new.transaction_id;

  for r in
    with own as (
      select ss.item_id, ss.quantity from public.service_supplies ss where ss.service_id = new.service_id
    ),
    from_combo as (
      -- Combo sin receta propia: suma las recetas de sus componentes
      select ss.item_id, sum(ss.quantity * ci.quantity) as quantity
        from public.service_combo_items ci
        join public.service_supplies ss on ss.service_id = ci.service_id
       where ci.combo_id = new.service_id and not exists (select 1 from own)
       group by ss.item_id
    )
    select x.item_id, sum(x.quantity) * new.quantity as needed
      from (select * from own union all select * from from_combo) x
     group by x.item_id
  loop
    select stock into v_stock from public.inventory_items where id = r.item_id for update;
    if not found then
      continue;
    end if;
    v_use := round(least(coalesce(v_stock, 0), r.needed), 2);
    if v_use > 0 then
      insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, staff_id, notes, created_by)
      values (
        r.item_id, 'usage', v_use,
        'Consumo por servicio · Ticket #' || coalesce(v_ticket::text, '?'),
        new.transaction_id, new.staff_id,
        case when v_use < r.needed then format('Stock insuficiente: faltaron %s', round(r.needed - v_use, 2)) end,
        public.current_staff_id()
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Anulación: además de productos, devuelve los insumos consumidos
-- ---------------------------------------------------------------------
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

  -- Insumos consumidos por los servicios del ticket
  insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, notes)
  select item_id, 'return', sum(quantity), 'Anulación ticket #' || v_tx.ticket_number || ' (insumos)', v_tx.id, p_reason
    from public.inventory_movements
   where transaction_id = p_transaction_id and movement_type = 'usage'
   group by item_id;

  update public.transactions
     set status = 'voided', voided_at = now(), voided_by = public.current_staff_id(), void_reason = p_reason
   where id = p_transaction_id;

  if v_tx.client_id is not null then
    update public.clients set total_spent = greatest(total_spent - v_tx.total, 0) where id = v_tx.client_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.service_supplies enable row level security;

drop policy if exists service_supplies_select on public.service_supplies;
drop policy if exists service_supplies_write on public.service_supplies;

create policy service_supplies_select on public.service_supplies for select to authenticated using (public.is_staff());
create policy service_supplies_write on public.service_supplies for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

grant select, insert, update, delete on public.service_supplies to authenticated;

revoke execute on function public.void_transaction(uuid, text) from public, anon;
grant execute on function public.void_transaction(uuid, text) to authenticated;
