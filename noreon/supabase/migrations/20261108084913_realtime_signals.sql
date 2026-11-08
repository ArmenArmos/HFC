-- WP R: realtime signals (Supabase Realtime over WebSockets) for the chats and in-chat notices.
--
-- A signal says only "something you can read changed": the recipient's user id, a kind and an opaque id
-- (a conversation, card, alert, task, booking or member id). It never carries health content (no text,
-- values, names or states). The browser re-reads through the existing RPCs, which stay the only source of
-- truth (versions, pollMayReplace, access audit); the signal only wakes that read early.
--
-- 1. public.realtime_signals: RLS select only where recipient_user_id = auth.uid(); no other grant.
-- 2. Only this table is added to the supabase_realtime publication (created here when absent, as on a
--    plain local Postgres; on hosted Supabase it exists and is empty).
-- 3. public._realtime_signal(recipient, kind, ref): internal writer, one row per recipient, kind and ref
--    per transaction, and it never raises.
-- 4. AFTER triggers on the tables that drive the member, caregiver, nurse, physician, coordinator,
--    administrator and clinic chats. Every trigger swallows its own errors: a signal can never make the
--    original write fail.
-- 5. public.realtime_signals_prune(p_limit): service-role retention (signals older than 2 days), run by
--    the /api/internal/realtime-signals cron.
-- 6. Rate limit policy for the token route (/api/realtime/token): realtime_token.

-- 1. The table ---------------------------------------------------------------------------------------------------------
create table public.realtime_signals(
 id bigint generated always as identity primary key,
 recipient_user_id uuid not null,
 kind text not null,
 ref_id text,
 created_at timestamptz not null default now(),
 constraint realtime_signals_kind_check check(kind in('member_thread','member_cards','staff_thread','staff_notice','care_alert','worklist','clinic_thread','caregiver_notice')),
 -- An opaque id only (uuid or a short key), so no free text can ride along.
 constraint realtime_signals_ref_check check(ref_id is null or ref_id~'^[A-Za-z0-9:_-]{1,80}$')
);
comment on table public.realtime_signals is 'WP R: ids and kinds only, never health content. Wakes a client re-read; retention 2 days.';
create index realtime_signals_recipient on public.realtime_signals(recipient_user_id,id);
create index realtime_signals_created on public.realtime_signals(created_at);
alter table public.realtime_signals enable row level security;
revoke all on public.realtime_signals from public,anon,authenticated,service_role;
revoke all on sequence public.realtime_signals_id_seq from public,anon,authenticated,service_role;
-- Realtime evaluates postgres_changes with the subscriber's JWT: it needs select, and the policy narrows it.
grant select on public.realtime_signals to authenticated;
create policy realtime_signals_recipient_select on public.realtime_signals for select to authenticated
 using(recipient_user_id=(select auth.uid()));

-- 2. Publication: this table only --------------------------------------------------------------------------------------
do $migration$
begin
 if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')then
  create publication supabase_realtime;
 end if;
 -- A publication for all tables would stream every health table; refuse rather than join it.
 if(select puballtables from pg_catalog.pg_publication where pubname='supabase_realtime')then
  raise exception 'supabase_realtime publishes all tables; realtime signals need a table-scoped publication';
 end if;
 if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='realtime_signals')then
  alter publication supabase_realtime add table public.realtime_signals;
 end if;
end $migration$;

-- 3. The writer -------------------------------------------------------------------------------------------------------
create function public._realtime_signal(p_recipient uuid,p_kind text,p_ref text)returns void
language plpgsql volatile security definer set search_path=''as $$
declare sent text;key text;
begin
 if p_recipient is null then return;end if;
 -- One signal per recipient, kind and ref per transaction: every change of a transaction is visible at
 -- its commit, which is when the signal is delivered. The list is transaction-local (set_config ... true).
 key:=p_kind||'/'||p_recipient::text||'/'||coalesce(p_ref,'')||';';
 sent:=coalesce(current_setting('noreon.realtime_sent',true),'');
 if position(key in sent)>0 then return;end if;
 insert into public.realtime_signals(recipient_user_id,kind,ref_id)values(p_recipient,p_kind,p_ref);
 if length(sent)<16000 then perform set_config('noreon.realtime_sent',sent||key,true);end if;
exception when others then
 -- A signal is a hint; the original write always wins.
 return;
end$$;
revoke all on function public._realtime_signal(uuid,text,text)from public,anon,authenticated,service_role;

-- The member's care team: assigned family physician, cardiologist and nurse (ids only).
create function public._realtime_care_team(p_member uuid)returns setof uuid
language sql stable security definer set search_path=''as $$
 select x from public.patient_clinical_cases c,
  lateral unnest(array[c.assigned_doctor_id,c.assigned_cardiologist_id,c.assigned_nurse_id])x
 where c.user_id=p_member and x is not null
$$;
revoke all on function public._realtime_care_team(uuid)from public,anon,authenticated,service_role;

-- Caregivers who may receive alerts about this member (WP F _caregiver_can: active link, scope, good standing).
create function public._realtime_caregivers(p_member uuid)returns setof uuid
language sql stable security definer set search_path=''as $$
 select l.caregiver_user_id from public.member_caregivers l
 where l.member_id=p_member and l.status='active' and l.caregiver_user_id is not null
  and public._caregiver_can(p_member,l.caregiver_user_id,'receive_alerts')
$$;
revoke all on function public._realtime_caregivers(uuid)from public,anon,authenticated,service_role;

-- Noreon administrators, and the coordinators of one clinic (logistics queues).
create function public._realtime_operations(p_clinic uuid)returns setof uuid
language sql stable security definer set search_path=''as $$
 select s.user_id from public.workspace_staff s
 where s.active and s.removed_at is null
  and(s.role='admin' or(s.role='coordinator' and p_clinic is not null and s.clinic_id=p_clinic))
$$;
revoke all on function public._realtime_operations(uuid)from public,anon,authenticated,service_role;

-- A member thread changed: the member, and their care team on the staff side.
create function public._realtime_member_thread(p_member uuid,p_conversation uuid,p_caregivers boolean)returns void
language plpgsql volatile security definer set search_path=''as $$
declare r uuid;
begin
 if p_member is null then return;end if;
 perform public._realtime_signal(p_member,'member_thread',p_conversation::text);
 for r in select public._realtime_care_team(p_member) loop perform public._realtime_signal(r,'staff_thread',p_member::text);end loop;
 if p_caregivers then
  for r in select public._realtime_caregivers(p_member) loop perform public._realtime_signal(r,'caregiver_notice',p_member::text);end loop;
 end if;
exception when others then return;
end$$;
revoke all on function public._realtime_member_thread(uuid,uuid,boolean)from public,anon,authenticated,service_role;

-- 4. Triggers -----------------------------------------------------------------------------------------------------------
-- Member messages (app and Telegram) and Zoe's answers: member, care team, caregivers (receive_alerts) for messages.
create function public._realtime_conversation_row()returns trigger
language plpgsql security definer set search_path=''as $$
declare m uuid;
begin
 begin
  select c.member_id into m from public.conversations c where c.id=new.conversation_id;
  perform public._realtime_member_thread(m,new.conversation_id,tg_table_name='conversation_messages');
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_conversation_row()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert on public.conversation_messages for each row execute function public._realtime_conversation_row();
create trigger realtime_signal after insert on public.zoe_member_answers for each row execute function public._realtime_conversation_row();
create trigger realtime_signal after insert on public.conversation_nurse_replies for each row execute function public._realtime_conversation_row();
create trigger realtime_signal after insert on public.conversation_topic_breaks for each row execute function public._realtime_conversation_row();
create trigger realtime_signal after insert or update of state on public.conversation_deliveries for each row execute function public._realtime_conversation_row();

-- Care-team notices in the member's thread.
create function public._realtime_member_notice()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 begin perform public._realtime_signal(new.member_id,'member_thread',new.id::text);
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_member_notice()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert on public.member_notices for each row execute function public._realtime_member_notice();

-- Zoe chat cards: the member (cards refresh) and caregivers with receive_alerts.
create function public._realtime_chat_card()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;
begin
 begin
  perform public._realtime_signal(new.member_id,'member_cards',new.id::text);
  for r in select public._realtime_caregivers(new.member_id) loop perform public._realtime_signal(r,'caregiver_notice',new.member_id::text);end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_chat_card()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update on public.zoe_chat_cards for each row execute function public._realtime_chat_card();

-- Care alerts (doctor inbox P0, nurse urgent alerts): the alert's doctor and the care team; a new alert also
-- reaches caregivers with receive_alerts (their own surface decides what it may show).
create function public._realtime_care_alert()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;
begin
 begin
  for r in select x from(select new.doctor_id x union select public._realtime_care_team(new.member_id))t where x is not null loop
   perform public._realtime_signal(r,'care_alert',new.id::text);
  end loop;
  if tg_op='INSERT' then
   for r in select public._realtime_caregivers(new.member_id) loop perform public._realtime_signal(r,'caregiver_notice',new.member_id::text);end loop;
  end if;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_care_alert()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update of state,escalated_at,doctor_id on public.care_alerts for each row execute function public._realtime_care_alert();

-- Care queue tasks: the queue's owners (nurse, physicians, or administrators and the clinic's coordinators).
create function public._realtime_care_queue_task()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;c public.patient_clinical_cases;
begin
 begin
  select * into c from public.patient_clinical_cases where user_id=new.member_id;
  for r in select x from(
    select c.assigned_nurse_id x where new.queue='nurse'
    union select c.assigned_doctor_id where new.queue='physician'
    union select c.assigned_cardiologist_id where new.queue='physician'
    union select public._realtime_operations(public._case_clinic(new.member_id)) where new.queue='admin'
   )t where x is not null loop
   perform public._realtime_signal(r,'worklist',new.id::text);
  end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_care_queue_task()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update of status,queue on public.care_queue_tasks for each row execute function public._realtime_care_queue_task();

-- Staff message notices and notice links: the named staff recipient.
create function public._realtime_staff_notice()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 begin perform public._realtime_signal(new.recipient_id,'staff_notice',new.alert_id::text);
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_staff_notice()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert on public.staff_message_notices for each row execute function public._realtime_staff_notice();
create trigger realtime_signal after insert on public.staff_notice_links for each row execute function public._realtime_staff_notice();

-- Doctor inbox: a member message alert for the doctor.
create function public._realtime_doctor_alert()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 begin perform public._realtime_signal(new.doctor_id,'staff_notice',new.member_id::text);
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_doctor_alert()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert on public.conversation_doctor_alerts for each row execute function public._realtime_doctor_alert();

-- A nurse hands a conversation to the doctor: the care team's staff thread for that member.
create function public._realtime_nurse_handoff()returns trigger
language plpgsql security definer set search_path=''as $$
declare m uuid;r uuid;
begin
 begin
  select c.member_id into m from public.conversations c where c.id=new.conversation_id;
  for r in select public._realtime_care_team(m) loop perform public._realtime_signal(r,'staff_thread',m::text);end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_nurse_handoff()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert on public.conversation_nurse_handoffs for each row execute function public._realtime_nurse_handoff();

-- Coordination tasks (doctor to nurse handovers, administrator tasks): creator, owner, administrators and the
-- case clinic's coordinators.
create function public._realtime_coordination_task()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;
begin
 begin
  for r in select x from(select new.creator_id x union select new.owner_id union select public._realtime_operations(public._case_clinic(new.patient_case_id)))t where x is not null loop
   perform public._realtime_signal(r,'worklist',new.id::text);
  end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_coordination_task()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update of status,owner_id,revision on public.patient_coordination_tasks for each row execute function public._realtime_coordination_task();

-- Clinic chat: bookings at a clinic (requested, proposed, changed) and upload batches reach the clinic's active
-- portal members; booking changes also reach the Noreon administrators' operations chat.
create function public._realtime_clinic_members(p_clinic uuid)returns setof uuid
language sql stable security definer set search_path=''as $$
 select m.user_id from public.clinic_portal_memberships m where m.clinic_id=p_clinic and m.active
$$;
revoke all on function public._realtime_clinic_members(uuid)from public,anon,authenticated,service_role;
create function public._realtime_booking()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;clinic uuid;
begin
 begin
  for clinic in select distinct x from(values(new.current_arrangement->>'clinicId'),(new.proposed_arrangement->>'clinicId'))v(raw),
    lateral(select case when raw~'^[0-9a-fA-F-]{36}$' then raw::uuid end x)y where x is not null loop
   for r in select public._realtime_clinic_members(clinic) loop perform public._realtime_signal(r,'clinic_thread',new.id::text);end loop;
  end loop;
  for r in select public._realtime_operations(null) loop perform public._realtime_signal(r,'worklist',new.id::text);end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_booking()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update of status,revision on public.booking_appointments for each row execute function public._realtime_booking();
create function public._realtime_clinic_batch()returns trigger
language plpgsql security definer set search_path=''as $$
declare r uuid;
begin
 begin
  for r in select public._realtime_clinic_members(new.clinic_id) loop perform public._realtime_signal(r,'clinic_thread',new.id::text);end loop;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function public._realtime_clinic_batch()from public,anon,authenticated,service_role;
create trigger realtime_signal after insert or update of revision on public.clinic_batches for each row execute function public._realtime_clinic_batch();

-- 5. Retention ----------------------------------------------------------------------------------------------------------
create function public.realtime_signals_prune(p_limit integer default 5000)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare n integer;
begin
 if p_limit is null or p_limit<1 or p_limit>50000 then raise exception 'invalid limit' using errcode='22023';end if;
 with old as(select id from public.realtime_signals where created_at<now()-interval '2 days' order by id limit p_limit for update skip locked)
 delete from public.realtime_signals s using old where s.id=old.id;
 get diagnostics n=row_count;
 return jsonb_build_object('deleted',n,'more',n=p_limit);
end$$;
revoke all on function public.realtime_signals_prune(integer)from public,anon,authenticated,service_role;
grant execute on function public.realtime_signals_prune(integer)to service_role;

-- 6. Token route limits: a token lasts about an hour; a tab asks again before expiry and after a reconnect.
do $migration$
declare definition text;old text:=$old$('member_speech','user',60,60),$old$;
begin
 definition:=pg_get_functiondef('public._rate_limit_policy(text,text)'::regprocedure);
 if position('realtime_token' in definition)>0 then return;end if;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected rate policy';end if;
 execute replace(definition,old,old||E'\n  (''realtime_token'',''source'',600,3600),\n  (''realtime_token'',''user'',120,3600),');
end $migration$;
