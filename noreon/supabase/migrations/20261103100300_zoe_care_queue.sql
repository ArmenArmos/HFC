-- Care queue tasks with deadlines, and a sandbox for test accounts (dark).
--
-- patient_coordination_tasks needs a human creator and owner, and care_alerts is urgent-only:
-- doctor inbox counts treat every row there as top priority. So non-urgent Zoe work gets one small
-- table of its own. Neither of those tables changes, and red still raises a care_alerts row
-- through the existing path. No caller raises a task yet.
--
-- Nothing here decides a zone, a queue or a deadline: lib/clinical/zones does. This only stores,
-- de-duplicates, routes and audits. The admin queue holds logistics only and never clinical
-- content: an admin task says what to do through reason_code and suggested_action.

alter table public.care_alert_settings add column sandbox_test_accounts boolean not null default false;

create table public.care_queue_tasks (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 queue text not null check(queue in('nurse','physician','admin')),
 zone text check(zone in('yellow','orange','red')),
 reason_code text not null check(reason_code ~ '^[a-z0-9_.:-]{1,80}$'),
 rule_version text not null check(length(rule_version)between 1 and 80),
 red_flags_status text check(red_flags_status in('cleared','unknown','positive')),
 suggested_action text check(suggested_action ~ '^[a-z0-9_.:-]{1,80}$'),
 -- Structured snapshot only: codes and values, never free text from a conversation.
 summary jsonb not null default '{}'check(jsonb_typeof(summary)='object'),
 sla_deadline timestamptz,
 -- The row that raised it. One task per member, queue and source, so a replay never doubles one.
 source_ref text not null check(source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 status text not null default 'sent'check(status in('sent','seen','answered','closed')),
 -- Staff are deactivated, not deleted; no foreign key so an account removal never blocks on history.
 seen_at timestamptz,seen_by uuid,
 answered_at timestamptz,answered_by uuid,
 closed_at timestamptz,closed_by uuid,
 state_seq bigint not null default 0,
 sandbox boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(member_id,queue,source_ref),
 check((queue='admin')=(zone is null)),
 check(queue<>'admin'or summary='{}'),
 check(queue<>'admin'or red_flags_status is null),
 -- Fixed logistics words only: a free code could carry clinical meaning ("chest pain") to the admin.
 check(queue<>'admin'or reason_code in('lab_booking_needed','lab_reschedule','fasting_failed','lab_no_show','missing_baseline_labs','followup_labs_due')),
 check(queue<>'admin'or suggested_action is null or suggested_action in('rebook','book')),
 check(queue='admin'or sla_deadline is not null),
 check(status='sent'or(seen_at is not null and seen_by is not null)),
 check(status not in('answered','closed')or(answered_at is not null and answered_by is not null)),
 check((status='closed')=(closed_at is not null and closed_by is not null))
);
create index care_queue_tasks_open on public.care_queue_tasks(queue,sandbox,sla_deadline)where status in('sent','seen');
create index care_queue_tasks_member on public.care_queue_tasks(member_id,created_at desc);

create table public.care_queue_task_events (
 id bigint generated always as identity primary key,
 task_id uuid not null references public.care_queue_tasks(id) on delete cascade,
 from_status text check(from_status in('sent','seen','answered')),
 to_status text not null check(to_status in('sent','seen','answered','closed')),
 actor_id uuid,
 at timestamptz not null default clock_timestamp()
);
create index care_queue_task_events_task on public.care_queue_task_events(task_id,id);
-- Append-only, except when the member's account is deleted (the cascade from care_queue_tasks).
create function public._care_queue_event_immutable()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'and pg_trigger_depth()>1 then return old;end if;
 raise exception using errcode='55000',message='Care queue events are append-only';end$$;
create trigger care_queue_task_events_append_only before update or delete on public.care_queue_task_events
 for each row execute function public._care_queue_event_immutable();

alter table public.care_queue_tasks enable row level security;
alter table public.care_queue_task_events enable row level security;
revoke all on public.care_queue_tasks,public.care_queue_task_events from public,anon,authenticated,service_role;
revoke all on sequence public.care_queue_task_events_id_seq from public,anon,authenticated,service_role;

-- Internals -------------------------------------------------------------------------------

-- _care_alert_actor allows only admin and doctor. real_clinical_staff_identity carries the same
-- active, live clinic and managed-session checks (_real_staff_managed_session_allowed) for nurses too.
create function public._care_queue_actor()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare who jsonb;
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 who:=public.real_clinical_staff_identity();
 if who is null or who->>'role'is null or who->>'role'not in('nurse','doctor','admin')then
  raise insufficient_privilege using message='Active nurse, doctor or admin session required';end if;
 return jsonb_build_object('id',who->>'id','role',who->>'role');
end$$;

-- A nurse never gets logistics and an admin never gets clinical content.
-- Could this person open the queue, as _care_queue_actor admits them: right role, active, not removed, live clinic.
-- The session is not part of it: this asks whether someone can receive a task, not who is signed in now.
create function public._care_queue_eligible(p_user uuid,p_role text)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.workspace_staff ws where ws.user_id=p_user and ws.role=p_role and ws.active and ws.removed_at is null
  and(ws.role='admin'or exists(select 1 from public.workspace_clinics k where k.id=ws.clinic_id and k.active)))
$$;

create function public._care_queue_visible(t public.care_queue_tasks,actor jsonb)returns boolean language sql stable security definer set search_path=''as $$
 select case actor->>'role'
  when 'admin'then t.queue='admin'
  when 'nurse'then t.queue='nurse'and exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_nurse_id=(actor->>'id')::uuid)
  -- A member with no eligible nurse: their nurse tasks go to the doctor, so a task never reaches nobody.
  when 'doctor'then exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_doctor_id=(actor->>'id')::uuid
   and(t.queue='physician'or(t.queue='nurse'and not public._care_queue_eligible(c.assigned_nurse_id,'nurse'))))
  else false end
$$;

create function public._care_queue_json(t public.care_queue_tasks)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',t.id,'memberId',t.member_id,'memberName',coalesce((select display_name from public.profiles where id=t.member_id),''),
  'queue',t.queue,'zone',t.zone,'reason',t.reason_code,'ruleVersion',t.rule_version,'redFlagsStatus',t.red_flags_status,'suggestedAction',t.suggested_action,
  'summary',t.summary,'slaDeadline',t.sla_deadline,'status',t.status,'stateSeq',t.state_seq,'sandbox',t.sandbox,'createdAt',t.created_at,
  'seenAt',t.seen_at,'answeredAt',t.answered_at)
$$;

-- What care_queue_mark answers. Never a snapshot: only inbox reads return clinical content, and those are audited.
create function public._care_queue_mark_result(t public.care_queue_tasks,p_ok boolean,p_code text)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('ok',p_ok,'code',p_code,'id',t.id,'status',t.status,'stateSeq',t.state_seq)
$$;

-- Service entry point ---------------------------------------------------------------------

-- Never raises on bad input: this runs beside a member's chat turn, which must not fail for it.
-- A replay of the same member, queue and source returns the row that is already there. The admin
-- vocabulary is a table check, so a clinical code lands in the handler below as invalid.
create function public.care_queue_raise(p_member uuid,p_queue text,p_zone text,p_reason text,p_rule_version text,p_red_flags text,p_action text,p_summary jsonb,p_sla timestamptz,p_source_ref text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare t public.care_queue_tasks;test boolean;s jsonb:=coalesce(p_summary,'{}'::jsonb);
begin
 if p_member is null or p_queue is null or p_queue not in('nurse','physician','admin')
  or p_reason is null or p_reason !~ '^[a-z0-9_.:-]{1,80}$'
  or p_rule_version is null or length(p_rule_version)not between 1 and 80
  or p_source_ref is null or p_source_ref !~ '^[A-Za-z0-9_.:-]{1,128}$'
  or(p_action is not null and p_action !~ '^[a-z0-9_.:-]{1,80}$')
  or(p_red_flags is not null and p_red_flags not in('cleared','unknown','positive'))
  or(p_zone is not null and p_zone not in('yellow','orange','red'))
  or jsonb_typeof(s)<>'object'or octet_length(s::text)>8192
  or(p_queue='admin')<>(p_zone is null)
  or(p_queue='admin'and(s<>'{}'::jsonb or p_red_flags is not null))
  or(p_queue<>'admin'and p_sla is null)
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not exists(select 1 from auth.users where id=p_member)then return jsonb_build_object('ok',false,'code','member_not_found');end if;
 -- Refuse rather than store a task nobody can read: the caller must not tell the member it was sent.
 if p_queue<>'admin'and not exists(select 1 from public.patient_clinical_cases c where c.user_id=p_member
  and(public._care_queue_eligible(c.assigned_doctor_id,'doctor')or(p_queue='nurse'and public._care_queue_eligible(c.assigned_nurse_id,'nurse'))))
 then return jsonb_build_object('ok',false,'code','no_care_team');end if;
 select is_test_account into test from public.profiles where id=p_member;
 insert into public.care_queue_tasks(member_id,queue,zone,reason_code,rule_version,red_flags_status,suggested_action,summary,sla_deadline,source_ref,sandbox)
 values(p_member,p_queue,p_zone,p_reason,p_rule_version,p_red_flags,p_action,s,p_sla,p_source_ref,coalesce(test,false))
 on conflict(member_id,queue,source_ref)do nothing returning * into t;
 if not found then
  select * into t from public.care_queue_tasks where member_id=p_member and queue=p_queue and source_ref=p_source_ref;
  return jsonb_build_object('ok',true,'replayed',true,'task',public._care_queue_json(t));
 end if;
 insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id)values(t.id,null,'sent',null);
 return jsonb_build_object('ok',true,'replayed',false,'task',public._care_queue_json(t));
exception when check_violation or foreign_key_violation or not_null_violation then
 return jsonb_build_object('ok',false,'code','invalid');
end$$;

-- Member read -----------------------------------------------------------------------------

-- Only what the chip needs. Logistics reach the member through booking, so admin tasks stay out,
-- and a test account sees its own tasks so a tester can follow the whole journey.
create function public.care_queue_member_tasks()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();
begin
 if m is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'queue',t.queue,'status',t.status,'slaDeadline',t.sla_deadline,'createdAt',t.created_at)order by t.created_at desc,t.id)
  from(select * from public.care_queue_tasks where member_id=m and queue<>'admin'order by created_at desc,id limit 50)t),'[]'::jsonb));
end$$;

-- Staff inbox -----------------------------------------------------------------------------

-- Open work for this staff member. A task leaves the list once it is answered.
create function public.care_queue_inbox(p_queue text,p_view text default 'live')returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_queue_actor();tasks jsonb;item jsonb;
begin
 if p_view is null or p_view not in('live','sandbox')or p_queue is null or p_queue not in('nurse','physician','admin')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_queue<>(case actor->>'role'when 'admin'then 'admin'when 'nurse'then 'nurse'else 'physician'end)then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(public._care_queue_json(x)order by x.sla_deadline nulls last,x.created_at,x.id),'[]'::jsonb)into tasks from(
  select * from public.care_queue_tasks q where(q.queue=p_queue or(actor->>'role'='doctor'and q.queue='nurse'))and q.status in('sent','seen')and q.sandbox=(p_view='sandbox')and public._care_queue_visible(q,actor)
  order by q.sla_deadline nulls last,q.created_at,q.id limit 200)x;
 -- Clinical snapshots are recorded per member, as other staff clinical reads are. Admin rows carry none.
 if actor->>'role'<>'admin'then
  for item in select e from jsonb_array_elements(tasks)e loop
   perform public._access_audit_record((item->>'memberId')::uuid,'care_queue',item->>'id');
  end loop;
 end if;
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'role',actor->>'role','tasks',tasks);
end$$;

-- Optimistic: the caller passes the stateSeq it saw. Forward only, so a stale page can never
-- walk an answered task back to seen.
create function public.care_queue_mark(p_task uuid,p_expected_seq bigint,p_to text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_queue_actor();who uuid:=(actor->>'id')::uuid;t public.care_queue_tasks;prev text;
 steps constant text[]:=array['sent','seen','answered','closed'];
begin
 if p_task is null or p_to is null or p_to not in('seen','answered','closed')then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into t from public.care_queue_tasks where id=p_task for update;
 if not found or not public._care_queue_visible(t,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 if t.status=p_to then return public._care_queue_mark_result(t,true,'unchanged');end if;
 if array_position(steps,p_to)<array_position(steps,t.status)then return public._care_queue_mark_result(t,false,'backward');end if;
 if t.state_seq is distinct from p_expected_seq then return public._care_queue_mark_result(t,false,'changed');end if;
 prev:=t.status;
 update public.care_queue_tasks set status=p_to,state_seq=state_seq+1,
  seen_at=coalesce(seen_at,clock_timestamp()),seen_by=coalesce(seen_by,who),
  answered_at=case when p_to in('answered','closed')then coalesce(answered_at,clock_timestamp())end,
  answered_by=case when p_to in('answered','closed')then coalesce(answered_by,who)end,
  closed_at=case when p_to='closed'then clock_timestamp()end,
  closed_by=case when p_to='closed'then who end
 where id=t.id returning * into t;
 insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id)values(t.id,prev,p_to,who);
 return public._care_queue_mark_result(t,true,'moved');
end$$;

-- Test accounts and alerts ----------------------------------------------------------------

-- Off by default, so nothing changes until it is set. The alert row itself stays: only the
-- staff notice is skipped, and the reason is journaled.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._care_alert_notify(public.care_alerts)'::regprocedure);
 old:=$old$ -- A repeat within 15 minutes of the last notice does not page staff again; the inbox shows the count.$old$;
 replacement:=$new$ if s.sandbox_test_accounts is true and exists(select 1 from public.profiles where id=a.member_id and is_test_account)then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','test_account_sandbox','system',null,'{}');return;end if;
 -- A repeat within 15 minutes of the last notice does not page staff again; the inbox shows the count.$new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected _care_alert_notify definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;

revoke all on function public._care_queue_event_immutable(),public._care_queue_actor(),public._care_queue_eligible(uuid,text),public._care_queue_visible(public.care_queue_tasks,jsonb),public._care_queue_json(public.care_queue_tasks),public._care_queue_mark_result(public.care_queue_tasks,boolean,text),
 public.care_queue_raise(uuid,text,text,text,text,text,text,jsonb,timestamptz,text),public.care_queue_member_tasks(),public.care_queue_inbox(text,text),public.care_queue_mark(uuid,bigint,text)
 from public,anon,authenticated,service_role;
grant execute on function public.care_queue_raise(uuid,text,text,text,text,text,text,jsonb,timestamptz,text)to service_role;
grant execute on function public.care_queue_member_tasks(),public.care_queue_inbox(text,text),public.care_queue_mark(uuid,bigint,text)to authenticated;
