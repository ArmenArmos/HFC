-- Zoe chat cards: the published plan on Telegram. A read for a member a channel adapter verified: the active published plan,
-- its medicines and the published review, as the care page reads them. Nothing here writes. Dark with zoe_chat_actions_enabled.
create function public.member_plan_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare p public.patient_care_plans;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 select * into p from public.patient_care_plans where user_id=p_member and active and published_at<=clock_timestamp();
 if p.id is null then return jsonb_build_object('plan',null);end if;
 return jsonb_build_object('plan',jsonb_build_object('id',p.id,'clinician',p.clinician,'publishedAt',p.published_at,'instructions',p.instructions,
   'version',case when public._doctor_completion_enabled()then(select v.version from public.patient_care_plan_versions v where v.plan_id=p.id and v.user_id=p_member order by v.version desc limit 1)end,
   'medicines',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'dose',m.dose,'times',(select coalesce(jsonb_agg(to_char(t,'HH24:MI')order by t),'[]'::jsonb)from unnest(m.times)t))order by m.name,m.id)
    from public.patient_care_medications m where m.user_id=p_member and m.active
     and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
     -- As own_published_care_medications: the plan the medicine came from must be published too (Astra R3).
     and exists(select 1 from public.patient_care_plans o where o.id=m.plan_id and o.user_id=p_member and o.published_at<=clock_timestamp())),'[]'::jsonb),
   'review',(select case when r is not null then jsonb_build_object('planId',r->>'planId','instructions',coalesce(r#>>'{draft,instructions}',''))end from public._patient_current_published_clinical_review(p_member)r)));
end$$;
-- The same boundary on the dose read a card already uses.
create or replace function public.member_plan_doses_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare p public.patient_care_plans;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 select * into p from public.patient_care_plans where user_id=p_member and active and published_at<=clock_timestamp();
 return jsonb_build_object(
  'offset',coalesce((select(x.preferences->>'medicationOffsetMinutes')::integer from public.patient_reminder_preferences x where x.user_id=p_member),0),
  'plan',case when p.id is null then null else jsonb_build_object('id',p.id,'publishedAt',p.published_at,
   'medications',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'planId',p.id,'effectiveAt',m.effective_at,'name',m.name,'dose',m.dose,
     'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),'startDate',m.start_date,'endDate',m.end_date,'active',m.active))
    from public.patient_care_medications m where m.user_id=p_member
     and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
     and exists(select 1 from public.patient_care_plans o where o.id=m.plan_id and o.user_id=p_member and o.published_at<=clock_timestamp())),'[]'::jsonb))end,
  'events',coalesce((select jsonb_agg(jsonb_build_object('medicationId',e.medication_id,'dueAt',e.due_at,'status',e.status,'revision',e.revision,'recordedAt',e.recorded_at))
   from public.patient_dose_events e where e.user_id=p_member and e.due_at>=clock_timestamp()-interval '3 days'),'[]'::jsonb));
end$$;

revoke all on function public.member_plan_read_for(uuid)from public,anon,authenticated;
grant execute on function public.member_plan_read_for(uuid)to service_role;
