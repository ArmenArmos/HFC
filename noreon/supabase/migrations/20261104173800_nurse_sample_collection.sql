-- Append-only collection outcomes share the existing sample checklist and audit history.
-- Pending is the absence of a final outcome for the current arrangement.
alter table public.nurse_visit_marks add column collection_status text
 check(collection_status in('collected','not-collected','issue')),
 add constraint nurse_visit_marks_collection_status check(collection_status is null or
  (item like 'sample:%' and done=(collection_status='collected') and vals is null and
   (collection_status='collected' or (note is not null and length(btrim(note)) between 1 and 300))));

-- One receipt covers either one correction or all currently Pending samples atomically.
create table public.nurse_visit_collection_receipts(
 member_id uuid not null references public.patient_clinical_cases(user_id),
 submission_id uuid not null, source text not null check(source in('home-request','appointment')),
 source_id uuid not null, arrangement timestamptz not null,
 command jsonb not null, result jsonb not null,
 actor_id uuid not null references auth.users(id), actor_name text not null,
 session_id uuid, channel text not null check(channel in('web','telegram')),
 binding_id uuid references public.telegram_auth_bindings(id), binding_generation bigint,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(member_id,submission_id),
 check((channel='web' and session_id is not null and binding_id is null and binding_generation is null)or
 (channel='telegram' and session_id is null and binding_id is not null and binding_generation is not null and binding_generation>0))
);
alter table public.nurse_visit_collection_receipts enable row level security;
revoke all on public.nurse_visit_collection_receipts from public,anon,authenticated,service_role;
create trigger nurse_visit_collection_receipts_immutable before update or delete on public.nurse_visit_collection_receipts
 for each row execute function public._patient_visit_immutable();

-- Read-only source context. Cancellation clears live arrangements, but its immutable
-- request receipts / appointment versions preserve the last arrangement and its tests.
-- These helpers never change portal state or make a cancelled visit list-eligible.
create function public._nurse_visit_context(p_source text,p_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare r public.patient_test_requests;a public.booking_appointments;ctx jsonb;tests jsonb;history jsonb;
 v public.booking_appointment_versions;
begin
 if p_source='home-request'then
  select * into r from public.patient_test_requests where id=p_id;
  if not found then return null;end if;
  ctx:=r.current_arrangement;tests:=r.requirements;
  if r.status='cancelled'and ctx is null then
   select e.result into history from public.patient_test_request_events e where e.request_id=p_id
    and jsonb_typeof(e.result->'currentArrangement')='object'
    and e.result#>>'{currentArrangement,terms,mode}'='home'
    order by e.revision desc,e.created_at desc,e.command_id desc limit 1;
   ctx:=history->'currentArrangement';tests:=coalesce(history->'requirements',tests);
  end if;
  if ctx is null or ctx='null'::jsonb then return null;end if;
 elsif p_source='appointment'then
  select * into a from public.booking_appointments where id=p_id;
  if not found then return null;end if;
  ctx:=a.current_arrangement;
  select program->'items'into tests from public.booking_program_seals where id=a.program_id;
  if a.status='cancelled'and ctx is null then
   -- Cancellation's version carries the arrangement and the exact program it removed.
   select z.* into v from public.booking_appointment_versions z
    join public.booking_scheduling_notices n on n.id=z.notice_id
    where z.appointment_id=p_id and n.purpose='cancellation'and n.state='accepted'
    and jsonb_typeof(z.previous_arrangement)='object'order by z.revision desc limit 1;
   if found then
    ctx:=v.previous_arrangement;
    tests:=coalesce(v.previous_program,(select program->'items'from public.booking_program_seals where id=v.program_id));
   else
    -- Old cancellations retain their accepted proposal even without a cancellation version.
    ctx:=a.proposed_arrangement;
    select * into v from public.booking_appointment_versions where appointment_id=p_id
     and proposed_arrangement=ctx order by revision desc limit 1;
    if found then select program->'items'into tests from public.booking_program_seals where id=v.program_id;end if;
   end if;
  end if;
  if ctx is null or ctx='null'::jsonb then return null;end if;
 else return null;end if;
 return jsonb_build_object('arrangement',ctx,'tests',coalesce(tests,'[]'::jsonb));
end$$;
revoke all on function public._nurse_visit_context(text,uuid)from public,anon,authenticated,service_role;

create or replace function public._nurse_visit_row(p_source text,p_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare r public.patient_test_requests;a public.booking_appointments;arr jsonb;ctx jsonb;c public.nurse_visit_completions;m uuid;
begin
 ctx:=public._nurse_visit_context(p_source,p_id)->'arrangement';
 if ctx is null then return null;end if;
 if p_source='home-request'then
  select * into r from public.patient_test_requests where id=p_id;
  if not found or r.status not in('confirmed','completed','cancelled')or ctx#>>'{terms,mode}'is distinct from 'home'then return null;end if;
  m:=r.user_id;arr:=jsonb_build_object('startsAt',to_jsonb((ctx#>>'{terms,startsAt}')::timestamptz),'endsAt',to_jsonb((ctx#>>'{terms,endsAt}')::timestamptz),
   'mode','home','location',ctx#>>'{terms,location}','bookingStatus',r.status,'arrangementToken',r.revision::text);
 elsif p_source='appointment'then
  select * into a from public.booking_appointments where id=p_id;
  if not found or a.status not in('confirmed','cancelled')or(a.status='confirmed'and a.current_reservation_id is null)then return null;end if;
  m:=a.member_id;arr:=jsonb_build_object('startsAt',to_jsonb((ctx->>'startsAt')::timestamptz),'endsAt',to_jsonb((ctx->>'endsAt')::timestamptz),
   'mode',ctx->>'mode','location',ctx->>'location',
   -- Cancelled rows are read-only and retain the proposed reservation for historical display.
   'arrangementToken',coalesce(a.current_reservation_id,a.proposed_reservation_id)::text,
   'clinic',(select k.name from public.workspace_clinics k where k.id=(ctx->>'clinicId')::uuid),
   'bookingStatus',case when a.status='cancelled'then 'cancelled'when public._booking_visit_attended(a.current_reservation_id)then 'attended'else 'confirmed'end);
 else return null;end if;
 select * into c from public.nurse_visit_completions where source=p_source and source_id=p_id;
 return arr||jsonb_build_object('source',p_source,'id',p_id,'memberId',m,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=m),'Member'),
  'completion',case when c.id is null then null else jsonb_build_object('completedAt',c.completed_at,'nurseName',c.actor_name,'summary',c.summary)end);
end$$;

-- Reuse that same recovered arrangement for both test coverage and mark arrangement keys.
-- _nurse_visit_arrangement already reads _nurse_visit_row; no second reconstruction exists.
create or replace function public._nurse_visit_tests(p_source text,p_id uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord),'[]'::jsonb)
 from public._nurse_visit_context(p_source,p_id)c,
 -- Home requirements are visible before the member accepts an arrangement too.
 lateral jsonb_array_elements(coalesce(c->'tests',
  (select r.requirements from public.patient_test_requests r where p_source='home-request'and r.id=p_id)))with ordinality as x(i,ord)
 where p_source='home-request'or coalesce(c#>'{arrangement,coveredTestIds}','[]'::jsonb)?(i->>'id')
$$;

create or replace function public._nurse_visit_items_marked(p_source text,p_id uuid,p_values boolean default true)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(i||jsonb_build_object('mark',(
  select jsonb_build_object('done',k.done,'note',k.note,'values',case when p_values then k.vals end,'recordedAt',k.recorded_at,'nurseName',k.actor_name)
   ||case when i->>'kind'='sample' then jsonb_build_object('collectionStatus',coalesce(k.collection_status,
    case when k.done then 'collected' when nullif(btrim(k.note),'')is not null then 'not-collected' end))else '{}'::jsonb end
  from public.nurse_visit_marks k where k.source=p_source and k.source_id=p_id and k.item=i->>'key'
   and k.arrangement=public._nurse_visit_arrangement(p_source,p_id)and k.checklist_version is not distinct from i->>'version'
  order by k.recorded_at desc,k.id desc limit 1))order by ord),'[]')
 from jsonb_array_elements(public._nurse_visit_items(p_source,p_id))with ordinality as x(i,ord)
$$;

create function public._nurse_visit_collect_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;expected bigint;s public.workspace_staff;v jsonb;items jsonb;i jsonb;
 st text;reason text;canonical jsonb;r bigint;mid uuid;receipt public.nurse_visit_collection_receipts;all_pending boolean;arrangement_token text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object' or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','expectedRevision','arrangementToken'])
  or p_command-array['version','memberId','source','sourceId','submissionId','expectedRevision','arrangementToken','all','testId','status','reason']<>'{}'
  or jsonb_typeof(p_command->'arrangementToken')is distinct from 'string'
  or length(p_command->>'arrangementToken')not between 1 and 100
  or jsonb_typeof(p_command->'expectedRevision')is distinct from 'number'
  or (p_command->>'expectedRevision')!~'^[0-9]+$' then return bad;end if;
 all_pending:=p_command?'all';
 if all_pending then
  if p_command->'all'is distinct from 'true'::jsonb or p_command?|array['testId','status','reason'] then return bad;end if;
 else
  if not(p_command?&array['testId','status','reason']) or jsonb_typeof(p_command->'testId')is distinct from 'string'
   or coalesce(p_command->>'status','')not in('collected','not-collected','issue')
   or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
  st:=p_command->>'status';reason:=nullif(btrim(p_command->>'reason'),'');
  if (st in('not-collected','issue')and(reason is null or length(reason)>300))
   or(st='collected'and reason is not null)then return bad;end if;
 end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  expected:=(p_command->>'expectedRevision')::bigint;
 exception when invalid_text_representation or numeric_value_out_of_range then return bad;end;
 src:=p_command->>'source';
 if coalesce(src,'')not in('home-request','appointment')or m is null or sid is null or sub is null then return bad;end if;
 canonical:=case when all_pending then p_command else jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb))end;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,true);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into receipt from public.nurse_visit_collection_receipts where member_id=m and submission_id=sub;
 if found then
  if receipt.command is distinct from canonical or receipt.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 -- Do not reuse a submission from the older single-mark path.
 if exists(select 1 from public.nurse_visit_marks where member_id=m and submission_id=sub)then return jsonb_build_object('status','stale');end if;
 -- Match the source locks used by home-request changes and booking commands.
 -- Portal confirmation also locks the appointment row, without the case lock above.
 -- Keep this row locked from the token read through marks, steps and the receipt.
 if src='home-request'then
  select revision::text into arrangement_token from public.patient_test_requests where id=sid and user_id=m for update nowait;
 else
  select current_reservation_id::text into arrangement_token from public.booking_appointments where id=sid and member_id=m for update nowait;
 end if;
 if not found then return jsonb_build_object('status','unavailable');end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid is distinct from m then return jsonb_build_object('status','unavailable');end if;
 if v->>'bookingStatus'='cancelled'then return jsonb_build_object('status','cancelled');end if;
 -- Starts still key historical marks and steps, but do not identify arrangement changes.
 -- A stored receipt returned earlier, so exact replay remains safe after replacement.
 if p_command->>'arrangementToken'is distinct from arrangement_token then return jsonb_build_object('status','stale');end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 if expected is distinct from(select revision from public.patient_clinical_cases where user_id=m)then return jsonb_build_object('status','stale');end if;
 items:=public._nurse_visit_items_marked(src,sid);
 if not exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'
  and(all_pending or x->>'testId'=p_command->>'testId'))then return jsonb_build_object('status','stale');end if;
 for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
  and case when all_pending then x#>>'{mark,collectionStatus}'is null else x->>'testId'=p_command->>'testId'end loop
  insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name,collection_status)
   values(m,src,sid,i->>'key',all_pending or st='collected',case when all_pending then null else reason end,null,null,
    gen_random_uuid(),s.user_id,s.display_name,case when all_pending then 'collected'else st end)returning id into mid;
  -- Fixed text and internal IDs only: reasons remain solely in the protected immutable mark.
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','collection','source',src,'sourceId',sid,
    'item',i->>'key','collectionStatus',case when all_pending then 'collected'else st end,'markId',mid,'submissionId',sub));
 end loop;
 items:=public._nurse_visit_items_marked(src,sid);
 if not exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'is null)
  and exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'='collected')
  and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 insert into public.nurse_visit_collection_receipts(member_id,submission_id,source,source_id,arrangement,command,result,actor_id,actor_name,session_id,channel,binding_id,binding_generation)
  values(m,sub,src,sid,(v->>'startsAt')::timestamptz,canonical,jsonb_build_object('status','saved','submissionId',sub,'replayed',false),
   s.user_id,s.display_name,case when p_binding is null then(auth.jwt()->>'session_id')::uuid end,
   case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 return jsonb_build_object('status','saved','submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_collect_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;
create function public.nurse_visit_collect(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 return public._nurse_visit_collect_as(auth.uid(),null,null,p_command);
end$$;
revoke all on function public.nurse_visit_collect(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.nurse_visit_collect(jsonb)to authenticated;

create or replace function public._nurse_visit_mark_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values','startsAt','checklistVersion','expectUnmarked']<>'{}'
  or(p_command?'expectUnmarked'and jsonb_typeof(p_command->'expectUnmarked')is distinct from 'boolean')
  or jsonb_typeof(p_command->'done')is distinct from 'boolean'or jsonb_typeof(p_command->'item')is distinct from 'string'
  or jsonb_typeof(p_command->'note')not in('null','string')or jsonb_typeof(p_command->'values')not in('null','object')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';item:=p_command->>'item';done:=(p_command->>'done')::boolean;
 note:=nullif(btrim(p_command->>'note'),'');vals:=nullif(p_command->'values','null'::jsonb);
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or(note is not null and length(note)>1000)then return bad;end if;
 if item like 'sample:%'and not done and(note is null or length(note)>300)then return bad;end if;
 if item='measure:bp'and done then
  if vals is null or vals-array['systolic','diastolic','pulse']<>'{}'or not(vals?&array['systolic','diastolic','pulse'])
   or not public._nurse_visit_number(vals->'systolic',60,300,true)or not public._nurse_visit_number(vals->'diastolic',30,200,true)
   or(vals->>'systolic')::numeric<=(vals->>'diastolic')::numeric
   or(vals->'pulse'<>'null'::jsonb and not public._nurse_visit_number(vals->'pulse',20,250,true))then return bad;end if;
 elsif item in('measure:weight','measure:waist')and done then
  if vals is null or vals-array['value']<>'{}'or not public._nurse_visit_number(vals->'value',case when item='measure:weight'then 20 else 30 end,case when item='measure:weight'then 400 else 250 end,false)then return bad;end if;
 elsif vals is not null then return bad;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.nurse_visit_collection_receipts where member_id=m and submission_id=sub)then return jsonb_build_object('status','stale');end if;
 select * into prior from public.nurse_visit_marks where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.item<>item or prior.done<>done or prior.note is distinct from note or prior.vals is distinct from vals or prior.actor_id<>s.user_id then
   return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','markId',prior.id,'submissionId',sub,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if v->>'bookingStatus'='cancelled'then return jsonb_build_object('status','unavailable');end if;
 if p_command?'startsAt'then
  begin
   if jsonb_typeof(p_command->'startsAt')is distinct from 'string'then return bad;end if;
   if(p_command->>'startsAt')::timestamptz is distinct from(v->>'startsAt')::timestamptz then return jsonb_build_object('status','stale');end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return bad;end;
 end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 -- QA 155: items are recorded on or after the visit day (Yerevan), like the arrival step.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 select i->>'version'into cv from jsonb_array_elements(public._nurse_visit_items(src,sid))i where i->>'key'=item;
 if not found then return jsonb_build_object('status','stale');end if;
 if item like 'check:%'and p_command?'checklistVersion'and(p_command->>'checklistVersion')is distinct from cv then return jsonb_build_object('status','stale');end if;
 -- The chat's confirmed reading must never replace a measurement marked since its card was prepared (another card, tab or the visit
 -- form). The visit lock above makes this check and the insert atomic against every other mark and step on this visit. A replay of the
 -- same submission returned earlier, so a lost answer is still safe to repeat.
 if coalesce((p_command->>'expectUnmarked')::boolean,false)and done and exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid,false))i where i->>'key'=item and i#>>'{mark,done}'='true')then
  return jsonb_build_object('status','already-marked');end if;
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name,collection_status)
  values(m,src,sid,item,done,note,vals,cv,sub,s.user_id,s.display_name,case when item like 'sample:%'then case when done then 'collected'else 'not-collected'end end)returning id into mid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','mark','source',src,'sourceId',sid,'item',item,'done',done,'commented',note is not null,'markId',mid,'submissionId',sub));
 return jsonb_build_object('status','saved','markId',mid,'submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_mark_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

-- Original delegate retained with an additional Pending collection gate.
create or replace function public._nurse_visit_step_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;st text;s public.workspace_staff;v jsonb;prior public.nurse_visit_events;eid uuid;vid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','step'])or p_command-array['version','memberId','source','sourceId','submissionId','step']<>'{}'
  or coalesce(p_command->>'step','')not in('confirmed','started','samples-collected','samples-at-lab')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';st:=p_command->>'step';
 if src not in('home-request','appointment')or m is null or sid is null or sub is null then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_events where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.step<>st or prior.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','eventId',prior.id,'submissionId',sub,'occurredAt',prior.occurred_at,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if v->>'bookingStatus'='cancelled'then return jsonb_build_object('status','unavailable');end if;
 select * into prior from public.nurse_visit_events where source=src and source_id=sid and step=st and arrangement=(v->>'startsAt')::timestamptz;
 if found then return jsonb_build_object('status','already-recorded','occurredAt',prior.occurred_at);end if;
 if v->'completion'<>'null'::jsonb and st<>'samples-at-lab'then return jsonb_build_object('status','completed');end if;
 if st in('started','samples-collected')and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 if st='samples-collected'and exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid))i where i->>'kind'='sample'and i#>>'{mark,collectionStatus}'is null)then return jsonb_build_object('status','pending-samples');end if;
 if st='samples-collected'and not exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid))i where i->>'kind'='sample'and i#>>'{mark,done}'='true')then
  return jsonb_build_object('status','no-samples');end if;
 if st='samples-at-lab'and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  return jsonb_build_object('status','no-samples');end if;
 -- A completed slot-booking visit hands over the current samples it recorded; none is refused (review F1).
 select visit_id into vid from public.nurse_visit_completions where source=src and source_id=sid;
 if st='samples-at-lab'and src='appointment'and vid is not null and not exists(select 1 from public.patient_care_visit_entries x
  where x.user_id=m and x.visit_id=vid and x.payload->>'kind'='collection'and x.payload->>'outcome'='collected'
  and public._patient_lab_current_collection(x))then
  -- Only current samples count: a later "not collected" correction supersedes an earlier entry (Codex F1 re-check).
  return jsonb_build_object('status','no-lab-entries');end if;
 eid:=public._nurse_visit_record_step(m,src,sid,st,sub,s);
 if st='samples-at-lab'and vid is not null then perform public._nurse_visit_sync_lab_as(p_actor,p_binding,p_generation,m,vid,clock_timestamp());end if;
 return jsonb_build_object('status','saved','eventId',eid,'submissionId',sub,'occurredAt',(select occurred_at from public.nurse_visit_events where id=eid),'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_step_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

-- Original delegate retained with an additional Pending collection gate.
create or replace function public._nurse_visit_complete_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;vid uuid;oid uuid;aid uuid;reason text;s public.workspace_staff;v jsonb;items jsonb;counts jsonb;
 prior public.nurse_visit_completions;rq public.patient_test_requests;b jsonb;booking jsonb;res jsonb;entries jsonb:='[]';i jsonb;bp public.nurse_visit_marks;k public.nurse_visit_marks;
 stamp text:=public._nurse_visit_iso(clock_timestamp());result jsonb;r bigint;canonical jsonb;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason'])
  or p_command-array['version','memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason']<>'{}'
  or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  vid:=(p_command->>'visitId')::uuid;oid:=(p_command->>'openSubmissionId')::uuid;aid:=(p_command->>'appendSubmissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';reason:=nullif(btrim(p_command->>'reason'),'');
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or vid is null or oid is null or aid is null
  or oid=aid or(reason is not null and length(reason)not between 3 and 1000)then return bad;end if;
 canonical:=jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb));
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_completions where source=src and source_id=sid;
 if found then
  if prior.submission_id=sub and prior.command=canonical and prior.actor_id=s.user_id then return prior.result||jsonb_build_object('replayed',true);end if;
  return jsonb_build_object('status','completed');
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if v->>'bookingStatus'='cancelled'then return jsonb_build_object('status','unavailable');end if;
 -- A visit is completed on or after its arranged day, never ahead of it.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 items:=public._nurse_visit_items_marked(src,sid);counts:=public._nurse_visit_counts(items);
 if exists(select 1 from jsonb_array_elements(items)it where it->>'kind'='sample'and it#>>'{mark,collectionStatus}'is null)then return jsonb_build_object('status','pending-samples');end if;
 if jsonb_array_length(counts->'openItems')>0 and reason is null then return jsonb_build_object('status','reason-required','openItems',counts->'openItems');end if;
 -- 1. The home request closes first, so the auto-close trigger on the visit insert finds nothing to do.
 if src='home-request'then
  select * into rq from public.patient_test_requests where id=sid and user_id=m for update nowait;
  if rq.status='confirmed'then
   update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=sid;
   insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
    values(sid,sub,s.user_id,rq.revision+1,'completed-by-visit',jsonb_build_object('visitId',vid,'nurseVisit',true),jsonb_build_object('status','completed'));
  end if;
 else
  -- A slot booking needs its current booking context, or its samples cannot be recorded against
  -- the booking. The nurse is told to check the booking instead of completing silently (review F1).
  b:=public._patient_visit_booking(m,sid);
  if b->>'availability'is distinct from 'available'then return jsonb_build_object('status','booking-stale');end if;
  booking:=jsonb_build_object('appointmentId',sid,'acceptedRevision',(b#>>'{context,acceptedRevision}')::numeric);
 end if;
 -- 2. The visit record, through the existing nurse visit command.
 res:=public._patient_staff_visit_command_as(p_actor,p_binding,p_generation,jsonb_build_object('version','visit-evidence-v1','op','open-visit','id',m,'visitId',vid,'submissionId',oid,
  'revision',(select revision from public.patient_clinical_cases where user_id=m),'booking',coalesce(booking,'null'::jsonb)));
 if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit open was not saved';end if;
 select x.* into bp from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item='measure:bp'and x.arrangement=(v->>'startsAt')::timestamptz order by x.recorded_at desc,x.id desc limit 1;
 if bp.done then
  entries:=entries||jsonb_build_array(
   jsonb_build_object('kind','observation','field','systolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'systolic')::int,'unit','mmHg'),
   jsonb_build_object('kind','observation','field','diastolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'diastolic')::int,'unit','mmHg'))
   ||case when bp.vals->'pulse'<>'null'::jsonb then jsonb_build_array(jsonb_build_object('kind','observation','field','pulse','observedAt',public._nurse_visit_iso(bp.recorded_at),
    'state','known','value',(bp.vals->>'pulse')::int,'unit','beats/min'))else '[]'::jsonb end;
 end if;
 for k in select distinct on(x.item)x.* from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item in('measure:weight','measure:waist')and x.arrangement=(v->>'startsAt')::timestamptz order by x.item,x.recorded_at desc,x.id desc loop
  if k.done then entries:=entries||jsonb_build_array(jsonb_build_object('kind','observation','field',substr(k.item,9),'observedAt',public._nurse_visit_iso(k.recorded_at),
   'state','known','value',(k.vals->'value'),'unit',case when k.item='measure:weight'then 'kg'else 'cm'end));end if;
 end loop;
 if booking is not null then
  for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
   and exists(select 1 from jsonb_array_elements(b#>'{context,tests}')t where t->>'id'=x->>'testId')loop
   entries:=entries||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','collection','observedAt',coalesce(public._nurse_visit_iso((i#>>'{mark,recordedAt}')::timestamptz),stamp),
    'appointmentId',sid,'acceptedRevision',booking->'acceptedRevision','testId',i->>'testId',
    'outcome',case when i#>>'{mark,done}'='true'then 'collected'when i->'mark'is not null and i->'mark'<>'null'::jsonb then 'not-collected'else 'unknown'end,
    'reason',case when i#>>'{mark,done}'='true'then null else coalesce(i#>>'{mark,note}',reason)end)));
  end loop;
 end if;
 if reason is not null then entries:=entries||jsonb_build_array(jsonb_build_object('kind','note','observedAt',stamp,'text',reason));end if;
 if jsonb_array_length(entries)>0 then
  res:=public._patient_staff_visit_command_as(p_actor,p_binding,p_generation,jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id',m,'visitId',vid,'submissionId',aid,
   'revision',(select revision from public.patient_clinical_cases where user_id=m),'entries',entries));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit evidence was not saved';end if;
 end if;
 -- 3. The completion, which also counts a slot booking as attended (_booking_visit_attended).
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'summary',counts,'replayed',false);
 insert into public.nurse_visit_completions(member_id,source,source_id,visit_id,submission_id,command,reason,summary,result,actor_id,actor_name,session_id,channel,binding_id,binding_generation)
  values(m,src,sid,vid,sub,canonical,reason,counts,result,s.user_id,s.display_name,case when p_binding is null then (auth.jwt()->>'session_id')::uuid end,case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 -- 4. The timeline: samples collected (if taken and not tapped), completed; samples already handed
 -- to the lab get their lab stages now that the collection entries exist.
 if(counts->>'samplesTaken')::int>0 and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 perform public._nurse_visit_record_step(m,src,sid,'completed',sub,s);
 if public._nurse_visit_has_step(src,sid,'samples-at-lab')then
  perform public._nurse_visit_sync_lab_as(p_actor,p_binding,p_generation,m,vid,(select max(occurred_at)from public.nurse_visit_events where source=src and source_id=sid and step='samples-at-lab'));
 end if;
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_complete_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

