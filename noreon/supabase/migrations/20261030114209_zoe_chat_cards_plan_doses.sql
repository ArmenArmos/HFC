-- Zoe chat cards: medicines from the published plan on the dose card, in the app and on Telegram (lane finding M-01: the
-- card listed self-reported medicines only, and a pilot member's main medicines come from the plan). The rules stay the
-- plan's own: one body with the member as an argument, the session entry points unchanged, and a service entry point for a
-- member a channel adapter verified (20261030102535). Dark with zoe_chat_actions_enabled: only the cards call the new ones.

create function public._report_patient_dose_unversioned(uid uuid,p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.patient_care_medications;plan public.patient_care_plans;local_due timestamp;today date;crosses_midnight boolean;
begin
 if uid is null or p_status is null or p_status not in ('taken','skipped') then raise exception 'invalid dose report';end if;
 select * into m from public.patient_care_medications where id=p_medication_id and user_id=uid for share;
 if not found or not m.active then raise exception 'medication unavailable';end if;
 select p.* into plan from public.patient_care_plans p where p.user_id=uid and (p.id=m.plan_id or exists(select 1 from public.patient_care_plan_medications link where link.plan_id=p.id and link.medication_id=m.id)) order by p.published_at desc,p.id limit 1 for share of p;
 if not found or plan.published_at>now() then raise exception 'plan unavailable';end if;
 if not plan.active and (plan.retired_at is null or p_due_at>=plan.retired_at or not exists(select 1 from public.patient_dose_events where user_id=uid and medication_id=m.id and due_at=p_due_at)) then raise exception 'plan unavailable';end if;
 local_due:=timezone('Asia/Yerevan',p_due_at);today:=timezone('Asia/Yerevan',now())::date;
 crosses_midnight:=(local_due+interval '15 minutes')::date=today and exists(select 1 from public.patient_reminder_preferences where user_id=uid and preferences->>'medicationOffsetMinutes'='15');
 if p_due_at is null or p_due_at>now() or p_due_at<coalesce(m.effective_at,plan.published_at) or (local_due::date<>today and not crosses_midnight) or local_due::date<m.start_date or (m.end_date is not null and local_due::date>m.end_date) or not(local_due::time=any(m.times)) then raise exception 'dose outside schedule';end if;
 insert into public.patient_dose_events(user_id,medication_id,due_at,status) values(uid,m.id,p_due_at,p_status) on conflict(user_id,medication_id,due_at) do update set status=excluded.status,recorded_at=now();
end $$;

create or replace function public.report_patient_dose_unversioned(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public._report_patient_dose_unversioned(auth.uid(),p_medication_id,p_due_at,p_status);
end $$;

create function public._report_patient_dose_versioned(uid uuid,p_medication_id uuid,p_due_at timestamptz,p_status text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare current_event public.patient_dose_events;result bigint;
begin
 if uid is null or p_expected_revision is null or p_expected_revision<0 or p_status is null or p_status not in ('taken','skipped') then raise exception 'invalid dose report';end if;
 -- Same medication->plan lock order as the existing schedule validator.
 perform 1 from public.patient_care_medications where id=p_medication_id and user_id=uid for update;
 if not found then raise exception 'medication unavailable';end if;
 select * into current_event from public.patient_dose_events where user_id=uid and medication_id=p_medication_id and due_at=p_due_at;
 if current_event.revision is null then
  if p_expected_revision<>0 then raise exception 'dose revision conflict';end if;
 elsif p_expected_revision<>current_event.revision and not(current_event.revision=p_expected_revision+1 and current_event.status=p_status) then
  raise exception 'dose revision conflict';
 end if;
 -- Always revalidate current plan and due time, even on an otherwise idempotent retry.
 perform public._report_patient_dose_unversioned(uid,p_medication_id,p_due_at,p_status);
 select revision into result from public.patient_dose_events where user_id=uid and medication_id=p_medication_id and due_at=p_due_at;
 return result;
end $$;

create or replace function public.report_patient_dose_versioned(p_medication_id uuid,p_due_at timestamptz,p_status text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
begin
 return public._report_patient_dose_versioned(auth.uid(),p_medication_id,p_due_at,p_status,p_expected_revision);
end $$;

-- A report through a verified actor has no session: the member it was verified for is who recorded it.
create or replace function public.audit_patient_dose_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.patient_dose_event_history(user_id,medication_id,due_at,revision,status,recorded_at,recorded_by,kind,plan_id)
 select new.user_id,new.medication_id,new.due_at,new.revision,new.status,new.recorded_at,coalesce(auth.uid(),new.user_id),'report',m.plan_id
 from public.patient_care_medications m where m.id=new.medication_id and m.user_id=new.user_id;
 if not found then raise exception 'dose source unavailable';end if;
 return new;
end $$;

-- Service role only. A plain status instead of the session path's exceptions, because the channel has no error text to read.
create function public.report_patient_dose_for(p_member uuid,p_medication_id uuid,p_due_at timestamptz,p_status text,p_expected_revision bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r bigint;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('status','disabled');end if;
 begin
  r:=public._report_patient_dose_versioned(p_member,p_medication_id,p_due_at,p_status,p_expected_revision);
 exception when raise_exception then
  if sqlerrm='dose revision conflict'then return jsonb_build_object('status','conflict');end if;
  if sqlerrm in('dose outside schedule','plan unavailable','medication unavailable')then return jsonb_build_object('status','not-due');end if;
  if sqlerrm='invalid dose report'then return jsonb_build_object('status','invalid');end if;
  raise;
 end;
 return jsonb_build_object('status','saved','revision',r);
end$$;

-- What the plan's dose list needs (lib/patient-care/model.ts dosesForDay), read as lib/patient-care/repository.ts reads it.
create function public.member_plan_doses_read_for(p_member uuid)returns jsonb
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
     and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))),'[]'::jsonb))end,
  'events',coalesce((select jsonb_agg(jsonb_build_object('medicationId',e.medication_id,'dueAt',e.due_at,'status',e.status,'revision',e.revision,'recordedAt',e.recorded_at))
   from public.patient_dose_events e where e.user_id=p_member and e.due_at>=clock_timestamp()-interval '3 days'),'[]'::jsonb));
end$$;

revoke all on function public._report_patient_dose_unversioned(uuid,uuid,timestamptz,text),public._report_patient_dose_versioned(uuid,uuid,timestamptz,text,bigint)from public,anon,authenticated,service_role;
revoke all on function public.report_patient_dose_for(uuid,uuid,timestamptz,text,bigint),public.member_plan_doses_read_for(uuid)from public,anon,authenticated;
grant execute on function public.report_patient_dose_for(uuid,uuid,timestamptz,text,bigint),public.member_plan_doses_read_for(uuid)to service_role;
