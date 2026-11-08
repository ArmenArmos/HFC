-- Armen's audit, 4 Nov, S0-2: a duplicate is linked to the open item and stays visible, never closed.
--
-- The one-item BP merge (20261104140000) closed a member's open nurse and physician tasks the moment an alert covered
-- them, with closed_by null: no named person closed them, and the nurse (who cannot open the doctor's alert) was left with
-- nothing while the alert stayed open for a doctor who might not see it. Now the task is only linked (merged_into_alert_id):
-- it stays open, in its own queue, with its own deadline, until a named person answers or closes it. The alert's episode
-- read still lists it, so the alert and the task point at each other.
--
-- Audit of every system close of an urgent item: the only one was this merge. (bp_repeat_notes are the quiet pre-alert
-- note, not an alert or a task; the alert or task that replaces one is what staff see.)

-- 1. From here on a task is closed only by a person.
create function public._care_queue_no_system_close()returns trigger language plpgsql set search_path=''as $$
begin
 -- Only a row that was already closed with no person (the old merge) may stay that way; a person's close cannot be undone.
 if new.status='closed'and new.closed_by is null and(tg_op='INSERT'or not(old.status='closed'and old.closed_by is null))then
  raise exception 'A care queue task is closed by a named person, never by the system' using errcode='23514';
 end if;
 return new;
end$$;
create trigger care_queue_tasks_no_system_close before insert or update of status,closed_by on public.care_queue_tasks
 for each row execute function public._care_queue_no_system_close();

-- A link may sit on any task. Rows the old merge closed keep their history (the legacy branch); no new one can be written.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.care_queue_tasks'::regclass and contype='c'and conname='care_queue_staff_or_merge'loop
  execute format('alter table public.care_queue_tasks drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.care_queue_tasks add constraint care_queue_staff_or_merge check(
 (merged_into_alert_id is not null and status='closed'and closed_at is not null and closed_by is null)
 or(
  (status='sent'or(seen_at is not null and seen_by is not null))
  and(status not in('answered','closed')or(answered_at is not null and answered_by is not null))
  and((status='closed')=(closed_at is not null and closed_by is not null)))
);

-- 2. Link, do not close. Same function, one block replaced (the current definition is patched, not copied).
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._zoe_bp_reconcile(uuid)'::regprocedure);
 old:=$old$   update public.care_queue_tasks set status='closed',closed_at=clock_timestamp(),closed_by=null,
    merged_into_alert_id=a,state_seq=state_seq+1 where id=t.id;
   insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,merged_into_alert_id)values(t.id,t.status,'closed',null,a);$old$;
 replacement:=$new$   -- Linked, never closed (Armen's audit S0-2): the task stays open in its own queue until a person closes it.
   if t.merged_into_alert_id is distinct from a then
    update public.care_queue_tasks set merged_into_alert_id=a,state_seq=state_seq+1 where id=t.id;
    insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,detail)
     values(t.id,t.status,t.status,null,jsonb_build_object('action','bp_linked_to_alert','alertId',a));
   end if;$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected _zoe_bp_reconcile merge definition';end if;
 execute replace(definition,old,replacement);
end $migration$;

-- 3. Repair what the old merge already closed: while its alert is still open, the task is open again, with its
-- original deadline, and the history says why. Alerts a person already closed leave their tasks as they were.
create function public._care_queue_reopen_merge_closed()returns integer language plpgsql security definer set search_path=''as $$
declare t public.care_queue_tasks;n integer:=0;prior text;
begin
 for t in select q.* from public.care_queue_tasks q where q.status='closed'and q.closed_by is null and q.merged_into_alert_id is not null
  and exists(select 1 from public.care_alerts a where a.id=q.merged_into_alert_id and a.state<>'resolved')for update loop
  select e.from_status into prior from public.care_queue_task_events e where e.task_id=t.id and e.merged_into_alert_id is not null order by e.id desc limit 1;
  prior:=case when prior='seen'and t.seen_at is not null and t.seen_by is not null then 'seen'else 'sent'end;
  update public.care_queue_tasks set status=prior,closed_at=null,closed_by=null,state_seq=state_seq+1 where id=t.id;
  insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,detail)
   values(t.id,case when prior='seen'then 'seen'else 'sent'end,prior,null,jsonb_build_object('action','bp_merge_close_reopened','alertId',t.merged_into_alert_id));
  n:=n+1;
 end loop;
 return n;
end$$;
revoke all on function public._care_queue_reopen_merge_closed()from public,anon,authenticated,service_role;
select public._care_queue_reopen_merge_closed();

-- 4. A linked nurse task is reachable. With no eligible nurse a nurse task falls to the doctor; it is set aside only while
-- the same episode has an open physician task (one line for the episode, still open and found again the moment that task is
-- done). An open alert no longer hides it: the alert may be unseen, and this task is then the only thing that reaches anyone.
create or replace function public._care_queue_visible(t public.care_queue_tasks,actor jsonb)returns boolean language sql stable security definer set search_path=''as $$
 select case actor->>'role'
  when 'admin'then t.queue='admin'
  when 'nurse'then t.queue='nurse'and exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_nurse_id=(actor->>'id')::uuid)
  when 'doctor'then exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_doctor_id=(actor->>'id')::uuid
   and(t.queue='physician'or(t.queue='nurse'and not public._care_queue_eligible(c.assigned_nurse_id,'nurse')
    and not exists(select 1 from public.zoe_bp_staff_items e where e.member_id=t.member_id and t.id=any(e.task_ids)
     and exists(select 1 from public.care_queue_tasks q where q.id=any(e.task_ids)and q.queue='physician'and q.status in('sent','seen'))))))
  else false end
$$;

-- 5. The member chip tells a person's close from the old actorless one: only an actorless linked close is a "merge".
create or replace function public.care_queue_member_tasks()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();
begin
 if m is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'queue',t.queue,'status',t.status,'slaDeadline',t.sla_deadline,'createdAt',t.created_at)||case when t.merged_into_alert_id is null or t.closed_by is not null then '{}'::jsonb else jsonb_build_object('mergedIntoAlertId',t.merged_into_alert_id)end order by t.created_at desc,t.id)
  from(select * from public.care_queue_tasks where member_id=m and queue<>'admin'order by created_at desc,id limit 50)t),'[]'::jsonb));
end$$;
