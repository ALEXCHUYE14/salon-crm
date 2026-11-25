-- =====================================================================
--  seed.sql — Datos de demostración (ejecutar una vez, sobre base limpia)
--  Usuario sugerido para probar: regístrate con admin@demo.com
--  (se vincula automáticamente como Propietario).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ajustes del negocio
-- ---------------------------------------------------------------------
insert into public.business_settings (
  business_name, slogan, tax_id, phone, email, address, operating_mode,
  timezone, currency_code, currency_symbol, locale, default_country_code,
  default_commission_type, default_commission_value, product_commission_rate
) values (
  'Casa Norte Barbería & Salón', 'Oficio, estilo y cuidado', '20601234567', '999 111 222',
  'hola@casanorte.pe', 'Av. Grau 245, Piura', 'hybrid',
  'America/Lima', 'PEN', 'S/', 'es-PE', '51',
  'percentage', 40, 10
)
on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------
-- Equipo
-- ---------------------------------------------------------------------
insert into public.staff_members (
  id, full_name, email, phone, role, specialty, station_label, color, is_bookable,
  commission_type, commission_value, product_commission_rate, work_schedule
) values
  ('11111111-1111-4111-8111-000000000001', 'Administración General', 'admin@demo.com', '999000001',
   'owner', 'none', null, '#1C1B19', false, null, null, null, '[]'),
  ('11111111-1111-4111-8111-000000000002', 'Carlos Mendoza', 'carlos@demo.com', '999000002',
   'specialist', 'barber', 'Silla 1', '#3F5E4D', true, 'percentage', 45, 10,
   '[{"day":1,"start":"09:00","end":"19:00"},{"day":2,"start":"09:00","end":"19:00"},{"day":3,"start":"09:00","end":"19:00"},{"day":4,"start":"09:00","end":"19:00"},{"day":5,"start":"10:00","end":"21:00"},{"day":6,"start":"10:00","end":"21:00"}]'),
  ('11111111-1111-4111-8111-000000000003', 'Diego Ramírez', 'diego@demo.com', '999000003',
   'specialist', 'barber', 'Silla 2', '#6B7F5E', true, null, null, null,
   '[{"day":1,"start":"09:00","end":"18:00"},{"day":2,"start":"09:00","end":"18:00"},{"day":3,"start":"09:00","end":"18:00"},{"day":4,"start":"09:00","end":"18:00"},{"day":5,"start":"09:00","end":"20:00"},{"day":6,"start":"09:00","end":"20:00"}]'),
  ('11111111-1111-4111-8111-000000000004', 'Lucía Fernández', 'lucia@demo.com', '999000004',
   'specialist', 'stylist', 'Tocador 1', '#A85A3A', true, 'percentage', 40, 12,
   '[{"day":1,"start":"09:00","end":"19:00"},{"day":2,"start":"09:00","end":"19:00"},{"day":3,"start":"09:00","end":"19:00"},{"day":4,"start":"09:00","end":"19:00"},{"day":5,"start":"09:00","end":"20:00"},{"day":6,"start":"09:00","end":"20:00"}]'),
  ('11111111-1111-4111-8111-000000000005', 'Valeria Quispe', 'valeria@demo.com', '999000005',
   'specialist', 'stylist', 'Tocador 2', '#9A6B26', true, null, null, null,
   '[{"day":2,"start":"10:00","end":"20:00"},{"day":3,"start":"10:00","end":"20:00"},{"day":4,"start":"10:00","end":"20:00"},{"day":5,"start":"10:00","end":"21:00"},{"day":6,"start":"09:00","end":"21:00"},{"day":1,"start":"10:00","end":"19:00"}]'),
  ('11111111-1111-4111-8111-000000000006', 'Andrea Torres', 'recepcion@demo.com', '999000006',
   'receptionist', 'none', null, '#5C5852', false, null, null, null, '[]')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Categorías y servicios
-- ---------------------------------------------------------------------
insert into public.service_categories (id, name, segment, sort_order) values
  ('22222222-2222-4222-8222-000000000001', 'Cortes', 'barbershop', 1),
  ('22222222-2222-4222-8222-000000000002', 'Barba y afeitado', 'barbershop', 2),
  ('22222222-2222-4222-8222-000000000003', 'Color', 'beauty_salon', 3),
  ('22222222-2222-4222-8222-000000000004', 'Corte y peinado', 'beauty_salon', 4),
  ('22222222-2222-4222-8222-000000000005', 'Tratamientos capilares', 'beauty_salon', 5),
  ('22222222-2222-4222-8222-000000000006', 'Uñas', 'beauty_salon', 6),
  ('22222222-2222-4222-8222-000000000007', 'Combos', 'both', 7)
on conflict (id) do nothing;

insert into public.services (
  id, category_id, name, description, segment, duration_minutes, processing_minutes, price,
  commission_type, commission_value, is_combo, sort_order
) values
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'Corte clásico', 'Tijera y máquina, lavado incluido', 'barbershop', 30, 0, 25.00, null, null, false, 1),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000001', 'Fade / Degradado', 'Low, mid o high fade', 'barbershop', 40, 0, 30.00, null, null, false, 2),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000001', 'Corte + diseño', 'Fade con líneas o diseño a navaja', 'barbershop', 50, 0, 35.00, 'fixed', 15, false, 3),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000002', 'Perfilado de barba', 'Contorno y rebaje', 'barbershop', 20, 0, 15.00, null, null, false, 4),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000002', 'Afeitado clásico', 'Toalla caliente y navaja', 'barbershop', 30, 0, 20.00, null, null, false, 5),
  ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-000000000003', 'Tinte completo', 'Aplicación global de color', 'beauty_salon', 45, 35, 120.00, null, null, false, 6),
  ('33333333-3333-4333-8333-000000000007', '22222222-2222-4222-8222-000000000003', 'Mechas / Balayage', 'Técnica a mano alzada o papel', 'beauty_salon', 90, 40, 250.00, 'percentage', 35, false, 7),
  ('33333333-3333-4333-8333-000000000008', '22222222-2222-4222-8222-000000000003', 'Retoque de raíz', 'Hasta 3 cm de crecimiento', 'beauty_salon', 40, 30, 80.00, null, null, false, 8),
  ('33333333-3333-4333-8333-000000000009', '22222222-2222-4222-8222-000000000004', 'Corte dama', 'Incluye lavado y secado', 'beauty_salon', 45, 0, 45.00, null, null, false, 9),
  ('33333333-3333-4333-8333-000000000010', '22222222-2222-4222-8222-000000000004', 'Brushing / Planchado', 'Secado con forma', 'beauty_salon', 40, 0, 35.00, null, null, false, 10),
  ('33333333-3333-4333-8333-000000000011', '22222222-2222-4222-8222-000000000005', 'Hidratación profunda', 'Mascarilla y vapor', 'beauty_salon', 30, 15, 60.00, null, null, false, 11),
  ('33333333-3333-4333-8333-000000000012', '22222222-2222-4222-8222-000000000005', 'Keratina', 'Alisado con keratina', 'beauty_salon', 90, 30, 220.00, null, null, false, 12),
  ('33333333-3333-4333-8333-000000000013', '22222222-2222-4222-8222-000000000006', 'Manicure clásica', 'Limpieza, cutícula y esmaltado', 'beauty_salon', 40, 0, 25.00, null, null, false, 13),
  ('33333333-3333-4333-8333-000000000014', '22222222-2222-4222-8222-000000000006', 'Uñas acrílicas', 'Set completo', 'beauty_salon', 90, 0, 90.00, null, null, false, 14),
  ('33333333-3333-4333-8333-000000000015', '22222222-2222-4222-8222-000000000007', 'Combo Corte + Barba', 'Corte clásico y perfilado', 'barbershop', 50, 0, 38.00, null, null, true, 15),
  ('33333333-3333-4333-8333-000000000016', '22222222-2222-4222-8222-000000000007', 'Combo Color + Hidratación', 'Tinte completo con hidratación', 'beauty_salon', 75, 50, 165.00, null, null, true, 16)
on conflict (id) do nothing;

insert into public.service_combo_items (combo_id, service_id, quantity) values
  ('33333333-3333-4333-8333-000000000015', '33333333-3333-4333-8333-000000000001', 1),
  ('33333333-3333-4333-8333-000000000015', '33333333-3333-4333-8333-000000000004', 1),
  ('33333333-3333-4333-8333-000000000016', '33333333-3333-4333-8333-000000000006', 1),
  ('33333333-3333-4333-8333-000000000016', '33333333-3333-4333-8333-000000000011', 1)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
insert into public.clients (id, full_name, phone, email, birth_date, gender, segment, notes, tags, preferred_staff_id) values
  ('44444444-4444-4444-8444-000000000001', 'José Castillo', '987654321', 'jose.castillo@mail.com', '1990-03-12', 'male', 'barbershop', 'Prefiere máquina 1 a los costados', '{frecuente}', '11111111-1111-4111-8111-000000000002'),
  ('44444444-4444-4444-8444-000000000002', 'María Gonzales', '976543210', 'maria.g@mail.com', make_date(1992, extract(month from (now() at time zone 'America/Lima'))::int, 20), 'female', 'beauty_salon', 'Cuero cabelludo sensible', '{vip,color}', '11111111-1111-4111-8111-000000000004'),
  ('44444444-4444-4444-8444-000000000003', 'Luis Paredes', '965432109', null, '1987-07-02', 'male', 'barbershop', null, '{}', '11111111-1111-4111-8111-000000000003'),
  ('44444444-4444-4444-8444-000000000004', 'Carla Rivera', '954321098', 'carla.rivera@mail.com', '1995-11-23', 'female', 'beauty_salon', 'Alergia leve al amoníaco: usar tinte sin amoníaco', '{color}', '11111111-1111-4111-8111-000000000004'),
  ('44444444-4444-4444-8444-000000000005', 'Renzo Valdivia', '943210987', null, '1999-01-30', 'male', 'barbershop', null, '{}', null),
  ('44444444-4444-4444-8444-000000000006', 'Fiorella Chávez', '932109876', 'fio.chavez@mail.com', '1993-05-17', 'female', 'beauty_salon', null, '{uñas}', '11111111-1111-4111-8111-000000000005'),
  ('44444444-4444-4444-8444-000000000007', 'Miguel Sánchez', '921098765', null, '1985-09-08', 'male', 'both', 'Viene con su hija los sábados', '{}', null),
  ('44444444-4444-4444-8444-000000000008', 'Daniela Herrera', '910987654', 'dani.h@mail.com', '1998-12-04', 'female', 'beauty_salon', null, '{}', '11111111-1111-4111-8111-000000000005'),
  ('44444444-4444-4444-8444-000000000009', 'Kevin Flores', '998877665', null, make_date(1996, extract(month from (now() at time zone 'America/Lima'))::int, 25), 'male', 'barbershop', null, '{}', null),
  ('44444444-4444-4444-8444-000000000010', 'Patricia Ramos', '987766554', 'paty.ramos@mail.com', '1980-04-19', 'female', 'beauty_salon', null, '{}', null),
  ('44444444-4444-4444-8444-000000000011', 'Andrés Morales', '976655443', null, '1991-08-27', 'male', 'barbershop', null, '{}', null),
  ('44444444-4444-4444-8444-000000000012', 'Sofía Lazo', '965544332', 'sofia.lazo@mail.com', '2000-02-14', 'female', 'beauty_salon', 'Cliente nueva, referida por María', '{nueva}', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Ficha técnica
-- ---------------------------------------------------------------------
insert into public.client_technical_records (
  client_id, staff_id, record_type, service_date, cut_style, fade_type, clipper_guards, beard_style, finish,
  color_formula, developer_volume, processing_minutes, hair_diagnosis, nails_diagnosis, products_used, result_notes
) values
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-000000000002', 'barber', current_date - 14,
   'Crop texturizado', 'Mid fade', 'Laterales 1 → 0.5, nuca 0', 'Barba corta perfilada', 'Mate',
   null, null, null, null, null, 'Pomada mate', 'Repetir mismo degradado'),
  ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-000000000003', 'barber', current_date - 9,
   'Clásico con raya lateral', 'Low fade', 'Laterales 2, nuca 1', 'Sin barba', 'Brillo medio',
   null, null, null, null, null, 'Cera brillante', null),
  ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-000000000004', 'color', current_date - 21,
   null, null, null, null, null,
   '6.0 (30 g) + 7.3 (30 g) + oxidante 1:1,5', 20, 35, 'Cabello medio, porosidad media, 20% canas', null,
   'Protector de cuero cabelludo, mascarilla post color', 'Tono homogéneo; retocar raíz en 5 semanas'),
  ('44444444-4444-4444-8444-000000000004', '11111111-1111-4111-8111-000000000004', 'hair_diagnosis', current_date - 30,
   null, null, null, null, null,
   null, null, null, 'Puntas abiertas y deshidratación por plancha', null,
   'Sérum reparador', 'Recomendar hidratación quincenal'),
  ('44444444-4444-4444-8444-000000000006', '11111111-1111-4111-8111-000000000005', 'nails', current_date - 7,
   null, null, null, null, null,
   null, null, null, null, 'Uñas finas, cutícula seca', 'Base fortalecedora, esmalte gel nude', 'Sin incidencias');

-- ---------------------------------------------------------------------
-- Inventario (stock inicial vía movimientos de compra para dejar auditoría)
-- ---------------------------------------------------------------------
insert into public.inventory_items (id, sku, name, item_type, segment, brand, unit, stock, min_stock, cost, price, supplier) values
  ('55555555-5555-4555-8555-000000000001', 'RET-001', 'Pomada mate 100 g', 'retail', 'barbershop', 'Norte Grooming', 'unidad', 0, 6, 18.00, 35.00, 'Distribuidora Andina'),
  ('55555555-5555-4555-8555-000000000002', 'RET-002', 'Cera brillante 100 g', 'retail', 'barbershop', 'Norte Grooming', 'unidad', 0, 6, 16.00, 32.00, 'Distribuidora Andina'),
  ('55555555-5555-4555-8555-000000000003', 'RET-003', 'Aceite para barba 30 ml', 'retail', 'barbershop', 'Bosque', 'unidad', 0, 5, 20.00, 40.00, 'Distribuidora Andina'),
  ('55555555-5555-4555-8555-000000000004', 'RET-004', 'Shampoo matizador 300 ml', 'retail', 'beauty_salon', 'Lumière', 'unidad', 0, 4, 28.00, 55.00, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000005', 'RET-005', 'Mascarilla hidratante 250 ml', 'retail', 'beauty_salon', 'Lumière', 'unidad', 0, 4, 30.00, 60.00, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000006', 'RET-006', 'Sérum reparador 50 ml', 'retail', 'beauty_salon', 'Lumière', 'unidad', 0, 5, 25.00, 50.00, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000007', 'SUP-001', 'Tinte 6.0 rubio oscuro', 'supply', 'beauty_salon', 'ColorTech', 'tubo', 0, 6, 14.00, null, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000008', 'SUP-002', 'Peróxido 20 volúmenes', 'supply', 'beauty_salon', 'ColorTech', 'litro', 0, 2, 22.00, null, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000009', 'SUP-003', 'Polvo decolorante 500 g', 'supply', 'beauty_salon', 'ColorTech', 'bolsa', 0, 3, 45.00, null, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000010', 'SUP-004', 'Hojas de navaja (caja x100)', 'supply', 'barbershop', 'Derby', 'caja', 0, 2, 30.00, null, 'Distribuidora Andina'),
  ('55555555-5555-4555-8555-000000000011', 'SUP-005', 'Esmalte gel nude', 'supply', 'beauty_salon', 'NailArt', 'frasco', 0, 3, 18.00, null, 'Beauty Pro SAC'),
  ('55555555-5555-4555-8555-000000000012', 'SUP-006', 'Toallas desechables (paquete x50)', 'supply', 'both', 'Higienix', 'paquete', 0, 4, 12.00, null, 'Distribuidora Andina')
on conflict (id) do nothing;

insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, notes, created_at) values
  ('55555555-5555-4555-8555-000000000001', 'purchase', 40, 18.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000002', 'purchase', 40, 16.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000003', 'purchase', 40, 20.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000004', 'purchase', 40, 28.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000005', 'purchase', 40, 30.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000006', 'purchase', 4, 25.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000007', 'purchase', 10, 14.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000008', 'purchase', 4, 22.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000009', 'purchase', 2, 45.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000010', 'purchase', 5, 30.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000011', 'purchase', 8, 18.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days'),
  ('55555555-5555-4555-8555-000000000012', 'purchase', 12, 12.00, 'Compra inicial', 'Stock de apertura', now() - interval '35 days');

insert into public.inventory_movements (item_id, movement_type, quantity, reference, notes, created_at) values
  ('55555555-5555-4555-8555-000000000007', 'usage', 5, 'Uso en servicios', 'Consumo de color del mes', now() - interval '3 days'),
  ('55555555-5555-4555-8555-000000000008', 'usage', 2.5, 'Uso en servicios', 'Consumo de oxidante', now() - interval '3 days'),
  ('55555555-5555-4555-8555-000000000012', 'usage', 6, 'Uso interno', null, now() - interval '2 days');

-- ---------------------------------------------------------------------
-- Historial de 4 semanas: citas completadas + ventas + caja cerrada
-- ---------------------------------------------------------------------
do $$
declare
  v_tz        text := 'America/Lima';
  v_today     date := (now() at time zone 'America/Lima')::date;
  v_reg       uuid := '66666666-6666-4666-8666-000000000001';
  v_recep     uuid := '11111111-1111-4111-8111-000000000006';
  v_staff     uuid[] := array[
                '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003',
                '11111111-1111-4111-8111-000000000004', '11111111-1111-4111-8111-000000000005']::uuid[];
  v_barber    uuid[] := array[
                '33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-000000000002',
                '33333333-3333-4333-8333-000000000003', '33333333-3333-4333-8333-000000000004',
                '33333333-3333-4333-8333-000000000005', '33333333-3333-4333-8333-000000000015']::uuid[];
  v_salon     uuid[] := array[
                '33333333-3333-4333-8333-000000000006', '33333333-3333-4333-8333-000000000007',
                '33333333-3333-4333-8333-000000000008', '33333333-3333-4333-8333-000000000009',
                '33333333-3333-4333-8333-000000000010', '33333333-3333-4333-8333-000000000011',
                '33333333-3333-4333-8333-000000000012', '33333333-3333-4333-8333-000000000013',
                '33333333-3333-4333-8333-000000000014', '33333333-3333-4333-8333-000000000016']::uuid[];
  v_barber_clients uuid[] := array[
                '44444444-4444-4444-8444-000000000001', '44444444-4444-4444-8444-000000000003',
                '44444444-4444-4444-8444-000000000005', '44444444-4444-4444-8444-000000000007']::uuid[];
  v_salon_clients uuid[] := array[
                '44444444-4444-4444-8444-000000000002', '44444444-4444-4444-8444-000000000004',
                '44444444-4444-4444-8444-000000000006', '44444444-4444-4444-8444-000000000008']::uuid[];
  v_products  uuid[] := array[
                '55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000002',
                '55555555-5555-4555-8555-000000000003', '55555555-5555-4555-8555-000000000004',
                '55555555-5555-4555-8555-000000000005']::uuid[];
  v_methods   text[] := array['cash', 'card', 'transfer', 'wallet'];
  d integer; s integer; k integer;
  v_staff_id uuid; v_service uuid; v_client uuid; v_product uuid;
  v_name text; v_product_name text;
  v_price numeric; v_product_price numeric; v_dur integer; v_proc integer;
  v_start timestamptz; v_end timestamptz;
  v_appt uuid; v_tx uuid; v_tip numeric; v_method text; v_subtotal numeric;
begin
  insert into public.cash_registers (id, opened_by, opened_at, opening_amount, status, notes)
  values (v_reg, v_recep, ((v_today - 30)::timestamp + time '08:30') at time zone v_tz, 100, 'open', 'Caja histórica de demostración');

  for d in reverse 28..1 loop
    continue when extract(dow from (v_today - d)) = 0;  -- domingo cerrado

    for s in 1..4 loop
      for k in 0..(1 + ((d + s) % 3)) loop
        v_staff_id := v_staff[s];
        if s <= 2 then
          v_service := v_barber[1 + ((d * 3 + s + k * 5) % 6)];
          v_client  := v_barber_clients[1 + ((d + s + k) % 4)];
        else
          v_service := v_salon[1 + ((d * 7 + s + k * 3) % 10)];
          v_client  := v_salon_clients[1 + ((d * 2 + s + k) % 4)];
        end if;

        select name, price, duration_minutes, processing_minutes
          into v_name, v_price, v_dur, v_proc
          from public.services where id = v_service;

        v_start := ((v_today - d)::timestamp + make_interval(hours => 9 + k * 3)) at time zone v_tz;
        v_end   := v_start + make_interval(mins => v_dur + v_proc);

        insert into public.appointments (
          client_id, staff_id, service_id, starts_at, duration_minutes, processing_minutes, price,
          status, source, checked_in_at, started_at, completed_at, created_by, created_at
        ) values (
          v_client, v_staff_id, v_service, v_start, v_dur, v_proc, v_price,
          'completed', (array['phone', 'whatsapp', 'walk_in', 'app'])[1 + ((d + k) % 4)],
          v_start - interval '5 minutes', v_start, v_end, v_recep, v_start - interval '2 days'
        ) returning id into v_appt;

        v_tip := case when (d + k + s) % 4 = 0 then 5 else 0 end;
        v_method := v_methods[1 + ((d + s + k) % 4)];
        v_product := null;
        v_product_price := 0;
        if (d + s + k) % 5 = 0 then
          v_product := v_products[1 + ((d + s) % 5)];
          select name, price into v_product_name, v_product_price from public.inventory_items where id = v_product;
        end if;
        v_subtotal := v_price + v_product_price;

        insert into public.transactions (
          cash_register_id, client_id, appointment_id, created_by, tip_staff_id,
          subtotal, discount_amount, tip_amount, total, cash_received, change_given, created_at
        ) values (
          v_reg, v_client, v_appt, v_recep, case when v_tip > 0 then v_staff_id end,
          v_subtotal, 0, v_tip, v_subtotal + v_tip,
          case when v_method = 'cash' then v_subtotal + v_tip end, 0, v_end
        ) returning id into v_tx;

        insert into public.transaction_items (transaction_id, item_kind, service_id, staff_id, description, quantity, unit_price, created_at)
        values (v_tx, 'service', v_service, v_staff_id, v_name, 1, v_price, v_end);

        if v_product is not null then
          insert into public.transaction_items (transaction_id, item_kind, inventory_item_id, staff_id, description, quantity, unit_price, created_at)
          values (v_tx, 'product', v_product, v_staff_id, v_product_name, 1, v_product_price, v_end);
        end if;

        insert into public.transaction_payments (transaction_id, method, amount, created_at)
        values (v_tx, v_method, v_subtotal + v_tip, v_end);
      end loop;
    end loop;
  end loop;

  update public.cash_registers r
     set status        = 'closed',
         closed_at     = ((v_today - 1)::timestamp + time '21:00') at time zone v_tz,
         closed_by     = v_recep,
         expected_cash = 100 + x.cash,
         counted_cash  = 100 + x.cash,
         difference    = 0
    from (
      select coalesce(sum(p.amount), 0) as cash
        from public.transaction_payments p
        join public.transactions t on t.id = p.transaction_id
       where t.cash_register_id = v_reg and p.method = 'cash' and t.status = 'completed'
    ) x
   where r.id = v_reg;

  -- Caja del día abierta
  insert into public.cash_registers (id, opened_by, opened_at, opening_amount, status, notes)
  values ('66666666-6666-4666-8666-000000000002', v_recep, (v_today::timestamp + time '08:30') at time zone v_tz, 150, 'open', 'Apertura del día');

  -- Citas de hoy
  insert into public.appointments (client_id, walk_in_name, staff_id, service_id, starts_at, status, source, notes) values
    ('44444444-4444-4444-8444-000000000001', null, '11111111-1111-4111-8111-000000000002', '33333333-3333-4333-8333-000000000002', (v_today::timestamp + time '09:00') at time zone v_tz, 'confirmed', 'whatsapp', null),
    ('44444444-4444-4444-8444-000000000005', null, '11111111-1111-4111-8111-000000000002', '33333333-3333-4333-8333-000000000015', (v_today::timestamp + time '10:00') at time zone v_tz, 'scheduled', 'phone', null),
    ('44444444-4444-4444-8444-000000000007', null, '11111111-1111-4111-8111-000000000002', '33333333-3333-4333-8333-000000000001', (v_today::timestamp + time '11:30') at time zone v_tz, 'waiting', 'walk_in', null),
    ('44444444-4444-4444-8444-000000000011', null, '11111111-1111-4111-8111-000000000002', '33333333-3333-4333-8333-000000000004', (v_today::timestamp + time '16:00') at time zone v_tz, 'scheduled', 'app', null),
    ('44444444-4444-4444-8444-000000000003', null, '11111111-1111-4111-8111-000000000003', '33333333-3333-4333-8333-000000000001', (v_today::timestamp + time '09:30') at time zone v_tz, 'in_service', 'phone', null),
    ('44444444-4444-4444-8444-000000000009', null, '11111111-1111-4111-8111-000000000003', '33333333-3333-4333-8333-000000000005', (v_today::timestamp + time '11:00') at time zone v_tz, 'confirmed', 'whatsapp', null),
    ('44444444-4444-4444-8444-000000000001', null, '11111111-1111-4111-8111-000000000003', '33333333-3333-4333-8333-000000000003', (v_today::timestamp + time '15:00') at time zone v_tz, 'scheduled', 'app', 'Diseño de líneas laterales'),
    (null, 'Cliente de paso', '11111111-1111-4111-8111-000000000003', '33333333-3333-4333-8333-000000000002', (v_today::timestamp + time '17:00') at time zone v_tz, 'scheduled', 'walk_in', null),
    ('44444444-4444-4444-8444-000000000002', null, '11111111-1111-4111-8111-000000000004', '33333333-3333-4333-8333-000000000006', (v_today::timestamp + time '09:00') at time zone v_tz, 'in_service', 'whatsapp', 'Usar fórmula registrada'),
    ('44444444-4444-4444-8444-000000000004', null, '11111111-1111-4111-8111-000000000004', '33333333-3333-4333-8333-000000000009', (v_today::timestamp + time '11:00') at time zone v_tz, 'confirmed', 'phone', null),
    ('44444444-4444-4444-8444-000000000012', null, '11111111-1111-4111-8111-000000000004', '33333333-3333-4333-8333-000000000007', (v_today::timestamp + time '15:00') at time zone v_tz, 'scheduled', 'online', 'Primera visita'),
    ('44444444-4444-4444-8444-000000000006', null, '11111111-1111-4111-8111-000000000005', '33333333-3333-4333-8333-000000000013', (v_today::timestamp + time '10:00') at time zone v_tz, 'confirmed', 'app', null),
    ('44444444-4444-4444-8444-000000000008', null, '11111111-1111-4111-8111-000000000005', '33333333-3333-4333-8333-000000000012', (v_today::timestamp + time '12:00') at time zone v_tz, 'scheduled', 'whatsapp', null),
    ('44444444-4444-4444-8444-000000000010', null, '11111111-1111-4111-8111-000000000005', '33333333-3333-4333-8333-000000000010', (v_today::timestamp + time '16:00') at time zone v_tz, 'cancelled', 'phone', null);

  -- Citas de mañana (para recordatorios)
  insert into public.appointments (client_id, staff_id, service_id, starts_at, status, source) values
    ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-000000000002', '33333333-3333-4333-8333-000000000002', ((v_today + 1)::timestamp + time '10:00') at time zone v_tz, 'scheduled', 'phone'),
    ('44444444-4444-4444-8444-000000000007', '11111111-1111-4111-8111-000000000003', '33333333-3333-4333-8333-000000000015', ((v_today + 1)::timestamp + time '12:00') at time zone v_tz, 'scheduled', 'whatsapp'),
    ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-000000000004', '33333333-3333-4333-8333-000000000011', ((v_today + 1)::timestamp + time '11:00') at time zone v_tz, 'confirmed', 'app'),
    ('44444444-4444-4444-8444-000000000006', '11111111-1111-4111-8111-000000000005', '33333333-3333-4333-8333-000000000014', ((v_today + 1)::timestamp + time '15:00') at time zone v_tz, 'scheduled', 'whatsapp');
end;
$$;

-- ---------------------------------------------------------------------
-- Métricas de clientes coherentes con el historial
-- ---------------------------------------------------------------------
update public.clients c
   set visits_count  = x.visits,
       total_spent   = x.total,
       last_visit_at = x.last_visit
  from (
    select client_id, count(*) as visits, sum(total) as total, max(created_at) as last_visit
      from public.transactions
     where status = 'completed' and client_id is not null
     group by client_id
  ) x
 where c.id = x.client_id;

update public.clients set visits_count = 3, total_spent = 95,  last_visit_at = now() - interval '70 days'
 where id in ('44444444-4444-4444-8444-000000000009', '44444444-4444-4444-8444-000000000010');
update public.clients set visits_count = 1, total_spent = 25,  last_visit_at = now() - interval '120 days'
 where id = '44444444-4444-4444-8444-000000000011';
