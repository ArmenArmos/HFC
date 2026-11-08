-- Match the same strict UUID shape at nested booking and collection boundaries.
-- Forward correction; applied35421 remains immutable.
create or replace function public._patient_visit_command(p jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare e jsonb;entries jsonb:='[]';k text;allowed text[];seen text[]:='{}';key text;n numeric;sys jsonb;dia jsonb;pulse jsonb;t timestamptz;
begin
 if jsonb_typeof(p)is distinct from 'object' or not(p?&array['version','id','revision','submissionId','visitId','op'])or p->>'version'is distinct from 'visit-evidence-v1'then return null;end if;
 foreach k in array array['id','visitId','submissionId']loop
  if jsonb_typeof(p->k)is distinct from 'string' or p->>k !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'then return null;end if;
 end loop;
 if jsonb_typeof(p->'revision')is distinct from 'number'then return null;end if;
 n:=(p->>'revision')::numeric;if n<>trunc(n)or n not between 0 and 9007199254740991 then return null;end if;
 if p->>'op'='open-visit'then
  if not(p?'booking')or p-array['version','id','revision','submissionId','visitId','op','booking']<>'{}'then return null;end if;
  e:=p->'booking';
  if e<>'null'::jsonb then
   if jsonb_typeof(e)is distinct from 'object'or not(e?&array['appointmentId','acceptedRevision'])or e-array['appointmentId','acceptedRevision']<>'{}'
    or jsonb_typeof(e->'appointmentId')is distinct from 'string'or jsonb_typeof(e->'acceptedRevision')is distinct from 'number'then return null;end if;
   if e->>'appointmentId'!~*'^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'then return null;end if;n:=(e->>'acceptedRevision')::numeric;
   if n<>trunc(n)or n not between 0 and 9007199254740991 then return null;end if;
  end if;return p;
 elsif p->>'op'is distinct from 'append-evidence'then return null;end if;
 if not(p?'entries')or p-array['version','id','revision','submissionId','visitId','op','entries']<>'{}'or jsonb_typeof(p->'entries')is distinct from 'array'then return null;end if;
 if jsonb_array_length(p->'entries')not between 1 and 128 then return null;end if;
 for e in select value from jsonb_array_elements(p->'entries')loop
  if jsonb_typeof(e)is distinct from 'object'or jsonb_typeof(e->'observedAt')is distinct from 'string'
   or e->>'observedAt'!~'^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.\d+)?(Z|[+-]\d{2}:\d{2})$'then return null;end if;
  t:=public._patient_visit_instant(e->>'observedAt');if not isfinite(t)then return null;end if;
  key:=null;
  if e->>'kind'='observation'then
   if not(e?&array['kind','field','observedAt','state'])or coalesce(e->>'field','')not in('height','weight','systolic','diastolic','pulse','waist','neck','temperature')then return null;end if;
   key:='field:'||(e->>'field');
   if e->>'state'='known'then
    allowed:=array['kind','field','observedAt','state','value','unit'];
    if jsonb_typeof(e->'value')is distinct from 'number'or jsonb_typeof(e->'unit')is distinct from 'string'then return null;end if;
    n:=(e->>'value')::numeric;if abs(n)>1.7976931348623157e308 then return null;end if;
    if e->>'unit'is distinct from (case e->>'field'when 'height'then 'cm'when 'waist'then 'cm'when 'neck'then 'cm'when 'weight'then 'kg'when 'pulse'then 'beats/min'when 'temperature'then 'C'else 'mmHg'end) then return null;end if;
    if e->>'field'='systolic'then sys:=e;elsif e->>'field'='diastolic'then dia:=e;elsif e->>'field'='pulse'then pulse:=e;end if;
   elsif e->>'state'='unknown'then allowed:=array['kind','field','observedAt','state','reason'];
   else return null;end if;
  elsif e->>'kind'='collection'then
   allowed:=array['kind','observedAt','appointmentId','acceptedRevision','testId','outcome','reason'];
   if not(e?&array['appointmentId','acceptedRevision','testId','outcome'])or jsonb_typeof(e->'appointmentId')is distinct from 'string'or jsonb_typeof(e->'acceptedRevision')is distinct from 'number'
    or jsonb_typeof(e->'testId')is distinct from 'string'or length(e->>'testId')not between 1 and 100 or coalesce(e->>'outcome','')not in('collected','not-collected','unknown')then return null;end if;
   if e->>'appointmentId'!~*'^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'then return null;end if;n:=(e->>'acceptedRevision')::numeric;if n<>trunc(n)or n not between 0 and 9007199254740991 then return null;end if;
   key:='test:'||(e->>'testId');
   if e->>'outcome'<>'collected'and not(e?'reason')then return null;end if;
  elsif e->>'kind'='note'then allowed:=array['kind','observedAt','text'];
  else return null;end if;
  if e-allowed<>'{}'then return null;end if;
  foreach k in array array['reason','text']loop
   if e?k or(k='text'and e->>'kind'='note')or(k='reason'and e->>'state'='unknown')then
    if jsonb_typeof(e->k)is distinct from 'string'or length(btrim(e->>k,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))not between 1 and 2000 then return null;end if;
    e:=jsonb_set(e,array[k],to_jsonb(btrim(e->>k,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')));
   end if;
  end loop;
  if key is not null then if key=any(seen)then return null;end if;seen:=array_append(seen,key);end if;
  entries:=entries||jsonb_build_array(e);
 end loop;
 if sys is not null and dia is not null then
  if(sys->>'value')::numeric<>trunc((sys->>'value')::numeric)or(dia->>'value')::numeric<>trunc((dia->>'value')::numeric)
   or(sys->>'value')::numeric not between 60 and 300 or(dia->>'value')::numeric not between 30 and 200
   or(sys->>'value')::numeric<=(dia->>'value')::numeric or public._patient_visit_instant(sys->>'observedAt')<>public._patient_visit_instant(dia->>'observedAt') then return null;end if;
  if pulse is not null and public._patient_visit_instant(pulse->>'observedAt')=public._patient_visit_instant(sys->>'observedAt')
   and((pulse->>'value')::numeric<>trunc((pulse->>'value')::numeric)or(pulse->>'value')::numeric not between 20 and 250)then return null;end if;
 end if;
 return jsonb_set(p,'{entries}',entries);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return null;
end$$;
