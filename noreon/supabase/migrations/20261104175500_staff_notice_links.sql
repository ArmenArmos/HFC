-- Slice 2d. Reserved stamp 20261104175500: recipient-bound, reusable staff notice links.
-- The outbox necessarily carries the URL; the notice registry retains only its SHA-256 hash.
create table public.staff_notice_links (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 recipient_id uuid not null references auth.users(id) on delete cascade,
 member_id uuid not null references auth.users(id) on delete cascade,
 alert_id uuid references public.care_alerts(id) on delete set null,
 expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
 created_at timestamptz not null default clock_timestamp(),
 last_used_at timestamptz
);
alter table public.staff_notice_links enable row level security;
revoke all on public.staff_notice_links from public,anon,authenticated,service_role;

-- ACL, rather than auth.role(), is intentional: definer enqueue functions also call this
-- while handling authenticated requests. Only the owner/enqueue path and service role may issue.
create function public.staff_notice_issue(p_recipient uuid,p_member uuid,p_alert uuid default null)returns text
language plpgsql volatile security definer set search_path=''as $$
declare token text:=encode(extensions.gen_random_bytes(24),'hex');
begin
 if p_alert is not null and not exists(select 1 from public.care_alerts where id=p_alert and member_id=p_member)then
  raise invalid_parameter_value using message='Notice target unavailable';
 end if;
 insert into public.staff_notice_links(token_hash,recipient_id,member_id,alert_id)
  values(encode(extensions.digest(token,'sha256'),'hex'),p_recipient,p_member,p_alert);
 return token;
end$$;
revoke all on function public.staff_notice_issue(uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.staff_notice_issue(uuid,uuid,uuid)to service_role;

create function public.staff_notice_resolve(p_token text)returns table(member_id uuid,alert_id uuid)
language plpgsql volatile security definer set search_path=''as $$
declare notice public.staff_notice_links;actor jsonb;allowed boolean:=false;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then return;end if;
 -- First reject without a lock; only eligible callers serialize with assignment changes.
 -- Repeat every check after locking, including expiry and current staff/session access.
 for authorization_pass in 1..2 loop
  if authorization_pass=2 then
   begin
    perform 1 from public.patient_clinical_cases c where c.user_id=notice.member_id for share;
   exception when others or query_canceled then allowed:=false;exit;
   end;
  end if;
  allowed:=false;
  select * into notice from public.staff_notice_links l
   where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if found and notice.recipient_id=auth.uid()and notice.expires_at>clock_timestamp()then
   actor:=public.real_clinical_staff_identity();
   if actor->>'role'='admin' then
    -- Existing care-alert admins can read all visible members; clinical roles must still be assigned.
    allowed:=not public._test_member_hidden(notice.member_id,auth.uid());
   elsif actor->>'role' in('doctor','nurse')then
    begin
     perform public._staff_zoe_assigned(notice.member_id);
     allowed:=not public._test_member_hidden(notice.member_id,auth.uid());
    exception when insufficient_privilege then allowed:=false;
    end;
   end if;
  end if;
  exit when not allowed;
 end loop;
 if not allowed then
  -- Refusals never record a target or token, even if the lookup found one. Identical empty result.
  insert into public.access_audit(actor_id,actor_role,surface,session_id)
   values(auth.uid(),'staff','staff_notice_refused',left(auth.jwt()->>'session_id',80));
  return;
 end if;
 update public.staff_notice_links set last_used_at=clock_timestamp()where token_hash=notice.token_hash;
 -- A staff member who is also the member still leaves one audit row for this staff read.
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(auth.uid(),actor->>'role',notice.member_id,'staff_notice_open',notice.alert_id::text,left(auth.jwt()->>'session_id',80));
 return query select notice.member_id,notice.alert_id;
end$$;
revoke all on function public.staff_notice_resolve(text)from public,anon,authenticated,service_role;
grant execute on function public.staff_notice_resolve(text)to authenticated;

-- Recreate the current bodies, retaining sandbox, routing, fallback, throttling and deduplication.
-- The only enqueue change is the neutral URL button. Template text and approvals are untouched.
create or replace function public._care_alert_notify(a public.care_alerts)returns void
language plpgsql security definer set search_path=''as $$
declare s public.care_alert_settings:=public._care_alert_settings();r record;mid uuid;n integer:=0;eligible integer:=0;
begin
 if s.telegram_delivery is not true then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','telegram_delivery_off','system',null,'{}');return;end if;
 if s.sandbox_test_accounts is true and exists(select 1 from public.profiles where id=a.member_id and is_test_account)then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','test_account_sandbox','system',null,'{}');return;end if;
 -- A repeat within 15 minutes of the last notice does not page staff again; the inbox shows the count.
 if a.occurrences>1 and exists(select 1 from public.care_alert_deliveries where alert_id=a.id and created_at>clock_timestamp()-interval '15 minutes')then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','recently_notified','system',null,'{}');return;end if;
 for r in select distinct on(ws.user_id)ws.user_id,b.address,b.principal_ref
  from public.workspace_staff ws join public.telegram_auth_bindings b on b.auth_user_id=ws.user_id and b.kind='staff'and b.active
  where ws.active and ws.removed_at is null and(ws.role='admin'
   or(ws.role='doctor'and(
    (ws.user_id=a.doctor_id and coalesce(a.route_primary,'both')in('doctor','both'))
    or(coalesce(a.route_primary,'both')='nurse'
     and public._patient_coordination_owner_valid(a.member_id,ws.user_id,true)
     and not exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id
      and public._patient_coordination_owner_valid(c.user_id,c.assigned_nurse_id,false)))))
   or(ws.role='nurse'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,false)
    and coalesce(a.route_primary,'both')in('nurse','both')))
   and not public._test_member_hidden(a.member_id,ws.user_id)order by ws.user_id loop
  eligible:=eligible+1;
  if exists(select 1 from public.care_alert_deliveries where alert_id=a.id and recipient_id=r.user_id and occurrence=a.occurrences)then continue;end if;
  mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(r.user_id),r.address,r.principal_ref,jsonb_build_object('kind','open_url','url',
   'https://backoffice.noreon.health/staff/real/n/'||public.staff_notice_issue(r.user_id,a.member_id,a.id)),null);
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

create or replace function public.care_alert_escalate_due()returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.care_alerts;s public.care_alert_settings:=public._care_alert_settings();u record;mid uuid;n integer:=0;told integer;eligible integer;already integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if s.enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for a in select al.* from public.care_alerts al
  where al.state='open'and al.escalated_at is null and al.route_backup is not null and al.route_minutes is not null
   and clock_timestamp()>=al.cycle_started_at+make_interval(mins=>al.route_minutes)
  order by al.cycle_started_at limit 200 for update skip locked loop
  update public.care_alerts set escalated_at=clock_timestamp(),escalated_to=a.route_backup where id=a.id returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'escalated',jsonb_build_object('to',a.route_backup,'afterMinutes',a.route_minutes));
  perform public._care_alert_trace(a,'care_alert.escalated','escalate','not_acknowledged_in_time','system',null,
   jsonb_build_object('noreon.care_alert.escalated_to',a.route_backup,'noreon.care_alert.after_minutes',a.route_minutes));
  n:=n+1;
 end loop;
 if s.telegram_delivery is not true then return jsonb_build_object('ok',true,'raised',n,'failed',0);end if;
 for a in select al.* from public.care_alerts al
  where al.state='open'and al.escalated_at is not null and al.escalation_notified_at is null
  -- Fair across sweeps: never-tried first, then the least recently tried, so undeliverable ones cannot keep deliverable ones waiting.
  order by al.escalation_attempted_at nulls first,al.escalated_at limit 200 for update skip locked loop
  if s.sandbox_test_accounts is true and exists(select 1 from public.profiles where id=a.member_id and is_test_account)then
   update public.care_alerts set escalation_notified_at=clock_timestamp()where id=a.id;
   perform public._care_alert_trace(a,'care_alert.escalation_notice_skipped','skipped','test_account_sandbox','system',null,'{}');
   continue;
  end if;
  told:=0;eligible:=0;already:=0;
  for u in select distinct on(ws.user_id)ws.user_id,b.address,b.principal_ref
   from public.workspace_staff ws join public.telegram_auth_bindings b on b.auth_user_id=ws.user_id and b.kind='staff'and b.active
   where ws.active and ws.removed_at is null
    and((a.escalated_to='doctor'and ws.role='doctor'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,true))
     or(a.escalated_to='nurse'and ws.role='nurse'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,false)))
    and not public._test_member_hidden(a.member_id,ws.user_id)order by ws.user_id loop
   eligible:=eligible+1;
   if exists(select 1 from public.care_alert_deliveries d where d.alert_id=a.id and d.recipient_id=u.user_id and d.occurrence=a.occurrences)then already:=already+1;continue;end if;
   mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(u.user_id),u.address,u.principal_ref,jsonb_build_object('kind','open_url','url',
   'https://backoffice.noreon.health/staff/real/n/'||public.staff_notice_issue(u.user_id,a.member_id,a.id)),null);
   if mid is null then continue;end if;
   insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)values(a.id,u.user_id,'telegram',mid,a.occurrences);
   told:=told+1;
  end loop;
  -- Told, or everyone who could be told already was. Otherwise it stays pending and the next sweep tries again.
  update public.care_alerts set escalation_attempted_at=clock_timestamp()where id=a.id;
  if told>0 or(eligible>0 and already=eligible)then
   update public.care_alerts set escalation_notified_at=clock_timestamp()where id=a.id;
   perform public._care_alert_trace(a,'care_alert.escalation_notified','queued','backup_told','system',null,
    jsonb_build_object('noreon.care_alert.escalated_to',a.escalated_to,'noreon.care_alert.recipients',told));
  end if;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',0);
end$$;

create or replace function public._care_team_reconcile(p_member uuid,p_actor uuid,p_via text,p_request uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare c public.patient_clinical_cases; a public.care_alerts; t public.patient_coordination_tasks;
 actor public.workspace_staff; target uuid; old_name text; recipient record; mid uuid;
 settings public.care_alert_settings:=public._care_alert_settings();
begin
 select * into c from public.patient_clinical_cases where user_id=p_member for update;
 if not found then return;end if;
 -- A clinic approval is always a system transfer named after the clinic admin, even when that
 -- person also has a staff row (review r2 F3); staff writers keep their own name and role.
 if p_via='clinic_admin' then
  actor.user_id:=c.assigned_doctor_id;actor.role:='system';
  select m.display_name into actor.display_name from public.clinic_portal_memberships m
   join public.clinic_admin_change_requests r on r.clinic_id=m.clinic_id
   where r.id=p_request and m.user_id=p_actor;
  actor.display_name:=coalesce(actor.display_name,'');
 else
  select * into actor from public.workspace_staff where user_id=p_actor;
  if not found then actor.user_id:=c.assigned_doctor_id;actor.role:='system';actor.display_name:='';end if;
 end if;
 if c.assigned_doctor_id is not null then
  for a in select * from public.care_alerts where member_id=p_member and state in ('open','acknowledged')
   and doctor_id is distinct from c.assigned_doctor_id order by id for update loop
   update public.care_alerts set doctor_id=c.assigned_doctor_id where id=a.id;
   insert into public.care_alert_audit(alert_id,actor_id,kind,detail) values(a.id,p_actor,'reassigned',
    jsonb_build_object('fromDoctor',a.doctor_id,'toDoctor',c.assigned_doctor_id,'via',p_via,'requestId',p_request));
   -- Same outbox and delivery uniqueness as _care_alert_notify; only the new
   -- doctor is eligible. Bypass repeat throttling and role routing for this handoff.
   if settings.telegram_delivery is true and not(settings.sandbox_test_accounts is true
    and exists(select 1 from public.profiles where id=p_member and is_test_account)) then
    for recipient in select distinct on(s.user_id) s.user_id,b.address,b.principal_ref
     from public.workspace_staff s join public.telegram_auth_bindings b on b.auth_user_id=s.user_id and b.kind='staff' and b.active
     where s.user_id=c.assigned_doctor_id and s.role='doctor' and s.active and s.removed_at is null
      and not public._test_member_hidden(p_member,s.user_id) order by s.user_id loop
     if not exists(select 1 from public.care_alert_deliveries where alert_id=a.id and recipient_id=recipient.user_id and occurrence=a.occurrences) then
      mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(recipient.user_id),recipient.address,recipient.principal_ref,jsonb_build_object('kind','open_url','url',
   'https://backoffice.noreon.health/staff/real/n/'||public.staff_notice_issue(recipient.user_id,a.member_id,a.id)),null);
      if mid is not null then
       insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)
        values(a.id,recipient.user_id,'telegram',mid,a.occurrences);
      end if;
     end if;
    end loop;
   end if;
  end loop;
 end if;
 for t in select * from public.patient_coordination_tasks where patient_case_id=p_member
  and status in ('open','awaiting-member','awaiting-doctor')
  and owner_id is distinct from c.assigned_doctor_id and owner_id is distinct from c.assigned_nurse_id
  order by id for update loop
  if exists(select 1 from public.workspace_staff where user_id=t.owner_id and role='nurse') then
   target:=coalesce(c.assigned_nurse_id,c.assigned_doctor_id);
  else target:=c.assigned_doctor_id;end if;
  if target is null or target=t.owner_id then continue;end if;
  select display_name into old_name from public.workspace_staff where user_id=t.owner_id;
  update public.patient_coordination_tasks set owner_id=target,revision=revision+1,updated_at=clock_timestamp() where id=t.id;
  insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,old_status,new_status,old_owner_id,new_owner_id,note,detail)
   values(t.id,t.revision+1,gen_random_uuid(),actor.user_id,actor.display_name,actor.role,'reassign',t.status,t.status,t.owner_id,target,
    'Care team changed. Was: '||coalesce(old_name,'')||'.',jsonb_build_object('input',jsonb_build_object('ownerId',target),'before',null,'actorId',p_actor,'via',p_via,'requestId',p_request,'approvedBy',p_actor,'system',true));
 end loop;
end $$;
