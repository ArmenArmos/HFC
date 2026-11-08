-- Gohar QA 151 and 155 (29 Oct): nurse visits.
--
-- QA 151: the Visits list showed a visit that opened as "Page not found". The list kept visits of
-- any assigned member the nurse has care access to; the detail (and every write, through
-- _patient_visit_authorize) also requires the member's phone to be confirmed, the identity rule the
-- whole clinical path uses. Prod-as-staging: the listed visit's member had no confirmed phone. The
-- detail rule is the correct one, so the nurse list now applies it too and never lists a visit the
-- nurse cannot open. Care access itself is unchanged (staff_care_access: the assigned nurse, and the
-- member's active doctor in the nurse's clinic). The admin list is unchanged.
--
-- QA 155: before the visit day the step buttons were locked, but item ticks ("Sample taken", "Not
-- taken", readings, device and checklist ticks, and their comments) were not. nurse_visit_mark now
-- refuses them with 'too-early' until the visit's day in Yerevan time, the same rule as the
-- 'started' and 'samples-collected' steps and nurse_visit_complete. Confirming the visit with the
-- member stays allowed before the day. A completed visit still answers 'completed', and a replay of
-- an already saved mark still answers 'saved'.

create or replace function public.nurse_visit_list()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare actor uuid;admin boolean:=public._nurse_visit_is_admin();today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
begin
 if admin then actor:=null;else actor:=(public._nurse_visit_nurse()).user_id;end if;
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false,'visits','[]'::jsonb);end if;
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'today',today,'role',case when admin then 'admin'else 'nurse'end,'visits',coalesce((
  select jsonb_agg(v||(select jsonb_build_object('samplesPlanned',c->'samplesPlanned','samplesTaken',c->'samplesTaken','openItems',jsonb_array_length(c->'openItems'))
   from public._nurse_visit_counts(public._nurse_visit_items_marked(v->>'source',(v->>'id')::uuid,false))c)
   ||jsonb_build_object('steps',public._nurse_visit_events(v->>'source',(v->>'id')::uuid,true),
    'nurseName',(select ws.display_name from public.patient_clinical_cases pc join public.workspace_staff ws on ws.user_id=pc.assigned_nurse_id where pc.user_id=(v->>'memberId')::uuid))
   order by v->>'startsAt',v->>'id')
  from(
   select public._nurse_visit_row('home-request',r.id)v from public.patient_test_requests r join public.patient_clinical_cases pc on pc.user_id=r.user_id
    where(admin or pc.assigned_nurse_id=actor)and r.status in('confirmed','completed')and r.current_arrangement#>>'{terms,mode}'='home'
   union all
   select public._nurse_visit_row('appointment',a.id)from public.booking_appointments a join public.patient_clinical_cases pc on pc.user_id=a.member_id
    where(admin or pc.assigned_nurse_id=actor)and a.status='confirmed'and a.current_arrangement is not null and a.current_reservation_id is not null
  )x
  -- QA 151: the same member rule as the detail (_patient_visit_authorize), so every listed visit opens.
  where v is not null and(admin or(public.staff_care_access((v->>'memberId')::uuid,actor,true)
   and exists(select 1 from auth.users u where u.id=(v->>'memberId')::uuid and u.phone is not null and u.phone_confirmed_at is not null)))
   and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date between today-14 and today+60
   and(v->'completion'='null'::jsonb or((v#>>'{completion,completedAt}')::timestamptz at time zone 'Asia/Yerevan')::date>=today-7)),'[]'::jsonb));
end$$;

create or replace function public.nurse_visit_mark(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values','startsAt','checklistVersion']<>'{}'
  or jsonb_typeof(p_command->'done')is distinct from 'boolean'or jsonb_typeof(p_command->'item')is distinct from 'string'
  or jsonb_typeof(p_command->'note')not in('null','string')or jsonb_typeof(p_command->'values')not in('null','object')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';item:=p_command->>'item';done:=(p_command->>'done')::boolean;
 note:=nullif(btrim(p_command->>'note'),'');vals:=nullif(p_command->'values','null'::jsonb);
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or(note is not null and length(note)>1000)then return bad;end if;
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
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_marks where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.item<>item or prior.done<>done or prior.note is distinct from note or prior.vals is distinct from vals or prior.actor_id<>s.user_id then
   return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','markId',prior.id,'submissionId',sub,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
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
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name)
  values(m,src,sid,item,done,note,vals,cv,sub,s.user_id,s.display_name)returning id into mid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','mark','source',src,'sourceId',sid,'item',item,'done',done,'commented',note is not null,'markId',mid,'submissionId',sub));
 return jsonb_build_object('status','saved','markId',mid,'submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
