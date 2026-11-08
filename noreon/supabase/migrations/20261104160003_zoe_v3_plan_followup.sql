-- Real schedule counts, not model estimates. A fully completed day ends an episode.
-- An unticked dose/measurement becomes missed after its local calendar day closes;
-- an explicit "didn't take" counts immediately. Today is never inferred as missed.
create function public.zoe_v3_adherence_context(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare contexts jsonb;stops jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()or not public._telegram_member_eligible(p_member)then return jsonb_build_object('episodes','[]'::jsonb,'stops','[]'::jsonb);end if;
 with plan as(
  select p.*,v.teach_back_confirmed_at from public.patient_care_plans p
  join public.patient_care_plan_versions v on v.plan_id=p.id and v.user_id=p.user_id
  join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
  where p.user_id=p_member and p.active and p.published_at<=now()and c.published_at<=now()and v.teach_back_confirmed_at is not null
 ),slots as(
  select m.id medicine_id,p.id plan_id,day.d::date d,(day.d::date+t.tm)at time zone 'Asia/Yerevan'due_at
  from plan p join public.patient_care_medications m on m.user_id=p.user_id and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
  cross join lateral generate_series(greatest(m.start_date,(p.teach_back_confirmed_at at time zone 'Asia/Yerevan')::date),least(coalesce(m.end_date,(now()at time zone 'Asia/Yerevan')::date),(now()at time zone 'Asia/Yerevan')::date),interval '1 day')day(d)
  cross join lateral(select distinct unnest(m.times)tm)t
  where m.active and (day.d::date+t.tm)at time zone 'Asia/Yerevan'>=greatest(p.teach_back_confirmed_at,coalesce(m.effective_at,p.published_at))
 ),days as(
  select s.medicine_id,s.plan_id,s.d,bool_and(coalesce(e.status='taken',false))complete,
   bool_or(e.status='skipped'or(e.status is null and s.d<(now()at time zone 'Asia/Yerevan')::date))missed
  from slots s left join public.patient_dose_events e on e.user_id=p_member and e.medication_id=s.medicine_id and e.due_at=s.due_at
  group by s.medicine_id,s.plan_id,s.d
 ),dose_roots as(select medicine_id,max(d)filter(where complete)last_complete from days group by medicine_id),
 dose_counts as(
  select 'dose:'||d.plan_id::text||':'||d.medicine_id::text||':'||min(d.d)::text episode,count(*)missed_days
  from days d join dose_roots r using(medicine_id)where d.missed and(r.last_complete is null or d.d>r.last_complete)group by d.plan_id,d.medicine_id
 ),bp_slots as(
  select w.id week_id,day.d::date d,w.readings_per_slot,
   (select count(*)from public.bp_week_readings b where b.week_id=w.id and b.day=day.d::date-w.starts_on+1 and b.slot=t.slot)saved
  from public.bp_weeks w cross join plan p
  cross join lateral generate_series(greatest(w.starts_on,(p.teach_back_confirmed_at at time zone 'Asia/Yerevan')::date),least(w.starts_on+w.days-1,(now()at time zone 'Asia/Yerevan')::date-1),interval '1 day')day(d)
  cross join(values('morning'),('evening'))t(slot)
  where w.member_id=p_member and w.stopped_at is null
 ),bp_days as(select week_id,d,sum(greatest(0,readings_per_slot-saved))missing from bp_slots group by week_id,d),
 bp_roots as(select week_id,max(d)filter(where missing=0)last_complete from bp_days group by week_id),
 bp_counts as(
  select 'bp:'||b.week_id::text||':'||min(b.d)::text episode,sum(b.missing)missed_measurements
  from bp_days b join bp_roots r using(week_id)where b.missing>0 and(r.last_complete is null or b.d>r.last_complete)group by b.week_id
 )select coalesce(jsonb_agg(x),'[]'::jsonb)into contexts from(
  select jsonb_build_object('episode',episode,'missedDoseDays',missed_days,'missedMeasurements',0,'wantsToStopStatin',false)x from dose_counts
  union all select jsonb_build_object('episode',episode,'missedDoseDays',0,'missedMeasurements',missed_measurements,'wantsToStopStatin',false)from bp_counts
 )q;
 -- Stop events from PR 6. Names are used only to recognize explicit generic statins,
 -- never for dose advice or follow-up lab classification. Unknown names remain unknown.
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'episode','stop:'||m.id::text||':'||md5(extract(epoch from m.stopped_at)::text))),'[]'::jsonb)into stops
 from public.member_medicines m where m.user_id=p_member and m.status='course_stopped'and m.stopped_at is not null and m.replaced_by is null;
 return jsonb_build_object('episodes',contexts,'stops',stops);
end$$;

create function public.zoe_v3_plan_members()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(m)from(
  select distinct user_id m from public.patient_care_plans where active
  union select user_id from public.member_medicines where status='course_stopped'and stopped_at is not null and replaced_by is null
 )q where public._telegram_member_eligible(m)),'[]'::jsonb);
end$$;
revoke all on function public.zoe_v3_adherence_context(uuid),public.zoe_v3_plan_members()from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_adherence_context(uuid),public.zoe_v3_plan_members()to service_role;

-- A publication is the durable event. Sweeping it is replay-safe via the queue's source_ref.
-- No name guessing: only a class in the approved regimen or the clinician's member_medicines.class.
-- The current schema usually holds only a broad class; the worker reports it as unknown and raises nothing.
create function public.zoe_v3_lab_changes()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('memberId',r.user_id,'planId',r.plan_id,'publishedOn',(c.published_at at time zone 'Asia/Yerevan')::date,'changes',
  coalesce((select jsonb_agg(jsonb_build_object('drugClass',coalesce(m->>'class',(
   select mm.class from public.member_medicines mm where mm.user_id=r.user_id and public._regimen_name_key(mm.name)=public._regimen_name_key(m->>'name')and mm.class is not null order by mm.created_at desc,mm.id limit 1))))
   from jsonb_array_elements(r.medicines)m
   where not exists(select 1 from jsonb_array_elements(coalesce(prior.medicines,'[]'::jsonb))old
    where public._regimen_name_key(old->>'name')=public._regimen_name_key(m->>'name')and old->>'dose'=m->>'dose'and old->>'class'is not distinct from m->>'class')),'[]'::jsonb)))
  from public.patient_care_plan_regimens r
  join public.patient_clinical_publications c on c.plan_id=r.plan_id and c.user_id=r.user_id
  join public.patient_care_plans p on p.id=r.plan_id and p.active
  left join public.patient_care_plan_regimens prior on prior.plan_id=r.previous_plan_id
  where c.published_at<=now()and public._telegram_member_eligible(r.user_id)),'[]'::jsonb);
end$$;
revoke all on function public.zoe_v3_lab_changes()from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_lab_changes()to service_role;
