-- Section All done adds an optional expectUnanswered precondition to the existing JSON command.
-- Signature, authorization, replay, grants and per-item audit remain unchanged. Existing callers
-- (including expectUnmarked measurements) retain their prior behavior.
create or replace function public._nurse_visit_mark_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values','startsAt','checklistVersion','expectUnmarked','expectUnanswered']<>'{}'
  or(p_command?'expectUnanswered'and jsonb_typeof(p_command->'expectUnanswered')is distinct from 'boolean')
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
 -- All done must preserve ANY saved answer/comment for this arrangement and checklist version.
 -- The same visit lock above serializes the read and insert against all other mark writers.
 if coalesce((p_command->>'expectUnanswered')::boolean,false)and exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid,false))i where i->>'key'=item and i->'mark'<>'null'::jsonb)then
  return jsonb_build_object('status','already-marked');end if;
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
