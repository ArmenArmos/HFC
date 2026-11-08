-- Database hygiene (quality review WP-16, items 42 and 47) and a deterministic document release order.
--
-- 1. Document release state: the latest event per member, file and attachment was chosen by
--    created_at desc, id desc. created_at is clock_timestamp(), which can tie or step backwards on a
--    VM clock, and id is random, so a withdrawal could sort before the release it withdrew (the flaky
--    "second withdrawal unchanged" in check-doctor-completion.sql). Events for one case are serialised
--    by the case row lock, so an identity column records their true order.
alter table public.patient_document_release_events add column seq bigint generated always as identity;
create index patient_document_release_events_latest on public.patient_document_release_events(user_id,file_id,attachment_id,seq desc);
create or replace function public._member_document_release(p_user uuid,p_file uuid,p_attachment uuid)returns public.patient_document_release_events
language sql stable security definer set search_path=''as $$
 select * from public.patient_document_release_events where user_id=p_user and file_id=p_file and attachment_id=p_attachment
 order by seq desc limit 1
$$;

-- 2. Foreign-key columns that live functions filter by and that had no index with them first
--    (item 42). Audit actor columns stay unindexed until an account-deletion path exists.
create index staff_care_notes_patient_case on public.staff_care_notes(patient_case_id);
create index care_alert_screenings_member on public.care_alert_screenings(member_id);
create index system_messages_member on public.system_messages(member_id,created_at);
create index patient_clinical_case_events_member on public.patient_clinical_case_events(user_id,created_at);
create index patient_care_lab_stages_attachment on public.patient_care_lab_stages(attachment_id)where attachment_id is not null;
create index lab_ai_values_attachment on public.lab_ai_values(attachment_id);

-- 3. Medicine reminders: also enumerate tomorrow (item 47). Body otherwise unchanged from
--    20261018003827_member_medicines.sql; grants are kept by create or replace.
create or replace function public.member_medicine_reminders_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;r record;queued integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(select not enabled or not reminders from public.member_medicine_settings where singleton)then return jsonb_build_object('ok',true,'state','off');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;
 for r in
  with prefs as(
   select u.user_id,coalesce((p.preferences->>'medicationEnabled')::boolean,true)on_,coalesce((p.preferences->>'medicationOffsetMinutes')::integer,0)off_
   from(select user_id from public.member_medicines where stopped_at is null
        union select p.user_id from public.patient_care_plans p where p.active and p.published_at<=nowt)u
   left join public.patient_reminder_preferences p on p.user_id=u.user_id),
  due as(
   -- Tomorrow, today and yesterday, so an offset that crosses midnight either way is still found
   -- (a 00:05 dose with a -15 minute offset is reminded at 23:50 the evening before, review item 47).
   select m.user_id,public._member_medicine_due(dd,t)due_at,(not exists(select 1 from public.member_medicine_doses x where x.medicine_id=m.id and x.due_at=public._member_medicine_due(dd,t)))open_
    from public.member_medicines m cross join unnest(m.times)t cross join(values(today+1),(today),(today-1))v(dd)
    where m.stopped_at is null and m.started_on<=dd
   union all
   select pm.user_id,public._member_medicine_due(dd,t),(not exists(select 1 from public.patient_dose_events x where x.user_id=pm.user_id and x.medication_id=pm.id and x.due_at=public._member_medicine_due(dd,t)))
    from(select distinct p.user_id from public.patient_care_plans p where p.active and p.published_at<=nowt)u
    cross join(values(today+1),(today),(today-1))v(dd)
    cross join lateral public._member_plan_medicines(u.user_id,dd)pm cross join unnest(pm.times)t
    -- Not before the medicine is in force (published plan or its effective time), review F4.
    where public._member_medicine_due(dd,t)>=coalesce(pm.effective_at,(select published_at from public.patient_care_plans where id=pm.plan_id)))
  select d.user_id,d.due_at,bool_or(d.open_)any_open from due d join prefs p on p.user_id=d.user_id
  where p.on_ and nowt>=d.due_at+make_interval(mins=>p.off_)and nowt<d.due_at+make_interval(mins=>p.off_)+interval '15 minutes'
  group by d.user_id,d.due_at
 loop
  if r.any_open and not public._member_quiet_now(r.user_id,lt::time)and not public._member_reminder_held(r.user_id,'member.reminder_medicine')then
   if public._member_notice_safe(r.user_id,'reminders','member.reminder_medicine','medicine:'||r.user_id::text||':'||extract(epoch from r.due_at)::bigint::text,
    jsonb_build_object('time',to_char(r.due_at at time zone 'Asia/Yerevan','HH24:MI')),'/patient/medicines','open_home')is not null then queued:=queued+1;end if;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','queued',queued);
end$$;
