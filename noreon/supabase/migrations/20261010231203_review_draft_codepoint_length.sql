-- Zod 4.6 string limits count Unicode code points (checks.ts/codePointLength),
-- as PostgreSQL length(text) does. Retain the separate helper for parity tests.
create or replace function public.workspace_text_units(s text) returns integer
language sql immutable set search_path='' as $$ select length(s) $$;
