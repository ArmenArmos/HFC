-- Care-team alerts (phase 16 plumbing; dark).
--
-- One alert model for every urgent source: a questionnaire red flag, a member message the
-- urgent-word matcher escalates, a lab result flagged critical, and Zoe. An alert is a
-- durable record that the care team has something urgent to look at. It never states that
-- anyone read it or that an ambulance was called; acknowledge and resolve are explicit
-- staff actions, audited and journaled.
--
-- Nothing here decides what is urgent. The questionnaire red flags are computed by the
-- clinical engine (RF-01..RF-12, red only); the word list is empty until S1 is signed; the
-- critical-lab rules await Q3. This file only records, de-duplicates, routes and audits.
--
-- Dark: no care_alert_settings row (or enabled=false) means nothing is raised. Telegram
-- delivery to enrolled staff is a second switch, and its wording is an unapproved
-- placeholder that the auth outbox holds at claim, so nothing is sent until it is approved.
-- Every decision writes a conversation trace event (step care_alert): identifiers and codes
-- only, never message text or the staff resolution note.

alter table public.conversation_trace_events drop constraint conversation_trace_events_step_check;
alter table public.conversation_trace_events add constraint conversation_trace_events_step_check
 check(step in('intake','auto_ack','doctor_alert','draft','approval','delivery','provider','link','zoe','care_alert'));

-- 1. Tables -------------------------------------------------------------------------------

create table public.care_alert_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 telegram_delivery boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);

create table public.care_alerts (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 source text not null check(source in('questionnaire','message','lab','zoe')),
 -- Only red reaches an alert today; the column exists so a later, signed-off level has a place.
 priority text not null default 'urgent'check(priority in('urgent')),
 reason_code text not null check(reason_code ~ '^[a-z0-9_.:-]{1,80}$'),
 red_flags text[] not null default '{}'check(red_flags <@ array['RF-01','RF-02','RF-03','RF-04','RF-05','RF-06','RF-07','RF-08','RF-09','RF-10','RF-11','RF-12']),
 rule_id text not null check(rule_id ~ '^[a-z0-9_.:-]{1,80}$'),
 rule_version text not null check(length(rule_version)between 1 and 80),
 -- The row that raised it: assessment id, conversation message id, lab result id or Zoe turn id.
 source_ref text not null check(source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 doctor_id uuid references auth.users(id) on delete set null,
 state text not null default 'open'check(state in('open','acknowledged','resolved')),
 state_seq bigint not null default 0,
 occurrences integer not null default 1 check(occurrences>0),
 last_seen_at timestamptz not null default clock_timestamp(),
 -- Staff are deactivated, not deleted; no foreign key so an account removal never blocks on history.
 acknowledged_by uuid,acknowledged_at timestamptz,
 resolved_by uuid,resolved_at timestamptz,
 resolution text check(resolution in('member_contacted','emergency_care_advised','no_action_needed','duplicate','other')),
 -- Staff-only; never journaled.
 resolution_note text check(length(resolution_note)<=1000),
 created_at timestamptz not null default clock_timestamp(),
 check((state='open')or(acknowledged_at is not null and acknowledged_by is not null)),
 check((state='resolved')=(resolved_at is not null and resolved_by is not null and resolution is not null))
);
-- One live alert per member and source: repeats add to it instead of opening another.
create unique index care_alerts_live on public.care_alerts(member_id,source)where state<>'resolved';
create index care_alerts_state on public.care_alerts(state,created_at desc);
create index care_alerts_doctor on public.care_alerts(doctor_id,state);

-- Which source rows were screened, so a sweep retries what it missed and never screens twice.
create table public.care_alert_screenings (
 source text not null check(source in('questionnaire','message','lab','zoe')),
 source_ref text not null check(source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 member_id uuid not null references auth.users(id) on delete cascade,
 outcome text not null check(outcome in('escalate','recorded','skipped')),
 reason_code text not null check(reason_code ~ '^[a-z0-9_.:-]{1,80}$'),
 red_flags text[] not null default '{}',
 rule_id text not null,rule_version text not null,
 alert_id uuid references public.care_alerts(id) on delete set null,
 screened_at timestamptz not null default clock_timestamp(),
 primary key(source,source_ref)
);

create table public.care_alert_deliveries (
 id uuid primary key default gen_random_uuid(),
 alert_id uuid not null references public.care_alerts(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 channel text not null check(channel='telegram'),
 telegram_message_id uuid unique references public.telegram_auth_messages(id),
 occurrence integer not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(alert_id,recipient_id,occurrence)
);

create table public.care_alert_audit (
 id bigint generated always as identity primary key,
 alert_id uuid not null references public.care_alerts(id) on delete cascade,
 actor_id uuid,kind text not null check(kind ~ '^[a-z_.]{1,60}$'),detail jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
-- Append-only, except when the member's account is deleted (the cascade from care_alerts).
create function public._care_alert_audit_immutable()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'and pg_trigger_depth()>1 then return old;end if;
 raise exception using errcode='55000',message='Care alert audit is append-only';end$$;
create trigger care_alert_audit_append_only before update or delete on public.care_alert_audit
 for each row execute function public._care_alert_audit_immutable();

-- Placeholder staff notice. No member name, no reason, no clinical detail: it only says
-- there is something to open. Held at claim (unapproved) until the wording is signed off.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('care_alert.staff_notice',1,'en','UNAPPROVED PLACEHOLDER. A priority alert is waiting in the Noreon staff app. Open Alerts to see it.'),
 ('care_alert.staff_notice',1,'hy','UNAPPROVED PLACEHOLDER. Noreon-ի աշխատակազմի հավելվածում առաջնահերթ ահազանգ կա։ Բացեք «Ահազանգեր» բաժինը։');

-- 2. Internals -----------------------------------------------------------------------------

create function public._care_alert_settings()returns public.care_alert_settings language sql stable security definer set search_path=''as $$
 select * from public.care_alert_settings where singleton
$$;

create function public._care_alert_trace(a public.care_alerts,p_name text,p_outcome text,p_reason text,p_actor_kind text,p_actor uuid,p_attrs jsonb)returns void
language sql security definer set search_path=''as $$
 select public._conversation_trace(a.member_id,null,'care_alert',a.id::text,'care_alert',p_name,p_outcome,p_reason,a.rule_id,a.rule_version,p_actor_kind,p_actor,
  jsonb_build_object('noreon.care_alert.source',a.source,'noreon.care_alert.priority',a.priority,'noreon.care_alert.state',a.state,
   'noreon.care_alert.red_flags',array_to_string(a.red_flags,','),'noreon.care_alert.occurrences',a.occurrences)||coalesce(p_attrs,'{}'))
$$;

-- Telegram notice to enrolled staff: the member's assigned doctor and every active admin
-- who has an active staff Telegram binding. Queued in the auth outbox, which holds
-- unapproved wording at claim; the decision is journaled either way.
create function public._care_alert_notify(a public.care_alerts)returns void
language plpgsql security definer set search_path=''as $$
declare s public.care_alert_settings:=public._care_alert_settings();r record;mid uuid;n integer:=0;eligible integer:=0;
begin
 if s.telegram_delivery is not true then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','telegram_delivery_off','system',null,'{}');return;end if;
 -- A repeat within 15 minutes of the last notice does not page staff again; the inbox shows the count.
 if a.occurrences>1 and exists(select 1 from public.care_alert_deliveries where alert_id=a.id and created_at>clock_timestamp()-interval '15 minutes')then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','recently_notified','system',null,'{}');return;end if;
 for r in select distinct on(ws.user_id)ws.user_id,b.address,b.principal_ref
  from public.workspace_staff ws join public.telegram_auth_bindings b on b.auth_user_id=ws.user_id and b.kind='staff'and b.active
  where ws.active and ws.removed_at is null and(ws.role='admin'or(ws.role='doctor'and ws.user_id=a.doctor_id))order by ws.user_id loop
  eligible:=eligible+1;
  if exists(select 1 from public.care_alert_deliveries where alert_id=a.id and recipient_id=r.user_id and occurrence=a.occurrences)then continue;end if;
  mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(r.user_id),r.address,r.principal_ref,null,null);
  if mid is null then continue;end if;
  insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)values(a.id,r.user_id,'telegram',mid,a.occurrences);
  n:=n+1;
 end loop;
 if n>0 then
  perform public._care_alert_trace(a,'care_alert.telegram_queued','queued',
   case when(select approved from public.system_message_templates where template_id='care_alert.staff_notice'order by version desc limit 1)is not true
    then 'queued_wording_unapproved_will_be_held'else 'staff_notice_queued'end,'system',null,jsonb_build_object('noreon.care_alert.recipients',n));
 else
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped',case when eligible=0 then 'no_enrolled_staff'else 'no_template_available'end,'system',null,'{}');
 end if;
end$$;

-- The single raise path. A live alert for the same member and source absorbs a repeat:
-- its red flags are merged (red stays red), the count goes up, an acknowledged alert is
-- reopened and staff are told again (at most once per 15 minutes on Telegram).
-- Never raises: on the questionnaire path an error would undo the member's saved answers.
create function public._care_alert_raise(p_member uuid,p_source text,p_reason text,p_red_flags text[],p_rule text,p_rule_version text,p_source_ref text)returns uuid
language plpgsql security definer set search_path=''as $$
declare a public.care_alerts;doc uuid;
begin
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=p_member;
 perform pg_advisory_xact_lock(hashtextextended('care-alert:'||p_member::text||':'||p_source,0));
 select * into a from public.care_alerts where member_id=p_member and source=p_source and state<>'resolved'for update;
 if found then
  -- New information reopens an acknowledged alert so it is looked at again.
  update public.care_alerts set occurrences=occurrences+1,last_seen_at=clock_timestamp(),state_seq=state_seq+1,state='open',
   red_flags=(select coalesce(array_agg(distinct f order by f),'{}')from unnest(red_flags||coalesce(p_red_flags,'{}'))f),
   doctor_id=coalesce(doc,doctor_id)where id=a.id returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'repeated',jsonb_build_object('sourceRef',p_source_ref,'reason',p_reason,'redFlags',p_red_flags));
  perform public._care_alert_trace(a,'care_alert.repeated','escalate',p_reason,'system',null,jsonb_build_object('noreon.care_alert.source_ref',p_source_ref));
 else
  insert into public.care_alerts(member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id)
  values(p_member,p_source,p_reason,coalesce(p_red_flags,'{}'),p_rule,p_rule_version,p_source_ref,doc)returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'raised',jsonb_build_object('sourceRef',p_source_ref,'reason',p_reason,'redFlags',p_red_flags,'doctorId',doc));
  perform public._care_alert_trace(a,'care_alert.raised','escalate',p_reason,'system',null,
   jsonb_build_object('noreon.care_alert.source_ref',p_source_ref,'noreon.doctor.id',doc,'noreon.care_alert.assigned_doctor',doc is not null));
 end if;
 perform public._care_alert_notify(a);
 return a.id;
end$$;

-- Record one screening decision (journaled) and raise when it escalates. Idempotent per
-- source row: a second call for the same row returns the first result.
create function public._care_alert_screen(p_member uuid,p_source text,p_source_ref text,p_outcome text,p_reason text,p_red_flags text[],p_rule text,p_rule_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prev public.care_alert_screenings;aid uuid;
begin
 select * into prev from public.care_alert_screenings where source=p_source and source_ref=p_source_ref;
 if found then return jsonb_build_object('ok',true,'replayed',true,'outcome',prev.outcome,'alertId',prev.alert_id);end if;
 insert into public.care_alert_screenings(source,source_ref,member_id,outcome,reason_code,red_flags,rule_id,rule_version)
 values(p_source,p_source_ref,p_member,p_outcome,p_reason,coalesce(p_red_flags,'{}'),p_rule,p_rule_version)on conflict do nothing;
 if not found then return jsonb_build_object('ok',true,'replayed',true);end if;
 perform public._conversation_trace(p_member,null,'care_alert_screening',p_source||':'||p_source_ref,'care_alert','care_alert.screened',p_outcome,p_reason,p_rule,p_rule_version,'system',null,
  jsonb_build_object('noreon.care_alert.source',p_source,'noreon.care_alert.red_flags',array_to_string(coalesce(p_red_flags,'{}'),',')));
 if p_outcome='escalate'then
  aid:=public._care_alert_raise(p_member,p_source,p_reason,p_red_flags,p_rule,p_rule_version,p_source_ref);
  update public.care_alert_screenings set alert_id=aid where source=p_source and source_ref=p_source_ref;
 end if;
 return jsonb_build_object('ok',true,'replayed',false,'outcome',p_outcome,'alertId',aid);
end$$;

-- 3. Hook: questionnaire red flag ---------------------------------------------------------

-- The clinical engine already computed the red flag (firesEmergency, red only) and the
-- member's save stored its id in urgent_rule. This journals that decision and raises an
-- alert when a red flag newly appears. The member's own urgent screen is unchanged.
create function public._care_alert_screen_assessment(a public.patient_assessments)returns jsonb
language sql security definer set search_path=''as $$
 select case when a.urgent_rule ~ '^RF-(0[1-9]|1[0-2])$'
  then public._care_alert_screen(a.user_id,'questionnaire',a.id::text||':'||a.revision,'escalate','questionnaire_red_flag',array[a.urgent_rule],'clinical.red_flag',a.algorithm_version)
  -- Unknown code: journal it and still alert, because the engine only stores red flags here.
  else public._care_alert_screen(a.user_id,'questionnaire',a.id::text||':'||a.revision,'escalate','questionnaire_unknown_rule',null,'clinical.red_flag',a.algorithm_version)end
$$;

create function public._care_alert_from_assessment()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.urgent_rule is null or(tg_op='UPDATE'and old.urgent_rule is not distinct from new.urgent_rule)then return null;end if;
 if(public._care_alert_settings()).enabled is not true then return null;end if;
 begin
  perform public._care_alert_screen_assessment(new);
 exception when others then
  -- Never undo the member's answers. The failure is journaled, and care_alert_assessments_retry
  -- (run by every sweep) raises it later because no screening row was written.
  begin
   perform public._conversation_trace(new.user_id,null,'patient_assessment',new.id::text,'care_alert','care_alert.raise_failed','failed',
    'alert_not_recorded_will_retry','clinical.red_flag',new.algorithm_version,'system',null,jsonb_build_object('noreon.care_alert.source','questionnaire','noreon.error.sqlstate',sqlstate));
  exception when others then null;
  end;
 end;
 return null;
end$$;
create trigger care_alert_from_assessment after insert or update of urgent_rule on public.patient_assessments
 for each row execute function public._care_alert_from_assessment();

-- 4. Service entry points (member messages, lab, Zoe, questionnaire retry) ---------------

-- Questionnaire red flags whose raise failed in the trigger: a current red flag with no
-- screening that ever carried it and no live questionnaire alert already carrying it. A trigger failure leaves no
-- screening row, so it is retried; a success leaves one, so an unchanged flag is never
-- re-raised by time passing. The one-day bound on updated_at only limits the scan.
create function public.care_alert_assessments_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.patient_assessments;r jsonb;n integer:=0;f integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for a in select pa.* from public.patient_assessments pa where pa.urgent_rule is not null and pa.updated_at>clock_timestamp()-interval '1 day'
  and not exists(select 1 from public.care_alerts al where al.member_id=pa.user_id and al.source='questionnaire'and al.state<>'resolved'and pa.urgent_rule=any(al.red_flags))
  and not exists(select 1 from public.care_alert_screenings s where s.source='questionnaire'and s.member_id=pa.user_id
   and(pa.urgent_rule=any(s.red_flags)or s.reason_code='questionnaire_unknown_rule'))
  order by pa.updated_at limit greatest(1,least(coalesce(p_limit,20),50))loop
  begin
   r:=public._care_alert_screen_assessment(a);
   if(r->>'replayed')='false'then n:=n+1;end if;
  exception when others then f:=f+1;
  end;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f);
end$$;


-- Member messages not yet screened (Telegram and in-app), oldest first, within a day.
-- The text is returned only when the caller's word list is signed off (p_with_text);
-- otherwise the sweep journals "skipped" without reading anything.
create function public.care_alert_messages_pending(p_limit integer,p_with_text boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('messageId',q.id,'memberId',q.author_id,'text',case when p_with_text then q.body end)order by q.created_at,q.id)
  from(select m.id,m.author_id,m.body,m.created_at from public.conversation_messages m
   where m.created_at>clock_timestamp()-interval '1 day'
    and not exists(select 1 from public.care_alert_screenings s where s.source='message'and s.source_ref=m.id::text)
   order by m.created_at,m.id limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]');
end$$;

-- One screening result from the application (message matcher, critical-lab rules, Zoe).
-- Codes only. The member is re-derived for messages so a caller cannot misattribute one.
create function public.care_alert_screen(p_member uuid,p_source text,p_source_ref text,p_outcome text,p_reason text,p_red_flags text[],p_rule text,p_rule_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=p_member;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',false,'code','alerts_off');end if;
 if p_source is null or p_source not in('message','lab','zoe')or coalesce(p_source_ref,'')!~'^[A-Za-z0-9_.:-]{1,128}$'
  or p_outcome is null or p_outcome not in('escalate','recorded','skipped')
  or coalesce(p_reason,'')!~'^[a-z0-9_.:-]{1,80}$'or coalesce(p_rule,'')!~'^[a-z0-9_.:-]{1,80}$'or coalesce(length(p_rule_version),0)not between 1 and 80
  or not(coalesce(p_red_flags,'{}')<@ array['RF-01','RF-02','RF-03','RF-04','RF-05','RF-06','RF-07','RF-08','RF-09','RF-10','RF-11','RF-12'])
  or(p_outcome='escalate'and cardinality(coalesce(p_red_flags,'{}'))=0 and p_source<>'lab')
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_source='message'then
  begin
   select author_id into m from public.conversation_messages where id=p_source_ref::uuid;
  exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid');
  end;
  if m is null then return jsonb_build_object('ok',false,'code','unknown_message');end if;
 end if;
 if m is null or not exists(select 1 from auth.users where id=m)then return jsonb_build_object('ok',false,'code','unknown_member');end if;
 return public._care_alert_screen(m,p_source,p_source_ref,p_outcome,p_reason,p_red_flags,p_rule,p_rule_version);
end$$;

-- 5. Staff inbox ----------------------------------------------------------------------------

-- Admins see every alert; a doctor sees alerts for members assigned to them. Nurses and
-- clinic users do not use this inbox.
create function public._care_alert_actor()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare ws public.workspace_staff;
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 select * into ws from public.workspace_staff where user_id=auth.uid()and active and removed_at is null and role in('admin','doctor');
 if not found or not public._real_staff_managed_session_allowed(auth.uid())then raise insufficient_privilege using message='Active admin or doctor session required';end if;
 return jsonb_build_object('id',ws.user_id,'role',ws.role);
end$$;

create function public._care_alert_visible(a public.care_alerts,actor jsonb)returns boolean language sql stable security definer set search_path=''as $$
 select actor->>'role'='admin'or exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id and c.assigned_doctor_id=(actor->>'id')::uuid)
$$;

create function public._care_alert_json(a public.care_alerts)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',a.id,'memberId',a.member_id,'memberName',coalesce((select display_name from public.profiles where id=a.member_id),''),
  'source',a.source,'priority',a.priority,'reason',a.reason_code,'redFlags',to_jsonb(a.red_flags),'state',a.state,'stateSeq',a.state_seq,
  'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,
  'doctorName',(select display_name from public.workspace_staff where user_id=a.doctor_id),
  'acknowledgedAt',a.acknowledged_at,'acknowledgedBy',(select display_name from public.workspace_staff where user_id=a.acknowledged_by),
  'resolvedAt',a.resolved_at,'resolvedBy',(select display_name from public.workspace_staff where user_id=a.resolved_by),
  'resolution',a.resolution,'resolutionNote',a.resolution_note,
  'telegram',coalesce((select jsonb_agg(jsonb_build_object('recipient',coalesce(ws.display_name,''),'state',tm.state,'reason',tm.reason)order by d.created_at)
   from public.care_alert_deliveries d join public.telegram_auth_messages tm on tm.id=d.telegram_message_id left join public.workspace_staff ws on ws.user_id=d.recipient_id
   where d.alert_id=a.id and d.occurrence=a.occurrences),'[]'))
$$;

create function public.care_alert_inbox(p_view text default 'live',p_limit integer default 100)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();
begin
 if p_view is null or p_view not in('live','resolved')then return jsonb_build_object('ok',false,'code','invalid');end if;
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'role',actor->>'role','alerts',coalesce((select jsonb_agg(public._care_alert_json(a)order by(a.state='open')desc,a.last_seen_at desc)
  from(select * from public.care_alerts a where(case when p_view='live'then a.state<>'resolved'else a.state='resolved'end)and public._care_alert_visible(a,actor)
   order by a.last_seen_at desc limit greatest(1,least(coalesce(p_limit,100),200)))a),'[]'));
end$$;

-- Optimistic: the caller passes the stateSeq it saw. A repeat that arrived meanwhile bumps
-- it, so staff never acknowledge or resolve something they have not seen.
create function public.care_alert_acknowledge(p_alert uuid,p_expected_seq bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();a public.care_alerts;
begin
 select * into a from public.care_alerts where id=p_alert for update;
 if not found or not public._care_alert_visible(a,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 if a.state<>'open'then return jsonb_build_object('ok',true,'changed',false,'alert',public._care_alert_json(a));end if;
 if a.state_seq is distinct from p_expected_seq then return jsonb_build_object('ok',false,'code','changed','alert',public._care_alert_json(a));end if;
 update public.care_alerts set state='acknowledged',acknowledged_by=(actor->>'id')::uuid,acknowledged_at=clock_timestamp(),state_seq=state_seq+1 where id=a.id returning * into a;
 insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'acknowledged',jsonb_build_object('role',actor->>'role'));
 perform public._care_alert_trace(a,'care_alert.acknowledged','recorded','staff_acknowledged',public._conversation_trace_actor(),(actor->>'id')::uuid,'{}');
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));
end$$;

create function public.care_alert_resolve(p_alert uuid,p_expected_seq bigint,p_resolution text,p_note text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();a public.care_alerts;note text:=nullif(btrim(p_note),'');
begin
 if p_resolution is null or p_resolution not in('member_contacted','emergency_care_advised','no_action_needed','duplicate','other')
  or length(note)>1000 or(p_resolution='other'and note is null)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into a from public.care_alerts where id=p_alert for update;
 if not found or not public._care_alert_visible(a,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 if a.state='resolved'then return jsonb_build_object('ok',true,'changed',false,'alert',public._care_alert_json(a));end if;
 if a.state_seq is distinct from p_expected_seq then return jsonb_build_object('ok',false,'code','changed','alert',public._care_alert_json(a));end if;
 update public.care_alerts set state='resolved',
  acknowledged_by=coalesce(acknowledged_by,(actor->>'id')::uuid),acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),
  resolved_by=(actor->>'id')::uuid,resolved_at=clock_timestamp(),resolution=p_resolution,resolution_note=note,state_seq=state_seq+1
 where id=a.id returning * into a;
 insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'resolved',jsonb_build_object('role',actor->>'role','resolution',p_resolution,'note',note is not null));
 perform public._care_alert_trace(a,'care_alert.resolved','recorded',p_resolution,public._conversation_trace_actor(),(actor->>'id')::uuid,
  jsonb_build_object('noreon.care_alert.note_written',note is not null));
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));
end$$;

create function public.care_alert_audit_log(p_alert uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();a public.care_alerts;
begin
 select * into a from public.care_alerts where id=p_alert;
 if not found or not public._care_alert_visible(a,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true,'events',coalesce((select jsonb_agg(jsonb_build_object('at',e.created_at,'kind',e.kind,'actor',ws.display_name)order by e.id)
  from public.care_alert_audit e left join public.workspace_staff ws on ws.user_id=e.actor_id where e.alert_id=a.id),'[]'));
end$$;

-- 6. Telegram outcome of staff notices, journaled on the alert --------------------------

create function public._trace_care_alert_notice()returns trigger language plpgsql security definer set search_path=''as $$
declare a public.care_alerts;
begin
 if new.state is not distinct from old.state or new.state not in('held','accepted_by_provider','definitely_failed','unknown')then return null;end if;
 select al.* into a from public.care_alert_deliveries d join public.care_alerts al on al.id=d.alert_id where d.telegram_message_id=new.id;
 if not found then return null;end if;
 perform public._care_alert_trace(a,'care_alert.telegram_'||new.state,case new.state when 'accepted_by_provider'then 'sent'when 'definitely_failed'then 'failed'else new.state end,
  coalesce(new.reason,new.state),case when new.state='held'then 'system'else 'provider'end,null,jsonb_build_object('messaging.system','telegram'));
 return null;
end$$;
create trigger care_alert_notice_trace after update of state on public.telegram_auth_messages
 for each row execute function public._trace_care_alert_notice();

-- 7. RLS and grants -------------------------------------------------------------------------

alter table public.care_alert_settings enable row level security;
alter table public.care_alerts enable row level security;
alter table public.care_alert_screenings enable row level security;
alter table public.care_alert_deliveries enable row level security;
alter table public.care_alert_audit enable row level security;
revoke all on public.care_alert_settings,public.care_alerts,public.care_alert_screenings,public.care_alert_deliveries,public.care_alert_audit from public,anon,authenticated,service_role;
revoke all on sequence public.care_alert_audit_id_seq from public,anon,authenticated,service_role;
revoke all on function public._care_alert_audit_immutable(),public._care_alert_settings(),
 public._care_alert_trace(public.care_alerts,text,text,text,text,uuid,jsonb),public._care_alert_notify(public.care_alerts),
 public._care_alert_raise(uuid,text,text,text[],text,text,text),public._care_alert_screen(uuid,text,text,text,text,text[],text,text),
 public._care_alert_from_assessment(),public._care_alert_screen_assessment(public.patient_assessments),public.care_alert_assessments_retry(integer),public.care_alert_messages_pending(integer,boolean),public.care_alert_screen(uuid,text,text,text,text,text[],text,text),
 public._care_alert_actor(),public._care_alert_visible(public.care_alerts,jsonb),public._care_alert_json(public.care_alerts),
 public.care_alert_inbox(text,integer),public.care_alert_acknowledge(uuid,bigint),public.care_alert_resolve(uuid,bigint,text,text),public.care_alert_audit_log(uuid),
 public._trace_care_alert_notice()
 from public,anon,authenticated,service_role;
grant execute on function public.care_alert_assessments_retry(integer),public.care_alert_messages_pending(integer,boolean),public.care_alert_screen(uuid,text,text,text,text,text[],text,text)to service_role;
grant execute on function public.care_alert_inbox(text,integer),public.care_alert_acknowledge(uuid,bigint),public.care_alert_resolve(uuid,bigint,text,text),public.care_alert_audit_log(uuid)to authenticated;
