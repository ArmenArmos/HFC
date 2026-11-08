-- What Zoe can say from the record in the chat (Armen msgs 580, 581; lib/zoe/member-record.ts): the questionnaire's state, not started when there is
-- no row, and the next booked appointment time; and whether the run's newest message came by Telegram, which keeps its cards. Additive and read-only, no new table. The answers go to the worker only so that it can work out which section is open with
-- the app's own rules (lib/patient/questionnaire.ts); the job and the model get the section's name and counts, never an answer. An old
-- worker ignores the two keys (a lax row schema), a new worker on the old function reads them as null. Grants stay as they are.

create or replace function public.zoe_run_member_record(p_runs uuid[])returns jsonb
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
   'viaTelegram',coalesce((select cm.source='telegram_member'from public.conversation_messages cm where cm.conversation_id=r.conversation_id and cm.seq=r.message_seq),false),
   'questionnaire',case when on_ then coalesce((select jsonb_build_object('completed',pa.completed_at is not null,'answers',pa.answers)from public.patient_assessments pa where pa.user_id=r.member_id),
    jsonb_build_object('completed',false,'answers','{}'::jsonb))end,
   'nextVisit',case when on_ then(select jsonb_build_object('at',to_char(v.starts_at at time zone 'Asia/Yerevan','YYYY-MM-DD HH24:MI'))from(
     select ap.starts_at from public.patient_care_appointments ap where ap.user_id=r.member_id and ap.status='confirmed'
     union all select(a.current_arrangement->>'startsAt')::timestamptz from public.booking_appointments a where a.member_id=r.member_id and a.status='confirmed'and a.current_reservation_id is not null
    )v where v.starts_at>clock_timestamp()order by v.starts_at limit 1)end,
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
