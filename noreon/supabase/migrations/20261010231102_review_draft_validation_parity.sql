-- Match JavaScript String.trim and UTF-16 length used by the command schema.
create function public.workspace_text_units(s text) returns integer
language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer
 from regexp_split_to_table(s,'') ch where ch<>''
$$;
revoke all on function public.workspace_text_units(text) from public,anon,authenticated,service_role;
create or replace function public.workspace_valid_review_draft(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; t jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(d))<>7 then return false; end if;
 foreach k in array array['explanation','instructions','followUp','medicationName','medicationDose','medicationInstructions'] loop
  if jsonb_typeof(d->k) is distinct from 'string' then return false; end if;
  d:=jsonb_set(d,array[k],to_jsonb(btrim(d->>k,E' \t\n\r\v\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')));
 end loop;
 if public.workspace_text_units(btrim(d->>'explanation')) not between 1 and 1500 or public.workspace_text_units(btrim(d->>'instructions')) not between 1 and 1500
 or btrim(d->>'instructions')='Add the approved care instructions.'
 or public.workspace_text_units(btrim(d->>'followUp'))>500 or public.workspace_text_units(btrim(d->>'medicationInstructions'))>500
 or public.workspace_text_units(btrim(d->>'medicationName'))>120 or public.workspace_text_units(btrim(d->>'medicationDose'))>120
 or jsonb_typeof(d->'medicationTimes') is distinct from 'array' then return false; end if;
 if jsonb_array_length(d->'medicationTimes')>4 then return false; end if;
 for t in select value from jsonb_array_elements(d->'medicationTimes') loop
  if jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
 end loop;
 return btrim(d->>'medicationName')='' or (btrim(d->>'medicationDose')<>'' and jsonb_array_length(d->'medicationTimes')>0);
end $$;
