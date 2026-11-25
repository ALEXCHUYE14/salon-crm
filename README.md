# CRM para Barbería y Salón de Belleza

CRM + Agenda + Caja/POS + Comisiones + Inventario para **barberías**, **salones de belleza** o un **local mixto**.
Stack: **Next.js 15 (App Router) + TypeScript + Tailwind CSS + Supabase** (PostgreSQL, Auth, Storage y Realtime).

## Puesta en marcha

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta en orden:
   - `supabase/migrations/001_schema_and_rls.sql`
   - `supabase/migrations/002_table_grants.sql`
   - `supabase/seed.sql` (datos de demostración, opcional)
   - `supabase/aplicar-mejoras-003-a-016.sql` (todas las mejoras en un solo archivo; es seguro re-ejecutarlo completo)
3. `cp .env.example .env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev` y abre `http://localhost:3000`.
5. Regístrate con **admin@demo.com**: queda vinculado como *Propietario*. Los demás miembros del seed
   (`recepcion@demo.com`, `carlos@demo.com`, `lucia@demo.com`…) se vinculan solos al registrarse con su correo.
   Sin seed, el **primer usuario** que se registra se convierte en propietario.

> Si en Auth tienes activada la confirmación de correo, confirma el email antes de ingresar.
> Para desarrollo con la CLI: `supabase db reset` aplica la migración y el seed.

Scripts: `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint`

## Arquitectura de carpetas

```
supabase/
  migrations/001_schema_and_rls.sql   Esquema, triggers, RPC, RLS, Realtime y Storage
  seed.sql                            Datos de prueba (4 semanas de historial)
src/
  middleware.ts                       Sesión de Supabase + protección de rutas
  app/
    layout.tsx · globals.css          Raíz, paleta y estilos de impresión de tickets
    login/page.tsx
    (app)/layout.tsx                  AppProvider + AppShell (rutas autenticadas)
    (app)/dashboard|agenda|clientes|clientes/[id]|servicios|equipo|caja|inventario|fidelizacion|reportes|ajustes
  components/
    ui/                               Button, Form, Card, Badge, Modal, Tabs, Toast, Icon (lucide 1.75)
    layout/                           Sidebar (PC/tableta), BottomNav (móvil), AppShell, ModuleGate
  providers/app-provider.tsx          Ajustes, usuario/rol, terminología y permisos
  hooks/use-catalog.ts                Equipo + servicios filtrados por modo operativo
  lib/                                supabase/ (browser, server, middleware), dates, utils, terminology, constants
  types/domain.ts                     Tipos de dominio alineados con el SQL
  modules/                            Un dominio por carpeta: api.ts + vista + components/
    auth · dashboard · agenda · clients · services · team · pos · inventory · loyalty · reports · settings
```

## Decisiones clave

- **Choques horarios**: restricción `EXCLUDE USING gist` por profesional (ignora citas canceladas / no asistió),
  además de la verificación en vivo en el formulario. El bloque reservado incluye el **tiempo de pose**.
- **Cobro atómico**: la RPC `create_sale` registra ticket, ítems, pagos mixtos, propina, vuelto, cierra la cita,
  descuenta stock (trigger) y actualiza las métricas del cliente en una sola transacción.
- **Comisiones**: se calculan por trigger en cada ítem con prioridad *servicio → especialista → negocio*
  (porcentaje o monto fijo). Productos: % del especialista o del negocio. El descuento general del ticket no
  reduce comisiones; el descuento por línea sí. `settle_commissions` liquida comisiones + propinas por periodo.
- **Arqueo**: `close_cash_register` calcula el efectivo esperado (fondo + pagos en efectivo netos de vuelto) y la diferencia.
- **Inventario**: los movimientos son un registro de auditoría (sin edición); el stock nunca queda negativo.
  `is_low_stock` es una columna generada para filtrar alertas desde la API.
- **Seguridad**: RLS en todas las tablas. Especialistas solo gestionan sus propias citas y ven solo sus ventas;
  recepción cobra y mueve inventario; solo administración anula ventas, liquida comisiones y cambia ajustes.
  Los permisos por módulo de **Ajustes → Permisos** controlan la interfaz.
- **Egress bajo**: columnas explícitas en cada `select`, paginación con `range()`, reportes agregados en SQL (RPC)
  y Realtime solo en `appointments` con filtro `starts_at >= inicio del rango visible`.
- **Zona horaria**: los reportes cortan el día según `business_settings.timezone`; la interfaz asume que el
  navegador está en la misma zona que el negocio.

## Modo operativo

`Ajustes → Operación` cambia entre **Barbería** (Barbero / Silla), **Salón de belleza** (Estilista / Tocador) y
**Mixto** (Especialista / Puesto). Además filtra servicios, categorías, inventario y tipos de ficha técnica,
y permite activar u ocultar módulos.

## Módulos incorporados (migraciones 003–016)

| Migración | Funcionalidad | Dónde se usa |
|---|---|---|
| 003 | Gastos, retiros e ingresos de caja (entran al arqueo) | Caja → Gastos y retiros · Reportes |
| 004 | Bloqueos y ausencias del personal (la BD impide agendar encima) | Agenda → Bloquear horario |
| 005 | Varios servicios por visita (`booking_id`) y cobro conjunto | Agenda → Agregar otro servicio |
| 006 | Reserva online pública con horarios reales y antispam | `/reservar` · Ajustes → Reserva online |
| 007 | Recetas: insumos que descuenta cada servicio al cobrarlo | Servicios → Insumos que consume |
| 008 | Adelantos de citas e inasistencias | Detalle de la cita → Adelantos |
| 009 | Programa de puntos (ganar y canjear en caja) | Ajustes → Puntos · Caja · Ficha del cliente |
| 010 | Paquetes de sesiones y gift cards | Fidelización → Paquetes · Caja |
| 011 | Encuesta de satisfacción por WhatsApp | Recibo → Encuesta · `/encuesta/<token>` · Reportes |
| 012 | Fotos de antes y después (bucket privado) | Ficha del cliente → Fotos |
| 013 | Proveedores y órdenes de compra | Inventario → Compras / Proveedores |
| 014 | Auditoría de cambios sensibles (solo lectura) | Ajustes → Auditoría |
| 015 | Multisede (equipo, agenda, caja y reportes por sede) | Ajustes → Sedes · selector en el menú |
| 016 | Limpieza semanal (auditoría > 13 meses, encuestas vencidas) | Automática con pg_cron o `select purge_old_records();` |

Notas: `create_sale` y `void_transaction` son `SECURITY DEFINER` desde la 008 (validan el rol al inicio);
si se re-ejecuta una migración intermedia, hay que re-ejecutar también las siguientes. El inventario es
compartido entre sedes.
