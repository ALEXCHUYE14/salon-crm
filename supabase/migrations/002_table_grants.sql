-- =====================================================================
--  002_table_grants.sql — Privilegios de tabla para el rol "authenticated"
--
--  Los proyectos nuevos de Supabase ya no conceden privilegios por defecto
--  a anon/authenticated sobre las tablas de "public". Sin estos GRANT,
--  Postgres responde "permission denied for table ..." antes de evaluar RLS.
--  El acceso real sigue controlado por las políticas RLS de 001.
--  "anon" NO recibe acceso a ninguna tabla.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Tablas/secuencias que se creen en el futuro con el rol actual
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
