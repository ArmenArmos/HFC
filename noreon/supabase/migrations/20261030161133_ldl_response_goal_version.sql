-- A response's facts must rest on the member's current LDL goal (test gap 4, 30 Oct 2026).
-- The sweep reads ldl_response_candidates, works out the facts in the app, then calls ldl_response_record. A doctor who
-- changes the goal in between left an immutable response assessed against the goal that had just been replaced. Now
-- the record compares the goal version in the facts with the newest one, under the case lock doctor_ldl_goal_set also
-- takes, and answers 'stale'. Nothing is stored and the next sweep works it out again from the new goal. A replay of a
-- response already stored still replays: that response stands, as the check it was.

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
 if not found or k.assigned_doctor_id is null then return jsonb_build_object('status','not-found');end if;
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
