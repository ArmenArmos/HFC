-- Gohar QA 118 (25 Oct): after "Change dose or times" removed one of two times, the card lost its dose rows and Home
-- stopped counting it. A time change stops the old row now and starts a new row from now (Astra R393-01), so a kept
-- time already earlier today (08:00, changed at 21:00) had a slot on neither: the old row is hidden once stopped and
-- the new row has no slot before effective_at.
-- Fix, with nothing in the past rewritten: the old row records the row that replaced it (replaced_by). Today's earlier
-- slot of a kept time stays on the old row with its tick (staff adherence is unchanged: it already counts the old row's
-- slots before its stop). The member's day shows it under the live row (lib/member-medicines/model.ts), a tick goes to
-- the old row (member_medicine_dose_report already allows slots before stopped_at), and the reminder and the
-- missed-dose question treat it like a slot of a live medicine. A time the member removed is not followed.

alter table public.member_medicines add column replaced_by uuid references public.member_medicines(id)on delete set null;
comment on column public.member_medicines.replaced_by is
 'Set when member_medicine_update replaced this schedule: the row holding the new times (QA 118).';
-- Edits made since 20261023063738: the new row starts at the instant the old one stopped.
update public.member_medicines o set replaced_by=n.id from public.member_medicines n
 where o.replaced_by is null and o.stopped_at is not null and n.user_id=o.user_id and n.name=o.name and n.effective_at=o.stopped_at and n.id<>o.id;

-- True when every later schedule after this replaced row kept the time and the newest one is live.
create function public._member_medicine_kept(p_id uuid,p_time time)returns boolean
language sql stable security definer set search_path=''as $$
 with recursive c(id,n)as(
  select replaced_by,1 from public.member_medicines where id=p_id and replaced_by is not null
  union all
  select m.replaced_by,c.n+1 from c join public.member_medicines m on m.id=c.id
   where m.stopped_at is not null and m.replaced_by is not null and p_time=any(m.times)and c.n<50)
 select exists(select 1 from c join public.member_medicines m on m.id=c.id where m.stopped_at is null and p_time=any(m.times))
$$;
revoke all on function public._member_medicine_kept(uuid,time)from public,anon,authenticated,service_role;

create or replace function public._member_medicine_json(m public.member_medicines,p_from timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',m.id,'source',m.source,'name',m.name,'dose',m.dose,
  'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),
  'startedOn',m.started_on,'createdAt',m.created_at,'stoppedAt',m.stopped_at,'effectiveAt',m.effective_at,'replacedBy',m.replaced_by,
  'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',d.due_at,'status',d.status,'recordedAt',d.recorded_at,'revision',d.revision)order by d.due_at)
   from public.member_medicine_doses d where d.medicine_id=m.id and d.due_at>=p_from),'[]'::jsonb))
$$;

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
    where m.started_on<=dd
     and(m.effective_at is null or public._member_medicine_due(dd,t)>=m.effective_at)
     and(m.stopped_at is null or(m.replaced_by is not null and m.stopped_at>nowt-interval '2 days'
      and public._member_medicine_due(dd,t)<m.stopped_at and public._member_medicine_kept(m.id,t)))
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
    where m.started_on<=dd
     and(m.effective_at is null or public._member_medicine_due(dd,t)>=m.effective_at)
     and(m.stopped_at is null or(m.replaced_by is not null and m.stopped_at>nowt-interval '2 days'
      and public._member_medicine_due(dd,t)<m.stopped_at and public._member_medicine_kept(m.id,t)))
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

create or replace function public.member_medicine_update(p_id uuid,p_dose text,p_times time[])returns jsonb
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
 insert into public.member_medicines(user_id,name,dose,times,started_on,effective_at)
  values(uid,m.name,nullif(btrim(p_dose),''),ts,(nowt at time zone 'Asia/Yerevan')::date,nowt)returning id into mid;
 update public.member_medicines set stopped_at=nowt,replaced_by=mid where id=m.id;
 -- A tick given early (up to 60 minutes ahead) for a time the new schedule keeps moves with it (Astra R393-01 follow-up).
 update public.member_medicine_doses set medicine_id=mid where medicine_id=m.id and due_at>=nowt and(due_at at time zone 'Asia/Yerevan')::time=any(ts);
 return jsonb_build_object('status','saved','id',mid);
end$$;
