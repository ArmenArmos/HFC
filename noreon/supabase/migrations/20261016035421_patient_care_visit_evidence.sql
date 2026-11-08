-- Immutable factual nurse visits. Public envelopes are visit-evidence-v1.
create table public.patient_care_visit_command_receipts(
 user_id uuid not null references public.patient_clinical_cases(user_id),submission_id uuid not null,
 actor_id uuid not null references auth.users(id),session_id uuid not null,
 command jsonb not null,state text not null check(state in('committed','retired')),result jsonb,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(user_id,submission_id),check((state='committed')=(result is not null))
);
create table public.patient_care_visits(
 id uuid primary key,user_id uuid not null references public.patient_clinical_cases(user_id),
 created_at timestamptz not null default clock_timestamp(),actor_id uuid not null references auth.users(id),
 actor_name text not null,actor_role text not null check(actor_role='nurse'),clinic_id uuid not null,
 appointment_id uuid,accepted_revision bigint,booking_context jsonb,
 unique(user_id,id),foreign key(appointment_id,accepted_revision)references public.booking_appointment_versions(appointment_id,revision),
 check((appointment_id is null and accepted_revision is null and booking_context is null)or(appointment_id is not null and accepted_revision is not null and booking_context is not null))
);
create table public.patient_care_visit_entries(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,visit_id uuid not null,submission_id uuid not null,position integer not null,
 payload jsonb not null,observed_at text not null,observed_instant timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id),actor_name text not null,actor_role text not null check(actor_role='nurse'),clinic_id uuid not null,
 source text not null default 'staff-entered' check(source='staff-entered'),measurement_id uuid references public.patient_measurements(id),
 foreign key(user_id,visit_id)references public.patient_care_visits(user_id,id),
 foreign key(user_id,submission_id)references public.patient_care_visit_command_receipts(user_id,submission_id)deferrable initially deferred,
 unique(user_id,submission_id,position)
);
create index patient_care_visits_member on public.patient_care_visits(user_id,created_at,id);
create index patient_care_visit_entries_visit on public.patient_care_visit_entries(visit_id,recorded_at,submission_id,position);
alter table public.patient_care_visits enable row level security;
alter table public.patient_care_visit_entries enable row level security;
alter table public.patient_care_visit_command_receipts enable row level security;
revoke all on public.patient_care_visits,public.patient_care_visit_entries,public.patient_care_visit_command_receipts from public,anon,authenticated,service_role;
create function public._patient_visit_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Visit history is immutable';
end$$;
create trigger patient_care_visits_immutable before update or delete on public.patient_care_visits for each row execute function public._patient_visit_immutable();
create trigger patient_care_visit_entries_immutable before update or delete on public.patient_care_visit_entries for each row execute function public._patient_visit_immutable();
create trigger patient_care_visit_receipts_immutable before update or delete on public.patient_care_visit_command_receipts for each row execute function public._patient_visit_immutable();

-- JavaScript Date.parse's accepted public contract compares milliseconds. Truncate
-- lexical fractions before PostgreSQL conversion so .9999999 cannot round up.
create function public._patient_visit_instant(p text)returns timestamptz
language sql immutable set search_path=''as $$
 select regexp_replace(p,'(\.[0-9]{3})[0-9]+','\1')::timestamptz
$$;

-- Match strict browser shapes and trim only text that the public schema trims.
-- Never normalize away the literal observed offset in canonical command identity.
create function public._patient_visit_command(p jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
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
   perform(e->>'appointmentId')::uuid;n:=(e->>'acceptedRevision')::numeric;
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
   perform(e->>'appointmentId')::uuid;n:=(e->>'acceptedRevision')::numeric;if n<>trunc(n)or n not between 0 and 9007199254740991 then return null;end if;
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

-- Both execution and recovery call this AFTER their common advisory lock.
-- Reads take a SHARE case lock; writers/recovery take UPDATE. Never lock source
-- tables here: the writer inserts measurements/entries after this boundary.
create function public._patient_visit_authorize(p_member uuid,p_write boolean,p_exclusive boolean)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare actor uuid:=auth.uid();s public.workspace_staff;sid uuid;d uuid;
begin
 if auth.role()is distinct from 'authenticated'or actor is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;if sid is null then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=p_member and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege;end if;
 if p_exclusive then select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for update nowait;
 else select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for share nowait;end if;
 if not found then raise insufficient_privilege;end if;
 perform 1 from public.workspace_staff t join public.workspace_clinics k on k.id=t.clinic_id where t.user_id=actor for share of t,k nowait;
 perform 1 from public.workspace_staff where user_id=d for share nowait;
 perform 1 from public.real_staff_invitations where auth_user_id=actor for share nowait;
 perform 1 from auth.sessions where id=sid and user_id=actor and(not_after is null or not_after>clock_timestamp())for share nowait;
 if not found then raise insufficient_privilege;end if;
 select * into s from public.workspace_staff where user_id=actor;
 if s.role not in('nurse','doctor')or(p_write and s.role is distinct from 'nurse')or not public.staff_care_access(p_member,actor,true)then raise insufficient_privilege;end if;
 return s;
exception when invalid_text_representation then raise insufficient_privilege;
end$$;

-- Caller owns case/authority locks. Protect requirements against source INSERTs
-- as well as updates; these three tables are never written by a visit command.
create function public._patient_visit_booking(p_member uuid,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;r public.booking_manual_reservations;n public.booking_scheduling_notices;v public.booking_appointment_versions;s public.booking_program_seals;tests jsonb;
begin
 lock table public.profiles,public.patient_assessments,public.patient_consents in share mode nowait;
 for a in select * from public.booking_appointments where member_id=p_member and current_reservation_id is not null and(p_appointment is null or id=p_appointment)order by created_at desc,id for share nowait loop
  select * into r from public.booking_manual_reservations where id=a.current_reservation_id and appointment_id=a.id and member_id=p_member for share nowait;
  if not found then continue;end if;
  select * into n from public.booking_scheduling_notices where appointment_id=a.id and reservation_id=r.id and state='accepted'order by appointment_revision desc limit 1 for share nowait;
  if not found then continue;end if;
  select * into v from public.booking_appointment_versions where appointment_id=a.id and notice_id=n.id and program_id=n.program_id and proposed_arrangement=a.current_arrangement for share nowait;
  if not found then continue;end if;
  select * into s from public.booking_program_seals where id=v.program_id and member_id=p_member for share nowait;
  if not found then continue;end if;
  if s.requirements_token is distinct from public.patient_test_context(p_member)->>'requirementsToken'then
   return jsonb_build_object('availability','stale','context',null);
  end if;
  select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord)into tests
   from jsonb_array_elements(s.program->'items')with ordinality as items(i,ord)
   where i->>'method'in('lab','clinic')and(a.current_arrangement->'coveredTestIds')? (i->>'id');
  if tests is null then return jsonb_build_object('availability','unavailable','context',null);end if;
  return jsonb_build_object('availability','available','context',jsonb_build_object('version','booking-visit-context-v1','appointmentId',a.id,'acceptedRevision',v.revision,'tests',tests));
 end loop;
 return jsonb_build_object('availability','unlinked','context',null);
end$$;

create function public._patient_visit_history(p_member uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'createdAt',v.created_at,'bookingContext',v.booking_context,'entries',
  coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'submissionId',e.submission_id,'observedAt',e.observed_at,'observedInstant',e.observed_instant,
   'recordedAt',e.recorded_at,'actor',jsonb_build_object('id',e.actor_id,'name',e.actor_name,'role',e.actor_role,'clinicId',e.clinic_id),
   'source',e.source,'payload',e.payload,'measurementId',e.measurement_id)order by e.recorded_at,e.submission_id,e.position)
   from public.patient_care_visit_entries e where e.user_id=p_member and e.visit_id=v.id),'[]'))order by v.created_at desc,v.id),'[]')
 from public.patient_care_visits v where v.user_id=p_member
$$;
create function public._patient_visit_workspace(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b jsonb;
begin
 b:=public._patient_visit_booking(p_member);
 return jsonb_build_object('version','visit-evidence-v1','memberId',p_member,'revision',(select revision from public.patient_clinical_cases where user_id=p_member),
 'bookingContext',b->'context','collectionAvailability',b->>'availability','visits',public._patient_visit_history(p_member));
end$$;
create function public.patient_staff_visit_workspace(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._patient_visit_authorize(p_member,false,false);
 return public._patient_visit_workspace(p_member);
end$$;

create function public.patient_staff_visit_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare p jsonb;m uuid;sub uuid;vid uuid;s public.workspace_staff;r bigint;receipt public.patient_care_visit_command_receipts;
 v public.patient_care_visits;b jsonb;e jsonb;ordinal bigint;eid uuid;ids jsonb:='[]';measurement uuid;sys jsonb;dia jsonb;pulse jsonb;result jsonb;stamp timestamptz;
begin
 perform set_config('lock_timeout','1500ms',true);
 p:=public._patient_visit_command(p_command);
 if p is null then return jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('path','','message','Check the visit command and factual entries')));end if;
 m:=(p->>'id')::uuid;sub:=(p->>'submissionId')::uuid;vid:=(p->>'visitId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('patient-visit-command:'||m::text||':'||sub::text,0));
 s:=public._patient_visit_authorize(m,true,true);
 select * into receipt from public.patient_care_visit_command_receipts where user_id=m and submission_id=sub;
 if found then
  if receipt.actor_id is distinct from s.user_id or receipt.command is distinct from p then return jsonb_build_object('status','stale');end if;
  if receipt.state='retired'then return jsonb_build_object('status','stale');end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 select revision into r from public.patient_clinical_cases where user_id=m;
 if r is distinct from(p->>'revision')::numeric::bigint then return jsonb_build_object('status','stale');end if;
 if p->>'op'='open-visit'then
  if exists(select 1 from public.patient_care_visits where id=vid)then return jsonb_build_object('status','stale');end if;
  if p->'booking'<>'null'::jsonb then
   b:=public._patient_visit_booking(m,(p#>>'{booking,appointmentId}')::uuid);
   if b->>'availability'is distinct from 'available'or (b#>>'{context,acceptedRevision}')::numeric is distinct from (p#>>'{booking,acceptedRevision}')::numeric then return jsonb_build_object('status','stale');end if;
  end if;
  insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)
   values(vid,m,s.user_id,s.display_name,s.role,s.clinic_id,(p#>>'{booking,appointmentId}')::uuid,(p#>>'{booking,acceptedRevision}')::numeric::bigint,b->'context');
 else
  select * into v from public.patient_care_visits where id=vid and user_id=m;
  if not found then return jsonb_build_object('status','stale');end if;
  if exists(select 1 from jsonb_array_elements(p->'entries')x where x->>'kind'='collection')then
   if v.booking_context is null then return jsonb_build_object('status','stale');end if;
   b:=public._patient_visit_booking(m,v.appointment_id);
   if b->>'availability'is distinct from 'available'or b->'context'is distinct from v.booking_context then return jsonb_build_object('status','stale');end if;
   for e in select value from jsonb_array_elements(p->'entries')where value->>'kind'='collection'loop
    if(e->>'appointmentId')::uuid<>v.appointment_id or(e->>'acceptedRevision')::numeric::bigint<>v.accepted_revision
     or not exists(select 1 from jsonb_array_elements(v.booking_context->'tests')t where t->>'id'=e->>'testId')then return jsonb_build_object('status','stale');end if;
   end loop;
  end if;
  select value into sys from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='systolic'and value->>'state'='known';
  select value into dia from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='diastolic'and value->>'state'='known';
  if sys is not null and dia is not null then
   stamp:=public._patient_visit_instant(sys->>'observedAt');
   select value into pulse from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='pulse'and value->>'state'='known'and public._patient_visit_instant(value->>'observedAt')=stamp;
   insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)
    values(m,sub,(sys->>'value')::numeric::integer,(dia->>'value')::numeric::integer,(pulse->>'value')::numeric::integer,stamp)returning id into measurement;
  end if;
  for e,ordinal in select value,ordinality from jsonb_array_elements(p->'entries')with ordinality loop
   insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id,measurement_id)
    values(m,vid,sub,ordinal,e,e->>'observedAt',public._patient_visit_instant(e->>'observedAt'),s.user_id,s.display_name,s.role,s.clinic_id,
    case when measurement is not null and e->>'kind'='observation'and e->>'state'='known'and e->>'field'in('systolic','diastolic','pulse')and public._patient_visit_instant(e->>'observedAt')=stamp then measurement end)returning id into eid;
   ids:=ids||to_jsonb(eid);
  end loop;
 end if;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(m,r,'care-evidence',s.user_id,jsonb_build_object('visitId',vid,'submissionId',sub,'operation',p->>'op','entryIds',ids,'measurementId',measurement));
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'revision',r,'entryIds',ids,'replayed',false);
 insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state,result)
 values(m,sub,s.user_id,(auth.jwt()->>'session_id')::uuid,p,'committed',result);
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

create function public.patient_staff_visit_refresh(p_member uuid,p_visit uuid,p_command jsonb default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare p jsonb;s public.workspace_staff;r public.patient_care_visit_command_receipts;answer jsonb;sub uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 if p_command is not null then
  p:=public._patient_visit_command(p_command);
  if p is null or(p->>'id')::uuid is distinct from p_member or(p->>'visitId')::uuid is distinct from p_visit then return jsonb_build_object('status','unavailable');end if;
  sub:=(p->>'submissionId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('patient-visit-command:'||p_member::text||':'||sub::text,0));
 end if;
 -- Only the assigned nurse can recover/retire a nurse command. NULL is a read.
 s:=public._patient_visit_authorize(p_member,p is not null,p is not null);
 if p is not null then
  select * into r from public.patient_care_visit_command_receipts where user_id=p_member and submission_id=sub;
  if found and(r.actor_id is distinct from s.user_id or r.command is distinct from p)then answer:=jsonb_build_object('status','unknown','submissionId',sub);
  elsif found and r.state='committed'then answer:=(r.result-'replayed')||jsonb_build_object('status','committed');
  else
   if not found then
    insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state)
     values(p_member,sub,s.user_id,(auth.jwt()->>'session_id')::uuid,p,'retired');
   end if;
   answer:=jsonb_build_object('status','not-recorded','submissionId',sub,'serialized',true);
  end if;
 end if;
 return jsonb_build_object('status','loaded','data',public._patient_visit_workspace(p_member),'receipt',answer);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- Readers freeze all clinical sources; writers deliberately do not call this.
create or replace function public.lock_patient_clinical_sources(p_user_id uuid)returns void
language plpgsql security definer set search_path=''as $$
begin
 perform 1 from auth.users where id=p_user_id and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 perform 1 from public.patient_message_preferences where user_id=p_user_id for share nowait;
 lock table public.profiles,public.patient_consents,public.patient_assessments,public.patient_measurements,public.patient_reports,public.workspace_staff,public.workspace_clinics,
 public.patient_care_visits,public.patient_care_visit_entries in share mode nowait;
end$$;

-- Preserve32144's present-only PDF artifact projection and historical empty tokens.
create or replace function public.patient_clinical_evidence(p_user_id uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 with evidence as(select jsonb_build_object(
 'profile',(select jsonb_build_object('name',display_name,'birthDate',birth_date,'biologicalSex',biological_sex)from public.profiles where id=p_user_id),
 'consent',(select to_jsonb(c)from public.patient_consents c where user_id=p_user_id and version='patient-pilot-v1'),
 'assessment',(select to_jsonb(a)-'user_id'from public.patient_assessments a where user_id=p_user_id),
 'measurements',coalesce((select jsonb_agg(to_jsonb(m)-'user_id'order by m.measured_at desc,m.id)from public.patient_measurements m where user_id=p_user_id),'[]'),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'reviewed',r.reviewed,'confirmedAt',r.confirmed_at)
  ||case when r.pdf_artifact is null then '{}'::jsonb else jsonb_build_object('pdfArtifact',r.pdf_artifact)end order by r.id)
  from public.patient_reports r where user_id=p_user_id and deleted_at is null and state<>'deleted'),'[]')
 )||case when exists(select 1 from public.patient_care_visits where user_id=p_user_id)then jsonb_build_object('visits',public._patient_visit_history(p_user_id))else '{}'::jsonb end body)
 select jsonb_build_object('token',md5(body::text),'data',body)from evidence
$$;
revoke all on function public._patient_visit_immutable(),public._patient_visit_instant(text),public._patient_visit_command(jsonb),
 public._patient_visit_authorize(uuid,boolean,boolean),public._patient_visit_booking(uuid,uuid),public._patient_visit_history(uuid),public._patient_visit_workspace(uuid),
 public.patient_staff_visit_command(jsonb),public.patient_staff_visit_refresh(uuid,uuid,jsonb),public.patient_staff_visit_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_staff_visit_command(jsonb),public.patient_staff_visit_refresh(uuid,uuid,jsonb),public.patient_staff_visit_workspace(uuid)to authenticated;
