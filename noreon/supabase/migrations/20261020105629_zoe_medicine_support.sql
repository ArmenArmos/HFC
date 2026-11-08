-- Medicine-taking support (Armen's approved coaching item 5, 20 Oct 2026; output/zoe-med-support/).
-- When a member skips a dose, or leaves one unticked, Zoe asks once, kindly, why: forgot, side effect, cost or
-- availability, ran out, or decided to stop. Then:
--  * forgot: the app offers a reminder-time change (the existing reminder settings);
--  * ran out, cost or availability: the app says how to get a refill, and the member can ask the care team, which puts
--    a refill item on the assigned doctor's medicine list;
--  * side effect, or decided to stop: no medicine advice. A concern goes on the assigned doctor's medicine list with a
--    short summary built by code (no AI, no free text), and the member is told the doctor will answer.
-- Never a dose instruction, a rating or an automatic change. Ticks are the member's own report, not proof.
--
-- Who is asked, and when:
--  * a skipped tick (either kind of medicine) opens an ask at once; the member sees it in the app (no Telegram);
--  * a dose left unticked 4 hours after its time (up to 24 hours) opens an ask in the 5-minute sweep, only for a medicine
--    the member ticked at least once in the last 7 days, and at most one such ask per member per 20 hours. It is
--    announced by one Telegram notice through the member notices (#221, group "reminders"; no medicine name, no health
--    detail), outside quiet hours, not when the member turned medicine reminders off;
--  * at most one ask per medicine per 3 days; an ask lapses after 48 hours, or when the dose is ticked as taken;
--  * never while the switch is off, the member has no current Zoe consent (zoe_reads_messages) or turned Zoe's scheduled
--    questions off, a doctor has taken over the member's Zoe chat (_zoe_doctor_mode, when that lane's function
--    exists), or the account is staff.
-- Dark: member_medicine_settings.asks (default off; needs enabled too). Copy is UNAPPROVED v1 (Armen, Tatevik).

alter table public.member_medicine_settings add column asks boolean not null default false;

create table public.member_medicine_asks(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id)on delete cascade,
 source text not null check(source in('self','plan')),
 medicine_id uuid not null,
 due_at timestamptz not null,
 trigger text not null check(trigger in('skipped','missed')),
 state text not null default 'open'check(state in('open','answered','withdrawn')),
 reason text check(reason in('forgot','side_effect','cost_or_availability','ran_out','decided_to_stop')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 answered_at timestamptz,
 notice_at timestamptz,
 unique(source,medicine_id,due_at),
 check((state='answered')=(reason is not null and answered_at is not null))
);
create index member_medicine_asks_member on public.member_medicine_asks(user_id,created_at desc);
create index member_medicine_asks_medicine on public.member_medicine_asks(user_id,source,medicine_id,created_at desc);
create index member_medicine_asks_notice on public.member_medicine_asks(created_at)where state='open'and trigger='missed'and notice_at is null;

create table public.member_medicine_concerns(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id)on delete cascade,
 ask_id uuid not null unique references public.member_medicine_asks(id)on delete cascade,
 kind text not null check(kind in('side_effect','decided_to_stop','refill')),
 state text not null default 'open'check(state in('open','handled')),
 created_at timestamptz not null default clock_timestamp(),
 handled_at timestamptz,
 handled_by uuid references auth.users(id),
 check((state='handled')=(handled_at is not null and handled_by is not null))
);
create index member_medicine_concerns_open on public.member_medicine_concerns(user_id,created_at)where state='open';

alter table public.member_medicine_asks enable row level security;
alter table public.member_medicine_concerns enable row level security;
revoke all on public.member_medicine_asks,public.member_medicine_concerns from public,anon,authenticated,service_role;

-- 1. Who may be asked ---------------------------------------------------------------------------------------------------

-- Null when Zoe may ask this member now; otherwise why not.
create function public._medicine_ask_blocked(m uuid)returns text
language plpgsql stable security definer set search_path=''as $$
declare t boolean;
begin
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return 'switched_off';end if;
 if exists(select 1 from public.workspace_staff where user_id=m)then return 'staff_account';end if;
 if not public._zoe_consent_current(m,'zoe_reads_messages')then return 'no_consent';end if;
 if(select not z.granted from public.zoe_consents z where z.member_id=m and z.kind='zoe_scheduled_questions'order by z.id desc limit 1)then return 'questions_off';end if;
 -- Doctor takeover (20261020082321_zoe_doctor_takeover, parallel lane): called by name so either change can ship first.
 if to_regprocedure('public._zoe_doctor_mode(uuid)')is not null then
  execute 'select public._zoe_doctor_mode(c.id)from public.conversations c where c.member_id=$1'into t using m;
  if t then return 'takeover';end if;
 end if;
 return null;
end$$;

-- Open one ask, or nothing. Never waits: when another transaction holds this member's ask lock (the sweep, or a
-- concurrent tick), nothing opens now; a missed dose is found again by the next sweep (Astra MED-03). The callers catch
-- errors, so an ask can never block or roll back the tick it rides on.
create function public._medicine_ask_open(m uuid,p_source text,p_medicine uuid,p_due timestamptz,p_trigger text,p_now timestamptz)returns uuid
language plpgsql security definer set search_path=''as $$
declare aid uuid;
begin
 if public._medicine_ask_blocked(m)is not null then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('medicine-ask:'||m::text,0))then return null;end if;
 if exists(select 1 from public.member_medicine_asks where source=p_source and medicine_id=p_medicine and due_at=p_due)then return null;end if;
 if exists(select 1 from public.member_medicine_asks where user_id=m and source=p_source and medicine_id=p_medicine and created_at>p_now-interval '3 days')then return null;end if;
 if p_trigger='missed'and exists(select 1 from public.member_medicine_asks where user_id=m and trigger='missed'and created_at>p_now-interval '20 hours')then return null;end if;
 insert into public.member_medicine_asks(user_id,source,medicine_id,due_at,trigger,created_at,expires_at)
  values(m,p_source,p_medicine,p_due,p_trigger,p_now,p_now+interval '48 hours')
  on conflict(source,medicine_id,due_at)do nothing returning id into aid;
 return aid;
end$$;

-- 2. Ticks open or withdraw an ask ----------------------------------------------------------------------------------------

-- A skipped tick opens an ask; a change to taken withdraws the open ask for that dose. A failure here never stops the tick.
create function public._medicine_ask_on_tick()returns trigger
language plpgsql security definer set search_path=''as $$
declare src text;med uuid;
begin
 begin
  -- Everything inside the guard, the column lookup included.
  src:=tg_argv[0];
  med:=(to_jsonb(new)->>case src when 'self'then 'medicine_id'else 'medication_id'end)::uuid;
  if new.status='skipped'and(tg_op='INSERT'or old.status is distinct from 'skipped')then
   perform public._medicine_ask_open(new.user_id,src,med,new.due_at,'skipped',clock_timestamp());
  elsif new.status='taken'then
   -- Skip a row another transaction holds (Astra MED-03): the tick never waits for the ask.
   update public.member_medicine_asks set state='withdrawn'where id in(select id from public.member_medicine_asks
    where source=src and medicine_id=med and due_at=new.due_at and state='open'for update skip locked);
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger medicine_ask_self_tick after insert or update of status on public.member_medicine_doses
 for each row execute function public._medicine_ask_on_tick('self');
create trigger medicine_ask_plan_tick after insert or update of status on public.patient_dose_events
 for each row execute function public._medicine_ask_on_tick('plan');

-- 3. The member -----------------------------------------------------------------------------------------------------------

-- Name and dose of an ask's medicine, as the member and their care team see it.
create function public._medicine_ask_medicine(p_source text,p_medicine uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select case p_source
  when 'self'then(select jsonb_build_object('name',name,'dose',dose)from public.member_medicines where id=p_medicine)
  else(select jsonb_build_object('name',name,'dose',dose)from public.patient_care_medications where id=p_medicine)end
$$;

create function public._medicine_ask_json(a public.member_medicine_asks)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',a.id,'source',a.source,'medicineId',a.medicine_id,'dueAt',a.due_at,'trigger',a.trigger,'state',a.state,
  'reason',a.reason,'createdAt',a.created_at,'answeredAt',a.answered_at,
  'medicine',coalesce(public._medicine_ask_medicine(a.source,a.medicine_id),jsonb_build_object('name','','dose',null)),
  'careTeamAsked',exists(select 1 from public.member_medicine_concerns c where c.ask_id=a.id))
$$;

-- The member's open asks (newest first, at most 3), or {enabled:false}. Reading never opens one.
create function public.member_medicine_asks_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('version','medicine-asks-v1','enabled',false);end if;
 return jsonb_build_object('version','medicine-asks-v1','enabled',true,
  -- Eligibility now, not only when the ask opened (Astra MED-01): consent withdrawn, questions off or a takeover hide it.
  'asks',case when public._medicine_ask_blocked(uid)is not null then '[]'::jsonb else coalesce((select jsonb_agg(public._medicine_ask_json(a)order by a.created_at desc)from(
   select * from public.member_medicine_asks a where a.user_id=uid and a.state='open'and a.expires_at>clock_timestamp()
    order by a.created_at desc limit 3)a),'[]'::jsonb)end);
end$$;

-- The member's answer. Once per ask; the same answer again replays. Side effect or stopping puts a concern on the
-- doctor's list. {status:'answered',reason,next:'reminders'|'refill'|'doctor'} | {status:'not-found'|'closed'|'invalid'|'disabled'}.
create function public.member_medicine_ask_answer(p_ask uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();a public.member_medicine_asks;nxt text;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_reason is null or p_reason not in('forgot','side_effect','cost_or_availability','ran_out','decided_to_stop')then return jsonb_build_object('status','invalid');end if;
 select * into a from public.member_medicine_asks where id=p_ask and user_id=uid for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 nxt:=case p_reason when 'forgot'then 'reminders'when 'side_effect'then 'doctor'when 'decided_to_stop'then 'doctor'else 'refill'end;
 if a.state='answered'then
  if a.reason=p_reason then return jsonb_build_object('status','answered','reason',a.reason,'next',nxt,'replayed',true);end if;
  return jsonb_build_object('status','closed');
 end if;
 if a.state<>'open'or a.expires_at<=clock_timestamp()or public._medicine_ask_blocked(uid)is not null then return jsonb_build_object('status','closed');end if;
 update public.member_medicine_asks set state='answered',reason=p_reason,answered_at=clock_timestamp()where id=a.id;
 if p_reason in('side_effect','decided_to_stop')then
  insert into public.member_medicine_concerns(user_id,ask_id,kind)values(uid,a.id,p_reason);
 end if;
 return jsonb_build_object('status','answered','reason',p_reason,'next',nxt,'replayed',false);
end$$;

-- After "ran out" or "cost or availability", the member asks the care team about a refill (once per ask).
-- {status:'sent'|'already'|'not-found'|'invalid'|'disabled'}.
create function public.member_medicine_ask_care_team(p_ask uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();a public.member_medicine_asks;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 select * into a from public.member_medicine_asks where id=p_ask and user_id=uid for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 if a.state<>'answered'or a.reason not in('ran_out','cost_or_availability')or a.answered_at<clock_timestamp()-interval '48 hours'then return jsonb_build_object('status','invalid');end if;
 if public._medicine_ask_blocked(uid)is not null then return jsonb_build_object('status','closed');end if;
 if exists(select 1 from public.member_medicine_concerns where ask_id=a.id)then return jsonb_build_object('status','already');end if;
 insert into public.member_medicine_concerns(user_id,ask_id,kind)values(uid,a.id,'refill');
 return jsonb_build_object('status','sent');
end$$;

-- "Not now": the member closes an open ask without answering. It still counts for the 3-day limit. {status:'closed'|'not-found'}.
create function public.member_medicine_ask_dismiss(p_ask uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.uid()is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 update public.member_medicine_asks set state='withdrawn'where id=p_ask and user_id=auth.uid()and state='open';
 if found or exists(select 1 from public.member_medicine_asks where id=p_ask and user_id=auth.uid())then return jsonb_build_object('status','closed');end if;
 return jsonb_build_object('status','not-found');
end$$;

-- 4. The sweep (dispatcher, every 5 minutes) ------------------------------------------------------------------------------

insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.medicine_ask',1,'en','UNAPPROVED PLACEHOLDER. Zoe here. One of your medicine times was not ticked in Noreon. If something got in the way, you can tell me in one tap. No blame, life gets busy.'),
 ('member.medicine_ask',1,'hy','UNAPPROVED PLACEHOLDER. Զոին է։ Ձեր դեղերի ժամերից մեկը Noreon-ում նշված չէ։ Եթե ինչ-որ բան խանգարեց, կարող եք ինձ ասել մեկ հպումով։ Ոչինչ, կյանքը զբաղված է։');

-- Whether a queued ask notice may go now: null, or why not. One rule for the sweep and for the claim guard below.
create function public._medicine_ask_notice_hold(p_message uuid,p_now timestamptz)returns text
language sql stable security definer set search_path=''as $$
 select case when a.id is null then 'medicine_ask_unknown'
  when a.state<>'open'or a.expires_at<=p_now then 'medicine_ask_closed'
  when public._medicine_ask_blocked(a.user_id)is not null then 'medicine_ask_not_eligible'
  when not coalesce((select(p.preferences->>'medicationEnabled')::boolean from public.patient_reminder_preferences p where p.user_id=a.user_id),true)then 'medicine_ask_reminders_off'
  when public._member_quiet_now(a.user_id,(p_now at time zone 'Asia/Yerevan')::time)then 'medicine_ask_quiet_hours'
 end
 from(select 1)x left join public.member_notices n on n.telegram_message_id=p_message
  left join public.member_medicine_asks a on n.event_key='medicine_ask:'||a.id::text
$$;

-- Astra MED-02 (round 2): the claim itself refuses an ask notice that may not go now, so a notice is never sent when the
-- sweep's re-check below did not run or failed. The shared claim function is not replaced: this guard fires on the
-- outbox row's queued -> sending change, for this template only, and raises, which rolls the claim back (nothing is
-- sent; the row stays queued for the next sweep to hold, or expires). A failure in the check also refuses (fail closed).
create function public._medicine_ask_notice_claim_guard()returns trigger
language plpgsql security definer set search_path=''as $$
declare h text;
begin
 if old.state='queued'and new.state='sending'then
  h:=public._medicine_ask_notice_hold(new.id,clock_timestamp());
  if h is not null then raise exception using errcode='P0001',message='medicine ask notice refused: '||h;end if;
 end if;
 return new;
end$$;
create trigger medicine_ask_notice_claim_guard before update of state on public.telegram_auth_messages
 for each row when(new.template_id='member.medicine_ask')execute function public._medicine_ask_notice_claim_guard();

-- Opens asks for doses left unticked 4 to 24 hours after their time (engaged medicines only), then sends one notice per
-- open missed ask outside quiet hours. p_now is for tests.
create function public.member_medicine_asks_run(p_now timestamptz default null)returns jsonb
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

-- 5. The care team --------------------------------------------------------------------------------------------------------

-- Doses of one medicine in the last 14 days, as the member ticked them.
create function public._medicine_tick_counts(m uuid,p_source text,p_medicine uuid,p_since timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select case p_source when 'self'then
   (select jsonb_build_object('taken',count(*)filter(where status='taken'),'skipped',count(*)filter(where status='skipped'))
    from public.member_medicine_doses where medicine_id=p_medicine and due_at>=p_since)
  else(select jsonb_build_object('taken',count(*)filter(where status='taken'),'skipped',count(*)filter(where status='skipped'))
    from public.patient_dose_events where user_id=m and medication_id=p_medicine and due_at>=p_since)end
$$;

-- The assigned doctor's open medicine concerns (side effect, decided to stop, refill), oldest first, at most 200.
-- The summary is facts for the app to word: which medicine and dose time, the reason, and 14 days of ticks.
create function public.doctor_medicine_concerns()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;items jsonb;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 select coalesce(jsonb_agg(x order by x->>'createdAt',x->>'id'),'[]')into items from(
  select jsonb_build_object('id',c.id,'memberId',c.user_id,'memberName',coalesce(pr.display_name,''),'kind',c.kind,'createdAt',c.created_at,
   'ask',public._medicine_ask_json(a),
   'ticks14',public._medicine_tick_counts(c.user_id,a.source,a.medicine_id,clock_timestamp()-interval '14 days'))x
  from public.member_medicine_concerns c join public.member_medicine_asks a on a.id=c.ask_id
  join public.patient_clinical_cases k on k.user_id=c.user_id
  left join public.profiles pr on pr.id=c.user_id
  where c.state='open'and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)
  order by c.created_at,c.id limit 200)q;
 perform public._access_audit_record(m,'doctor_inbox','medicine_concerns')from(select distinct(x->>'memberId')::uuid m from jsonb_array_elements(items)x)q;
 return jsonb_build_object('ok',true,'items',items);
end$$;

-- The assigned doctor marks a concern handled (they answered the member). {ok:true,replayed} | {ok:false,code:'not_found'}.
create function public.doctor_medicine_concern_handle(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;c public.member_medicine_concerns;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 select * into c from public.member_medicine_concerns where id=p_id for update;
 if not found or not exists(select 1 from public.patient_clinical_cases k where k.user_id=c.user_id and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  return jsonb_build_object('ok',false,'code','not_found');end if;
 if c.state='handled'then return jsonb_build_object('ok',true,'replayed',true);end if;
 update public.member_medicine_concerns set state='handled',handled_at=clock_timestamp(),handled_by=me where id=c.id;
 perform public._access_audit_record(c.user_id,'doctor_inbox','medicine_concern.handled');
 return jsonb_build_object('ok',true,'replayed',false);
end$$;

-- The reasons a member gave in the last p_days days (1 to 60), for the assigned nurse and doctor (as member_medicines_staff_read).
create function public.member_medicine_reasons_staff_read(p_member uuid,p_days integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare since timestamptz;
begin
 if(select not enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('version','medicine-asks-v1','enabled',false);end if;
 perform public._patient_visit_authorize(p_member,false,false);
 if p_days is null or p_days not between 1 and 60 then raise invalid_parameter_value;end if;
 since:=public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date-p_days+1,'00:00');
 return jsonb_build_object('version','medicine-asks-v1','enabled',true,
  'reasons',coalesce((select jsonb_agg(jsonb_build_object('source',a.source,'medicineId',a.medicine_id,'dueAt',a.due_at,'trigger',a.trigger,'reason',a.reason,
    'answeredAt',a.answered_at,'concern',(select c.state from public.member_medicine_concerns c where c.ask_id=a.id))order by a.due_at desc)
   from public.member_medicine_asks a where a.user_id=p_member and a.state='answered'and a.due_at>=since),'[]'::jsonb));
end$$;

revoke all on function public._medicine_ask_notice_hold(uuid,timestamptz),public._medicine_ask_notice_claim_guard()from public,anon,authenticated,service_role;
revoke all on function public._medicine_ask_blocked(uuid),public._medicine_ask_open(uuid,text,uuid,timestamptz,text,timestamptz),public._medicine_ask_on_tick(),
 public._medicine_ask_medicine(text,uuid),public._medicine_ask_json(public.member_medicine_asks),public.member_medicine_asks_read(),
 public.member_medicine_ask_answer(uuid,text),public.member_medicine_ask_care_team(uuid),public.member_medicine_ask_dismiss(uuid),public.member_medicine_asks_run(timestamptz),
 public._medicine_tick_counts(uuid,text,uuid,timestamptz),public.doctor_medicine_concerns(),public.doctor_medicine_concern_handle(uuid),
 public.member_medicine_reasons_staff_read(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_asks_read(),public.member_medicine_ask_answer(uuid,text),public.member_medicine_ask_care_team(uuid),public.member_medicine_ask_dismiss(uuid),
 public.doctor_medicine_concerns(),public.doctor_medicine_concern_handle(uuid),public.member_medicine_reasons_staff_read(uuid,integer)to authenticated;
grant execute on function public.member_medicine_asks_run(timestamptz)to service_role;
