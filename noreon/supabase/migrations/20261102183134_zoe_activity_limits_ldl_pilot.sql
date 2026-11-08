-- Armen's Tasks 16 and 19 (2 Nov). STAGING: the rules are not signed.
--
-- Task 16. A plan draft may carry `activityLimits`: what the doctor records about activity after a heart attack, stent or stroke.
-- Absent means nothing recorded, so every existing draft and publication stays valid and unchanged. Zoe reads it from the published
-- plan only, never a draft; while it is absent she suggests no increase in exertion.
--
-- Task 19. A haemorrhagic stroke is stored as its own event type. A member with one and no qualifying event (heart attack, ischaemic
-- stroke, TIA) is out of the LDL pilot, decided here: no member card, re-test, response or LDL record for Zoe, even with a therapy or a goal on record.
-- With a qualifying event as well the member stays eligible and the doctor is warned in the app.
--
-- Old app against this schema: no draft holds the key and no event has the type until the new app writes them, and
-- zoe_run_health_context adds `activityLimits` only when it is set, because the old strict plan schema refuses the key.
-- Rollback: the old app's strict schemas refuse a draft with `activityLimits` and an event of the new type. Before rolling the app
-- back, remove the key from unpublished drafts and publications that hold it, and mark haemorrhagic events removed. Nothing else depends on them.

-- 1. The new event type ----------------------------------------------------------------------------------------------
alter table public.ldl_index_events drop constraint ldl_index_events_event_type_check;
alter table public.ldl_index_events add constraint ldl_index_events_event_type_check check(event_type in('acs_mi','ischaemic_stroke','tia','haemorrhagic_stroke','other'));

create or replace function public.doctor_ldl_event_add(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','type','other','on','source','note'];m uuid;sub uuid;d uuid;on_ date;other text;note text;prior public.ldl_index_events;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'or not(p_command?&array['version','memberId','submissionId','type','source'])
  or p_command->>'version'is distinct from 'ldl-goal-v1'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;on_:=public._ldl_date(p_command,'on');
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 d:=public._ldl_doctor_lock(m);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.ldl_index_events where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m then 'replayed' else 'stale' end);end if;
 other:=public._ldl_clean(p_command->>'other',120);note:=public._ldl_clean(p_command->>'note',300);
 if p_command->>'type'not in('acs_mi','ischaemic_stroke','tia','haemorrhagic_stroke','other')or p_command->>'source'not in('document','doctor_entered')
  or((p_command->>'type')='other')<>(other is not null)or length(other)>120 or length(note)>300
  or on_>public._ldl_today()then return jsonb_build_object('status','invalid');end if;
 insert into public.ldl_index_events(member_id,submission_id,event_type,event_other,event_on,source,note,recorded_by)
  values(m,sub,p_command->>'type',other,on_,p_command->>'source',note,d);
 return jsonb_build_object('status','saved');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;
-- 2. Excluded means excluded: the member's read, Zoe's record, re-tests and responses -----------------------------------
create function public._ldl_pilot_excluded(p_member uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.ldl_index_events where member_id=p_member and removed_at is null and event_type='haemorrhagic_stroke')
  and not exists(select 1 from public.ldl_index_events where member_id=p_member and removed_at is null and event_type in('acs_mi','ischaemic_stroke','tia'))
$$;
revoke all on function public._ldl_pilot_excluded(uuid)from public,anon,authenticated,service_role;

create or replace function public._member_ldl_read(uid uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare g public.ldl_goals;r public.ldl_retests;x public.ldl_responses;base jsonb;
begin
 if not public._ldl_goal_enabled()then return jsonb_build_object('version','ldl-member-v1','enabled',false);end if;
 select * into g from public.ldl_goals where member_id=uid order by version desc limit 1;
 if public._ldl_pilot_excluded(uid)or g.id is null and not exists(select 1 from public.ldl_index_events where member_id=uid and removed_at is null)
  and not exists(select 1 from public.ldl_lipid_therapies where member_id=uid and end_reason is distinct from 'entered_in_error')
 then return jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',false);end if;
 base:=jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',true,
  'goal',case when g.id is null then null else public._ldl_goal_json(g,false)end,
  'observations',case when g.id is null then '[]'::jsonb else public._ldl_observations(uid,false)end);
 if not public._ldl_response_enabled()then return base;end if;
 select * into r from public.ldl_retests where member_id=uid and state in('scheduled','requested','fenced')order by created_at desc limit 1;
 select * into x from public.ldl_responses where member_id=uid and closed_at is null order by created_at desc limit 1;
 return base||jsonb_build_object('retest',case when r.id is null then null else public._ldl_retest_json(r,false)end,
  'withDoctor',case when x.id is null then null else jsonb_build_object('since',x.created_at,
   'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=x.doctor_id))end);
end$$;
create or replace function public._ldl_retest_eligible(p_member uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from auth.users u where u.id=p_member and u.phone_confirmed_at is not null)
  and not public._ldl_pilot_excluded(p_member)
  and coalesce((select(c->'data'->'consent')is not null and c->'data'->'consent'<>'null'::jsonb and(c#>>'{data,assessment,urgent_rule}')is null
   from(select public.patient_test_context(p_member)c)x),false)
$$;
create or replace function public.ldl_response_candidates(p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare out jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('version','ldl-response-v1','enabled',false);end if;
 if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(x order by x->>'memberId'),'[]')into out from(
  select jsonb_build_object('memberId',k.user_id,'floorOn',f.floor_on,'observations',o.obs,
   'goal',(select public._ldl_goal_json(g,false)from public.ldl_goals g where g.member_id=k.user_id order by g.version desc limit 1),
   'checked',coalesce((select jsonb_agg(x.observation_key)from public.ldl_responses x where x.member_id=k.user_id),'[]'::jsonb),
   'retestId',(select r.id from public.ldl_retests r where r.member_id=k.user_id and r.state in('scheduled','requested','fenced')),
   'alt',public._ldl_alt_observations(k.user_id),
   'medicines',public._ldl_medicine_facts(k.user_id,28))x
  from public.patient_clinical_cases k
  cross join lateral(select public._ldl_response_floor(k.user_id)floor_on)f
  cross join lateral(select public._ldl_response_observations(k.user_id)obs)o
  where k.assigned_doctor_id is not null and f.floor_on is not null and not public._ldl_pilot_excluded(k.user_id)
   -- Only a value newer than the floor and not older than the newest recorded response: an older one never becomes due
   -- again. A value on that same day comes back to the app, which responds to a higher one and skips the rest.
   and exists(select 1 from jsonb_array_elements(o.obs)e where(e->>'on')::date>f.floor_on
    and(e->>'on')::date>=coalesce((select max(x.observed_on)from public.ldl_responses x where x.member_id=k.user_id),(e->>'on')::date)
    and not exists(select 1 from public.ldl_responses x where x.member_id=k.user_id and x.observation_key=e->>'id')
    and not exists(select 1 from public.ldl_response_skips x where x.member_id=k.user_id and x.observation_key=e->>'id'))
  order by k.user_id limit p_limit)q;
 return jsonb_build_object('version','ldl-response-v1','enabled',true,'today',public._ldl_today(),'members',out);
end$$;
create or replace function public.ldl_response_record(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;k public.patient_clinical_cases;on_ date;x public.ldl_responses;r public.ldl_retests;floor_on date;goal_v int;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','observationKey','observedOn','status','facts']<>'{}'
  or not(p_command?&array['version','memberId','observationKey','observedOn','status','facts'])or p_command->>'version'is distinct from 'ldl-response-v1'
  or p_command->>'status'not in('at_goal','above_goal','not_assessable')or jsonb_typeof(p_command->'facts')<>'object'
  or coalesce(p_command->>'observationKey','')!~'^(cr|la|mr):[0-9a-f-]{36}$'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;on_:=public._ldl_date(p_command,'observedOn');
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 if not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 perform set_config('lock_timeout','1500ms',true);
 select * into k from public.patient_clinical_cases where user_id=m for update;
 if not found or k.assigned_doctor_id is null or public._ldl_pilot_excluded(m)then return jsonb_build_object('status','not-found');end if;
 select * into x from public.ldl_responses where member_id=m and observation_key=p_command->>'observationKey';
 if found then return jsonb_build_object('status','replayed');end if;
 floor_on:=public._ldl_response_floor(m);
 if on_ is null or floor_on is null or on_<=floor_on or not exists(select 1 from jsonb_array_elements(public._ldl_response_observations(m))e
  where e->>'id'=p_command->>'observationKey'and(e->>'on')::date=on_)then return jsonb_build_object('status','invalid');end if;
 select max(g.version)into goal_v from public.ldl_goals g where g.member_id=m;
 if p_command#>>'{facts,goal,version}'is distinct from goal_v::text then return jsonb_build_object('status','stale');end if;
 select * into r from public.ldl_retests where member_id=m and state in('scheduled','requested','fenced')for update;
 insert into public.ldl_responses(member_id,observation_key,observed_on,status,facts,doctor_id,retest_id)
  values(m,p_command->>'observationKey',on_,p_command->>'status',p_command->'facts',k.assigned_doctor_id,case when r.anchor_on<on_ then r.id end)
  returning * into x;
 if r.id is not null and r.anchor_on<on_ then
  update public.ldl_retests set state='done',response_id=x.id,closed_at=clock_timestamp()where id=r.id;
 end if;
 return jsonb_build_object('status','saved','responseId',x.id);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;
create or replace function public.zoe_run_member_record(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select health_answers_enabled from public.zoe_settings where singleton),false);ldl_on boolean:=public._ldl_goal_enabled();
 today_ date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 cards_on boolean:=coalesce((select zoe_chat_actions_enabled from public.conversation_policy where singleton),false);
 list_on boolean:=coalesce((select enabled from public.member_medicine_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'today',today_,'chatCards',on_ and cards_on,
   'medicineList',on_ and list_on,
   'viaTelegram',coalesce((select cm.source='telegram_member'from public.conversation_messages cm where cm.conversation_id=r.conversation_id and cm.seq=r.message_seq),false),
   'questionnaire',case when on_ then coalesce((select jsonb_build_object('completed',pa.completed_at is not null,'answers',pa.answers)from public.patient_assessments pa where pa.user_id=r.member_id),
    jsonb_build_object('completed',false,'answers','{}'::jsonb))end,
   'nextVisit',case when on_ then(select jsonb_build_object('at',to_char(v.starts_at at time zone 'Asia/Yerevan','YYYY-MM-DD HH24:MI'))from(
     select ap.starts_at from public.patient_care_appointments ap where ap.user_id=r.member_id and ap.status='confirmed'
     union all select(a.current_arrangement->>'startsAt')::timestamptz from public.booking_appointments a where a.member_id=r.member_id and a.status='confirmed'and a.current_reservation_id is not null
    )v where v.starts_at>clock_timestamp()order by v.starts_at limit 1)end,
   'questionnaireFacts',case when on_ then(select nullif(jsonb_object_agg(k,x.answers->k->'value'),'{}'::jsonb)from(select pa.answers from public.patient_assessments pa
      where pa.user_id=r.member_id and pa.completed_at is not null order by pa.completed_at desc limit 1)x
     cross join unnest(array['q2.height','q2.weight','q2.waist','q3.status','q3.years','q3.per_day','q3.quit_years_ago','q4.frequency','q4.drinks_per_day','q5.diagnosed','q6.hba1c','q7.relatives','q7.relative_age','q8.sleep_hours','q8.breathing','q8.daytime_sleepiness','q8.neck'])k
     where jsonb_typeof(x.answers->k->'value')in('string','number','array'))end,
   'disputed',case when on_ then coalesce((select jsonb_agg(distinct s.subject)from public.member_statements s where s.member_id=r.member_id),'[]'::jsonb)end,
   'ageYears',case when on_ then(select extract(year from age(today_,p.birth_date))::integer from public.profiles p where p.id=r.member_id)end,
   'medicines',case when on_ then public._ldl_medicine_facts(r.member_id,7)end,
   -- Out of the pilot: no LDL record at all, so Zoe has no goal, goal text or test date for this member.
   'ldl',case when on_ and ldl_on and not public._ldl_pilot_excluded(r.member_id)then jsonb_build_object(
    'goal',(select jsonb_build_object('thresholdMmol',g.threshold_mmol,'setOn',(g.set_at at time zone 'Asia/Yerevan')::date)from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1),
    'observations',public._ldl_response_observations(r.member_id),
    'event',(select jsonb_build_object('type',e.event_type,'other',e.event_other,'on',e.event_on)from public.ldl_index_events e where e.member_id=r.member_id and e.removed_at is null order by e.event_on desc nulls last,e.recorded_at desc limit 1),
    'therapies',coalesce((select jsonb_agg(jsonb_build_object('drug',t.drug,'other',t.drug_other,'dose',t.dose,'startedOn',t.started_on)order by t.recorded_at desc)
     from public.ldl_lipid_therapies t where t.member_id=r.member_id and t.ended_at is null),'[]'::jsonb),
    'nextTestOn',coalesce((select t.due_from from public.ldl_retests t where t.member_id=r.member_id and t.state in('scheduled','requested','fenced')order by t.created_at desc limit 1),
     (select g.next_test_on from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1)))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
-- 3. Draft validity: the rules unchanged, plus the optional `activityLimits` -------------------------------------------
create or replace function public.workspace_valid_review_draft(d jsonb)returns boolean
language plpgsql immutable set search_path=''as $$
declare k text;t jsonb;m jsonb;regimen boolean;activity boolean;
begin
 if jsonb_typeof(d) is distinct from 'object' then return false; end if;
 regimen:=d?'medicines';activity:=d?'activityLimits';
 if (select count(*) from jsonb_object_keys(d))<>7+(case when regimen then 1 else 0 end)+(case when activity then 1 else 0 end) then return false; end if;
 if activity and(jsonb_typeof(d->'activityLimits') is distinct from 'string' or public.workspace_text_units(public.workspace_js_trim(d->>'activityLimits')) not between 1 and 500) then return false; end if;
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
 if not regimen then return btrim(d->>'medicationName')='' or (btrim(d->>'medicationDose')<>'' and jsonb_array_length(d->'medicationTimes')>0);end if;
 -- A regimen carries its medicines in the list only, so one medicine can never be read from two places.
 if btrim(d->>'medicationName')<>'' or btrim(d->>'medicationDose')<>'' or btrim(d->>'medicationInstructions')<>'' or jsonb_array_length(d->'medicationTimes')<>0 then return false;end if;
 if jsonb_typeof(d->'medicines') is distinct from 'array' or jsonb_array_length(d->'medicines')>8 then return false;end if;
 for m in select value from jsonb_array_elements(d->'medicines') loop
  if jsonb_typeof(m) is distinct from 'object' or (select count(*) from jsonb_object_keys(m))<>4 then return false;end if;
  foreach k in array array['name','dose','instructions'] loop
   if jsonb_typeof(m->k) is distinct from 'string' then return false;end if;
  end loop;
  if public.workspace_text_units(public.workspace_js_trim(m->>'name')) not between 1 and 120 or public.workspace_text_units(public.workspace_js_trim(m->>'dose')) not between 1 and 120
   or public.workspace_text_units(public.workspace_js_trim(m->>'instructions'))>500 then return false;end if;
  if jsonb_typeof(m->'times') is distinct from 'array' or jsonb_array_length(m->'times') not between 1 and 4 then return false;end if;
  for t in select value from jsonb_array_elements(m->'times') loop
   if jsonb_typeof(t)<>'string' or (t#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
  end loop;
 end loop;
 -- Versions compare medicines by name, so a name appears once. A second line for the same name is refused, not merged.
 return (select count(*)=count(distinct public._regimen_name_key(value->>'name'))from jsonb_array_elements(d->'medicines'));
end $$;
-- 4. Zoe reads it from the published plan -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zoe_run_health_context(p_runs uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare on_ boolean:=coalesce((select health_answers_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'data',case when on_ then jsonb_build_object(
   'bpWeek',(select case when count(*)>0 then jsonb_build_object('count',count(*),'avgSystolic',round(avg(pm.systolic))::integer,'avgDiastolic',round(avg(pm.diastolic))::integer,
     'latest',(select jsonb_build_object('systolic',l.systolic,'diastolic',l.diastolic,'daysAgo',floor(extract(epoch from clock_timestamp()-l.measured_at)/86400)::integer)
       from public.patient_measurements l where l.user_id=r.member_id and l.measured_at<=clock_timestamp()order by l.measured_at desc limit 1))end
     from public.patient_measurements pm where pm.user_id=r.member_id and pm.measured_at<=clock_timestamp()and pm.measured_at>clock_timestamp()-interval '7 days'),
   -- Recent results with their review state: a dangerous value is acted on before the doctor's review (dataset S020, S026).
   'labs',coalesce((select jsonb_agg(x.o order by x.at desc)from(select jsonb_build_object('marker',left(cr.marker,80),'value',cr.value,'unit',left(cr.unit,20),
     'low',cr.reference_low,'high',cr.reference_high,'daysAgo',greatest(0,floor(extract(epoch from clock_timestamp()-cr.collected_at)/86400))::integer,'reviewed',cr.reviewed_at is not null,
     'arrivedMinutesAgo',greatest(0,floor(extract(epoch from clock_timestamp()-greatest(cr.received_at,coalesce(cr.reviewed_at,cr.received_at)))/60))::integer)o,cr.collected_at at
     from public.patient_care_results cr
     cross join lateral(select case when cr.collected_at<=clock_timestamp()-interval '15 days'then 2
      when coalesce(cr.value>cr.reference_high,false)or coalesce(cr.value<cr.reference_low,false)then 0
      when cr.reference_low is null and cr.reference_high is null then 1 else 2 end prio)k
     where cr.user_id=r.member_id and cr.collected_at<=clock_timestamp()and cr.collected_at>clock_timestamp()-interval '2 years'
     order by k.prio,k.prio=0 and cr.reviewed_at is not null,cr.collected_at desc,cr.id limit 16)x),'[]'::jsonb),
   -- The published plan's member-facing fields, as zoe_run_plan (20261018213357) reads them: never a draft.
   'plan',(select jsonb_build_object('explanation',left(coalesce(p.draft->>'explanation',''),1500),'instructions',left(coalesce(p.draft->>'instructions',''),1500),
     'followUp',left(coalesce(p.draft->>'followUp',''),500),'medicationName',left(public._zoe_plan_medicines(p.draft)->>'medicationName',200),'medicationDose',left(public._zoe_plan_medicines(p.draft)->>'medicationDose',200),
     'medicationInstructions',left(public._zoe_plan_medicines(p.draft)->>'medicationInstructions',500),
     'medicationTimes',coalesce((select jsonb_agg(t)from(select t from jsonb_array_elements_text(public._zoe_plan_medicines(p.draft)->'medicationTimes')t
       where t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' limit 4)q),'[]'::jsonb),
     'publishedDaysAgo',greatest(0,floor(extract(epoch from clock_timestamp()-p.published_at)/86400))::integer)
     -- Only when set: the old app's strict plan schema refuses the key.
     ||jsonb_strip_nulls(jsonb_build_object('activityLimits',nullif(left(public.workspace_js_trim(coalesce(p.draft->>'activityLimits','')),500),'')))
    from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
    where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()
    order by p.published_at desc limit 1))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$function$
;
