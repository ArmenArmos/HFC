-- zoe_run_health_context (20261019183543), whole, with two changes.
-- 1. arrivedMinutesAgo on each lab: the minutes since the result became visible to Zoe. received_at is the clinic's receipt, and a reviewed row is written
-- later, at publication, so the later of the two counts. spendLabFloors (health-answer.ts) counts a same-day line against a stored lab only when it is
-- newer than this, so a line sent before the result was there never spends its alert. The value stays out of every model block; only the app compares it.
-- 2. The cap of 16 (equal to healthDataSchema's labs max) can no longer leave out a critical value of a big panel. Results inside the 14-day floor window
-- that are out of range come first, unreviewed before reviewed, then those with no range to judge, then the newest. Older results stay in date order, so
-- years of raised values never push out a recent normal one. The list still reaches the model newest first.
-- Existing grants stay: replacing the function keeps them.
create or replace function public.zoe_run_health_context(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
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
     'followUp',left(coalesce(p.draft->>'followUp',''),500),'medicationName',left(coalesce(p.draft->>'medicationName',''),200),'medicationDose',left(coalesce(p.draft->>'medicationDose',''),200),
     'medicationInstructions',left(coalesce(p.draft->>'medicationInstructions',''),500),
     'medicationTimes',coalesce((select jsonb_agg(t)from(select t from jsonb_array_elements_text(case when jsonb_typeof(p.draft->'medicationTimes')='array'then p.draft->'medicationTimes'else '[]'end)t
       where t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' limit 4)q),'[]'::jsonb),
     'publishedDaysAgo',greatest(0,floor(extract(epoch from clock_timestamp()-p.published_at)/86400))::integer)
    from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
    where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()
    order by p.published_at desc limit 1))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
