-- What the member's record already holds, for a Zoe health answer (lib/zoe/member-record.ts). A new function rather than a change to
-- zoe_run_health_context: a worker still on the old build reads that one strictly, and this one it does not call.
--
-- Read-only. Age in whole years, never the birth date. The LDL fields only while ldl_goal_enabled is on, and the values a doctor
-- reviewed or released (_ldl_response_observations), never a member's own unchecked entry. The doctor's notes, the goal's reason and
-- maximally_tolerated stay out. A goal row exists only after the doctor confirmed it; the number stays in the worker unless
-- NOREON_ZOE_LDL_TARGET=on. chatCards is the chat cards' own switch: the prompt says the chat can log only while a card can do it.

create function public.zoe_run_member_record(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select health_answers_enabled from public.zoe_settings where singleton),false);ldl_on boolean:=public._ldl_goal_enabled();
 today_ date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 cards_on boolean:=coalesce((select zoe_chat_actions_enabled from public.conversation_policy where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'today',today_,'chatCards',on_ and cards_on,
   'ageYears',case when on_ then(select extract(year from age(today_,p.birth_date))::integer from public.profiles p where p.id=r.member_id)end,
   'medicines',case when on_ then public._ldl_medicine_facts(r.member_id,7)end,
   'ldl',case when on_ and ldl_on then jsonb_build_object(
    'goal',(select jsonb_build_object('thresholdMmol',g.threshold_mmol,'setOn',(g.set_at at time zone 'Asia/Yerevan')::date)from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1),
    'observations',public._ldl_response_observations(r.member_id),
    'event',(select jsonb_build_object('type',e.event_type,'other',e.event_other,'on',e.event_on)from public.ldl_index_events e where e.member_id=r.member_id and e.removed_at is null order by e.event_on desc nulls last,e.recorded_at desc limit 1),
    'therapies',coalesce((select jsonb_agg(jsonb_build_object('drug',t.drug,'other',t.drug_other,'dose',t.dose,'startedOn',t.started_on)order by t.recorded_at desc)
     from public.ldl_lipid_therapies t where t.member_id=r.member_id and t.ended_at is null),'[]'::jsonb),
    'nextTestOn',coalesce((select t.due_from from public.ldl_retests t where t.member_id=r.member_id and t.state in('scheduled','requested','fenced')order by t.created_at desc limit 1),
     (select g.next_test_on from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1)))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
revoke all on function public.zoe_run_member_record(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_member_record(uuid[])to service_role;
