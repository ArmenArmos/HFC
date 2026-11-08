-- Gohar QA 97 and 99 (23 Oct).
--
-- 1. QA 97: "Write to your doctor" routes one message, and #388 kept every member message of the same Zoe run with the
--    doctor, so a quick follow-up could not pull the request back. A "New question" divider after that message now ends
--    it: a message after the newest divider is Zoe's again (doctor takeover after the doctor's own reply is unchanged).
--    Only the to-doctor window of zoe_run_doctor_mode changes; the rest is 20261022081616 as it was.
-- 2. QA 99: the member edits the dose and times of a medicine on their own self-reported list. Only member_medicines rows
--    whose user_id is the caller and that are not stopped; the doctor's plan medicines live in patient_care_medications,
--    which this function never touches. Same switch, staff refusal and validation as member_medicine_add. The tables
--    keep no direct grants (all access is through these security-definer functions).
--    A new schedule applies from the moment of the change, never to the past (Astra R393-01): the old row is stopped
--    now, keeping its ticks and its adherence as they were, and a new row carries the new times with effective_at = now.
--    Dose slots of that row before effective_at do not exist: not in the member's day, the staff adherence count, a tick,
--    a reminder or a missed-dose question. A dose-only change edits the row in place (no slot changes).

create or replace function public.zoe_run_doctor_mode(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'doctorMode',td.to_doctor or public._zoe_doctor_mode(r.conversation_id),
   -- Explicitly addressed messages never enter the unrelated-topic bypass.
   'scope',case when td.to_doctor then 'conversation'else public._zoe_takeover_scope()end,
   'doctorMatter',case when public._zoe_doctor_mode(r.conversation_id)then(
    select jsonb_build_object('reply',ap.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer,
     -- The member messages the reply answered: up to three, in the six hours before it.
     'messages',coalesce((select jsonb_agg(jsonb_build_object('text',w.body,'minutesAgo',floor(extract(epoch from clock_timestamp()-w.created_at)/60)::integer)order by w.seq)
      from(select m.seq,m.body,m.created_at from public.conversation_messages m where m.conversation_id=r.conversation_id and m.source in('telegram_member','authenticated_member')
       and m.created_at<=ap.created_at and m.created_at>ap.created_at-interval '6 hours'order by m.seq desc limit 3)w),'[]'::jsonb))
    from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id order by ap.created_at desc,ap.id desc limit 1)end))
  from public.zoe_runs r
  -- Every member message this run covers (newer than the previous inbound run, as zoe_run_claim batches them) and after the
  -- member's newest "New question" divider (QA 97): one addressed to the doctor keeps the whole run with the doctor.
  cross join lateral(select exists(select 1 from public.conversation_messages cm where cm.conversation_id=r.conversation_id and cm.to_doctor
   and cm.seq<=r.message_seq and cm.seq>greatest(coalesce((select max(zr.message_seq)from public.zoe_runs zr where zr.conversation_id=r.conversation_id
    and zr.kind='inbound'and zr.message_seq<r.message_seq),0),
    coalesce((select max(b.after_seq)from public.conversation_topic_breaks b where b.conversation_id=r.conversation_id and b.after_seq<r.message_seq),0)))to_doctor)td
  where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

alter table public.member_medicines add column effective_at timestamptz;
comment on column public.member_medicines.effective_at is
 'Set when the row replaced an earlier schedule of the same medicine (member_medicine_update): no dose slot before it counts.';

create or replace function public._member_medicine_json(m public.member_medicines,p_from timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',m.id,'source',m.source,'name',m.name,'dose',m.dose,
  'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),
  'startedOn',m.started_on,'createdAt',m.created_at,'stoppedAt',m.stopped_at,'effectiveAt',m.effective_at,
  'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',d.due_at,'status',d.status,'recordedAt',d.recorded_at,'revision',d.revision)order by d.due_at)
   from public.member_medicine_doses d where d.medicine_id=m.id and d.due_at>=p_from),'[]'::jsonb))
$$;

create or replace function public.member_medicine_dose_report(p_medicine uuid,p_due_at timestamptz,p_status text,p_expected_revision integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();m public.member_medicines;local timestamp;d public.member_medicine_doses;rev integer;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_status is null or p_status not in('taken','skipped')or p_due_at is null or not isfinite(p_due_at)or p_expected_revision is null or p_expected_revision<0
  then return jsonb_build_object('status','invalid');end if;
 select * into m from public.member_medicines where id=p_medicine and user_id=uid for share;
 if not found then raise insufficient_privilege;end if;
 local:=p_due_at at time zone 'Asia/Yerevan';
 if not(local::time=any(m.times))or local::date<m.started_on or p_due_at>clock_timestamp()+interval '60 minutes'
  or p_due_at<clock_timestamp()-interval '3 days'or(m.stopped_at is not null and p_due_at>=m.stopped_at)or(m.effective_at is not null and p_due_at<m.effective_at)then return jsonb_build_object('status','not-due');end if;
 select * into d from public.member_medicine_doses where medicine_id=m.id and due_at=p_due_at for update;
 if not found then
  if p_expected_revision<>0 then return jsonb_build_object('status','conflict');end if;
  insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(m.id,uid,p_due_at,p_status)
   on conflict(medicine_id,due_at)do nothing returning revision into rev;
  if rev is null then return jsonb_build_object('status','conflict');end if;
  return jsonb_build_object('status','saved','revision',rev);
 end if;
 if d.revision<>p_expected_revision then return jsonb_build_object('status','conflict');end if;
 if d.status=p_status then return jsonb_build_object('status','saved','revision',d.revision);end if;
 update public.member_medicine_doses set status=p_status,recorded_at=clock_timestamp(),revision=revision+1 where medicine_id=m.id and due_at=p_due_at returning revision into rev;
 return jsonb_build_object('status','saved','revision',rev);
end$$;


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
     and(m.effective_at is null or public._member_medicine_due(dd,t)>=m.effective_at)
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


create or replace function public.member_medicine_asks_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;r record;opened integer:=0;queued integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;
 -- Backstop for the tick trigger, which skips a locked ask (MED-03): an open ask whose dose is now ticked taken is
 -- withdrawn. Rows another transaction holds are skipped (next sweep).
 update public.member_medicine_asks set state='withdrawn'where id in(select a.id from public.member_medicine_asks a where a.state='open'and(
  (a.source='self'and exists(select 1 from public.member_medicine_doses x where x.medicine_id=a.medicine_id and x.due_at=a.due_at and x.status='taken'))
  or(a.source='plan'and exists(select 1 from public.patient_dose_events x where x.user_id=a.user_id and x.medication_id=a.medicine_id and x.due_at=a.due_at and x.status='taken')))
  for update of a skip locked);
 -- Astra MED-02: a notice still queued (not yet claimed; the sender runs right after this in the same dispatcher pass) is
 -- held when it may not go now (_medicine_ask_notice_hold: ask closed, member not eligible, medicine reminders off,
 -- quiet hours), also when the switch was just turned off. The ask stays in the app. The claim guard above refuses the
 -- same cases if this step did not run.
 for r in select t.id from public.telegram_auth_messages t where t.state='queued'and t.template_id='member.medicine_ask'for update skip locked loop
  begin
   update public.telegram_auth_messages set state='held',reason=h.h,state_seq=state_seq+1,updated_at=clock_timestamp()
    from(select public._medicine_ask_notice_hold(r.id,nowt)h)h where id=r.id and h.h is not null;
  exception when others then null;
  end;
 end loop;
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('ok',true,'state','off');end if;
 for r in
  with due as(
   select m.user_id,'self'::text src,m.id med,public._member_medicine_due(dd,t)due_at
    from public.member_medicines m cross join unnest(m.times)t cross join(values(today),(today-1))v(dd)
    where m.stopped_at is null and m.started_on<=dd
     and(m.effective_at is null or public._member_medicine_due(dd,t)>=m.effective_at)
     and exists(select 1 from public.member_medicine_doses x where x.medicine_id=m.id and x.due_at>nowt-interval '7 days')
   union all
   select pm.user_id,'plan',pm.id,public._member_medicine_due(dd,t)
    from(select distinct p.user_id from public.patient_care_plans p where p.active and p.published_at<=nowt)u
    cross join(values(today),(today-1))v(dd)
    cross join lateral public._member_plan_medicines(u.user_id,dd)pm cross join unnest(pm.times)t
    where public._member_medicine_due(dd,t)>=coalesce(pm.effective_at,(select published_at from public.patient_care_plans where id=pm.plan_id))
     and exists(select 1 from public.patient_dose_events x where x.user_id=pm.user_id and x.medication_id=pm.id and x.due_at>nowt-interval '7 days'))
  select d.* from due d
  where d.due_at<=nowt-interval '4 hours'and d.due_at>nowt-interval '24 hours'
   and not exists(select 1 from public.member_medicine_doses x where d.src='self'and x.medicine_id=d.med and x.due_at=d.due_at)
   and not exists(select 1 from public.patient_dose_events x where d.src='plan'and x.user_id=d.user_id and x.medication_id=d.med and x.due_at=d.due_at)
  order by d.due_at
 loop
  begin
   if public._medicine_ask_open(r.user_id,r.src,r.med,r.due_at,'missed',nowt)is not null then opened:=opened+1;end if;
  exception when others then null;
  end;
 end loop;
 perform set_config('noreon.member_notice_sweep','on',true);
 for r in
  select a.* from public.member_medicine_asks a
  where a.state='open'and a.trigger='missed'and a.notice_at is null and a.expires_at>nowt+interval '2 hours'
  order by a.created_at limit 200
 loop
  if public._medicine_ask_blocked(r.user_id)is not null then
   update public.member_medicine_asks set notice_at=nowt where id=r.id;
  elsif not coalesce((select(p.preferences->>'medicationEnabled')::boolean from public.patient_reminder_preferences p where p.user_id=r.user_id),true)then
   -- Medicine reminders off: the ask stays in the app, with no Telegram notice.
   update public.member_medicine_asks set notice_at=nowt where id=r.id;
  elsif not public._member_quiet_now(r.user_id,lt::time)and not public._member_reminder_held(r.user_id,'member.medicine_ask')then
   if public._member_notice_safe(r.user_id,'reminders','member.medicine_ask','medicine_ask:'||r.id::text,'{}'::jsonb,'/patient/medicines','open_home')is not null then queued:=queued+1;end if;
   update public.member_medicine_asks set notice_at=nowt where id=r.id;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','opened',opened,'queued',queued);
end$$;


-- Change the dose and times of one of the member's own medicines. {status:'saved',id} (id: the row that now holds it) |
-- {status:'not-found'} | {status:'invalid'} | {status:'disabled'}.
create function public.member_medicine_update(p_id uuid,p_dose text,p_times time[])returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();m public.member_medicines;ts time[];nowt timestamptz:=clock_timestamp();mid uuid;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 if p_id is null or(p_dose is not null and length(btrim(p_dose))>120)or not public._member_medicine_times_ok(p_times)then return jsonb_build_object('status','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 select * into m from public.member_medicines where id=p_id and user_id=uid and stopped_at is null for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 ts:=(select array_agg(t order by t)from unnest(p_times)t);
 if ts=m.times then
  update public.member_medicines set dose=nullif(btrim(p_dose),'')where id=m.id;
  return jsonb_build_object('status','saved','id',m.id);
 end if;
 update public.member_medicines set stopped_at=nowt where id=m.id;
 insert into public.member_medicines(user_id,name,dose,times,started_on,effective_at)
  values(uid,m.name,nullif(btrim(p_dose),''),ts,(nowt at time zone 'Asia/Yerevan')::date,nowt)returning id into mid;
 -- A tick given early (up to 60 minutes ahead) for a time the new schedule keeps moves with it (Astra R393-01 follow-up).
 update public.member_medicine_doses set medicine_id=mid where medicine_id=m.id and due_at>=nowt and(due_at at time zone 'Asia/Yerevan')::time=any(ts);
 return jsonb_build_object('status','saved','id',mid);
end$$;
revoke all on function public.member_medicine_update(uuid,text,time[])from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_update(uuid,text,time[])to authenticated;
