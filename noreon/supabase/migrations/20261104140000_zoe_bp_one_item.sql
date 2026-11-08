create or replace function public.zoe_bp_episode(p_member uuid,p_submission uuid,p_minutes integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m public.patient_measurements;
begin
 if p_member is null or p_submission is null or p_minutes is null or p_minutes not between 1 and 60 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into m from public.patient_measurements where user_id=p_member and submission_id=p_submission;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 return jsonb_build_object('ok',true,'readingId',m.id,'readings',(select jsonb_agg(jsonb_build_object('id',r.id,'submissionId',r.submission_id,'sbp',r.systolic,'dbp',r.diastolic)order by r.created_at,r.id)
  from(select * from public.patient_measurements where user_id=p_member and(id=m.id or(created_at>=m.created_at-make_interval(mins=>p_minutes)and created_at<=m.created_at))order by created_at desc,id desc limit 20)r));
end$$;

-- #528 leads the V3 BP episode. No clinical cuts change here. The caller supplies the
-- zone episode window; reading ids (and the screening journal, which includes repeats)
-- identify the alert. Nurse marks have no measurement FK, so match their recorded time
-- to the episode's measurement times within that same window.
create table public.zoe_bp_staff_items (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 episode_refs text[] not null,
 measurement_ids uuid[] not null,
 task_ids uuid[] not null default '{}',
 note_ids uuid[] not null default '{}',
 alert_id uuid references public.care_alerts(id) on delete set null,
 -- Coverage is retained per alert, including after resolution.
 alert_readings jsonb not null default '{}'check(jsonb_typeof(alert_readings)='object'),
 episode_minutes integer not null check(episode_minutes between 1 and 60),
 starts_at timestamptz not null, ends_at timestamptz not null,
 checked_at timestamptz not null default clock_timestamp()
);
create index zoe_bp_staff_items_member on public.zoe_bp_staff_items(member_id);
create index zoe_bp_staff_items_retry on public.zoe_bp_staff_items(checked_at,id);
alter table public.zoe_bp_staff_items enable row level security;
revoke all on public.zoe_bp_staff_items from public,anon,authenticated,service_role;

alter table public.care_queue_tasks add column merged_into_alert_id uuid references public.care_alerts(id);
alter table public.care_queue_task_events
 add column merged_into_alert_id uuid references public.care_alerts(id),
 add column detail jsonb not null default '{}'check(jsonb_typeof(detail)='object');
alter table public.bp_repeat_notes
 add column merged_into_alert_id uuid references public.care_alerts(id),
 add column merged_into_task_id uuid references public.care_queue_tasks(id);

-- A merge is a system close, never a fabricated staff seen/answer. The original
-- checks are kept verbatim for every row without the merge marker.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.care_queue_tasks'::regclass and contype='c'
  and(pg_get_constraintdef(oid)like '%seen_at%'or pg_get_constraintdef(oid)like '%answered_at%'or pg_get_constraintdef(oid)like '%closed_at%')loop
  execute format('alter table public.care_queue_tasks drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.care_queue_tasks add constraint care_queue_staff_or_merge check(
 (merged_into_alert_id is not null and status='closed'and closed_at is not null and closed_by is null)
 or(merged_into_alert_id is null
  and(status='sent'or(seen_at is not null and seen_by is not null))
  and(status not in('answered','closed')or(answered_at is not null and answered_by is not null))
  and((status='closed')=(closed_at is not null and closed_by is not null)))
);
alter table public.care_queue_task_events add constraint care_queue_merge_event check(
 merged_into_alert_id is null or(actor_id is null and to_status='closed')
);

-- Caller holds the BP member lock. A failure is caught *outside* this function so
-- neither the alert nor the reading/task already saved in the caller is undone.
create function public._zoe_bp_reconcile(p_item uuid)returns void
language plpgsql security definer set search_path=''as $$
declare e public.zoe_bp_staff_items;a uuid;t public.care_queue_tasks;ids uuid[];
begin
 select * into strict e from public.zoe_bp_staff_items where id=p_item for update;
 -- Include a later staff/repeat reading even before Zoe follows that save.
 select array_agg(distinct m.id)into ids from public.patient_measurements m where m.user_id=e.member_id
  and(m.id=any(e.measurement_ids)or m.created_at between e.starts_at and e.ends_at);
 e.measurement_ids:=coalesce(ids,e.measurement_ids);
 -- Repeated alerts keep their first source_ref; screenings retains every reading ref.
 select x.id into a from public.care_alerts x where x.member_id=e.member_id and x.source='reading'and x.state<>'resolved'
  and(x.id=e.alert_id or exists(
   select 1 from public.care_alert_screenings s where s.member_id=e.member_id and s.source='reading'and s.alert_id=x.id
    and(s.source_ref=any(select u::text from unnest(e.measurement_ids)u)
     or exists(select 1 from public.nurse_visit_marks n where n.member_id=e.member_id and s.source_ref='nurse-mark:'||n.id::text
      and(select m.id from public.patient_measurements m where m.user_id=e.member_id and m.created_at<=n.recorded_at
       and m.measured_at between n.recorded_at-make_interval(mins=>e.episode_minutes)and n.recorded_at+make_interval(mins=>e.episode_minutes)
       order by abs(extract(epoch from m.measured_at-n.recorded_at)),m.id limit 1)=any(e.measurement_ids)))
   )or x.source_ref=any(select u::text from unnest(e.measurement_ids)u))
 order by x.created_at,x.id limit 1 for update of x;
 -- The row lock fences a concurrent resolution before we merge any new work.
 if a is not null and not coalesce((e.alert_readings -> a::text) @> to_jsonb(e.measurement_ids),false)then
  -- A doctor resolving from an older screen must see the new evidence first.
  -- Resolution already checks state_seq under this same alert row lock.
  update public.care_alerts set state_seq=state_seq+1,state='open'where id=a;
  e.alert_readings:=jsonb_set(e.alert_readings,array[a::text],to_jsonb(e.measurement_ids));
 end if;
 e.alert_id:=a;
 -- Re-discover tasks by source as well: this repairs a failed link after a successful raise.
 select coalesce(array_agg(distinct q.id),'{}')into e.task_ids from public.care_queue_tasks q where q.member_id=e.member_id
  and(q.id=any(e.task_ids)or q.source_ref in(e.id::text||':yellow',e.id::text||':orange')
   or exists(select 1 from public.patient_measurements m where m.user_id=e.member_id and m.id=any(e.measurement_ids)
    and q.source_ref in(m.id::text||':yellow',m.id::text||':orange','bp:'||m.submission_id::text||':yellow','bp:'||m.submission_id::text||':orange')));
 select coalesce(array_agg(distinct n.id),'{}')into e.note_ids from public.bp_repeat_notes n where n.member_id=e.member_id
  and(n.id=any(e.note_ids)or n.measurement_id=any(e.measurement_ids));
 if a is not null then
  for t in select * from public.care_queue_tasks where member_id=e.member_id and id=any(e.task_ids)
   and queue in('physician','nurse')and status in('sent','seen')for update loop
   update public.care_queue_tasks set status='closed',closed_at=clock_timestamp(),closed_by=null,
    merged_into_alert_id=a,state_seq=state_seq+1 where id=t.id;
   insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,merged_into_alert_id)values(t.id,t.status,'closed',null,a);
  end loop;
  update public.bp_repeat_notes set closed_at=coalesce(closed_at,clock_timestamp()),merged_into_alert_id=a
   where member_id=e.member_id and id=any(e.note_ids)and merged_into_alert_id is null and(closed_at is null or merged_into_task_id is not null);
 else
  -- Before an alert exists, the doctor-facing task replaces the quiet note.
  -- A nurse task falls to the doctor when there is no eligible nurse, even if
  -- the separate physician raise failed.
  select q.id into a from public.care_queue_tasks q where q.member_id=e.member_id and q.id=any(e.task_ids)
   and q.status in('sent','seen')and(q.queue='physician'or(q.queue='nurse'and not exists(select 1 from public.patient_clinical_cases c
    where c.user_id=e.member_id and public._care_queue_eligible(c.assigned_nurse_id,'nurse'))))
   order by(q.queue='physician')desc,q.created_at,q.id limit 1;
  if a is not null then
   update public.bp_repeat_notes set closed_at=coalesce(closed_at,clock_timestamp()),merged_into_task_id=a
    where member_id=e.member_id and id=any(e.note_ids)and closed_at is null;
  end if;
 end if;
 update public.zoe_bp_staff_items set measurement_ids=e.measurement_ids,task_ids=e.task_ids,note_ids=e.note_ids,alert_id=e.alert_id,alert_readings=e.alert_readings,checked_at=clock_timestamp()where id=e.id;
end$$;

-- Trace fixed codes and ids only, never a reading, note or database error message.
create function public._zoe_bp_merge_failed(p_member uuid,p_ref text,p_state text)returns void
language plpgsql security definer set search_path=''as $$begin
 perform public._conversation_trace(p_member,null,'bp_episode',p_ref,'care_alert','bp_episode.merge_failed','failed','merge_will_retry','zoe.bp_episode','1','system',null,
  jsonb_build_object('noreon.error.sqlstate',p_state));
exception when others then null;end$$;

-- Register before raising tasks. An overlap reuses the existing episode, including
-- the fallback bp:<submission> identity. Only service-role V3 callers create these rows.
create function public.zoe_bp_staff_item(p_member uuid,p_episode text,p_reading uuid,p_submission uuid,p_minutes integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.patient_measurements;e public.zoe_bp_staff_items;ids uuid[];lo timestamptz;hi timestamptz;a public.care_alerts;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or p_episode is null or p_episode!~'^[A-Za-z0-9_.:-]{1,100}$'or p_minutes is null or p_minutes not between 1 and 60 then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-episode:'||p_member::text,0));
 select * into m from public.patient_measurements where user_id=p_member
  and(id=p_reading or(p_reading is null and submission_id=p_submission)
   or(p_reading is null and p_submission is null and 'bp:'||submission_id::text=p_episode))limit 1;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 select array_agg(r.id),min(r.created_at),max(r.created_at)into ids,lo,hi from(
  select * from public.patient_measurements where user_id=p_member and(id=m.id or created_at between m.created_at-make_interval(mins=>p_minutes)and m.created_at)
  order by created_at desc,id desc limit 20)r;
 select * into e from public.zoe_bp_staff_items where member_id=p_member and measurement_ids && ids order by starts_at,id limit 1 for update;
 if not found then
  insert into public.zoe_bp_staff_items(member_id,episode_refs,measurement_ids,episode_minutes,starts_at,ends_at)
   values(p_member,array[p_episode],ids,p_minutes,lo,hi+make_interval(mins=>p_minutes))returning * into e;
 else
  update public.zoe_bp_staff_items set episode_refs=case when p_episode=any(episode_refs)then episode_refs else episode_refs||array[p_episode]end,
   measurement_ids=(select array_agg(distinct r)from unnest(measurement_ids||ids)r),starts_at=least(starts_at,lo),ends_at=greatest(ends_at,hi+make_interval(mins=>p_minutes))where id=e.id;
 end if;
 begin perform public._zoe_bp_reconcile(e.id);
 exception when others then perform public._zoe_bp_merge_failed(p_member,p_episode,sqlstate);end;
 -- Only this exact reading may replay resolved work. An overlapping episode
 -- alone is never proof that a doctor has reviewed the new evidence.
 select x.* into a from public.care_alerts x where x.member_id=p_member and x.source='reading'and(
  (x.state<>'resolved'and exists(select 1 from public.zoe_bp_staff_items l where l.id=e.id and l.alert_id=x.id))
  or exists(select 1 from public.zoe_bp_staff_items l where l.id=e.id and (l.alert_readings -> x.id::text) @> to_jsonb(array[m.id]))
  or exists(select 1 from public.care_alert_screenings c where c.alert_id=x.id and c.member_id=p_member and c.source='reading'and c.source_ref=m.id::text))
 order by(x.state<>'resolved')desc,x.created_at,x.id limit 1 for update of x;
 return jsonb_build_object('ok',true,'itemId',e.id,'alert',case when a.id is null then null else
  jsonb_build_object('id',a.id,'reason',a.reason_code,'sentTo',case when exists(select 1 from public.patient_clinical_cases c where c.user_id=p_member and public._care_queue_eligible(c.assigned_doctor_id,'doctor'))then 'physician'else null end)end);
end$$;

-- Atomic BP-only adapter. The original queue RPC, its grants and all non-BP callers
-- stay unchanged. An alert between the preflight and either queue suppresses both.
create function public.zoe_bp_task_raise(p_member uuid,p_queue text,p_zone text,p_reason text,p_rule_version text,p_red_flags text,p_action text,p_summary jsonb,p_sla timestamptz,p_source_ref text,
 p_episode text,p_reading uuid,p_submission uuid,p_minutes integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare link jsonb;r jsonb;ref text;reading uuid;t public.care_queue_tasks;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_queue is null or p_queue not in('nurse','physician')or p_zone is null or p_zone not in('yellow','orange')
  or p_source_ref is distinct from p_episode||':'||p_zone then return jsonb_build_object('ok',false,'code','invalid');end if;
 link:=public.zoe_bp_staff_item(p_member,p_episode,p_reading,p_submission,p_minutes);
 if link->>'ok'is distinct from 'true'then return link;end if;
 if link->'alert'<>'null'::jsonb then return jsonb_build_object('ok',false,'code','bp_alert','alert',link->'alert');end if;
 select id into strict reading from public.patient_measurements where user_id=p_member
  and(id=p_reading or(p_reading is null and submission_id=p_submission)
   or(p_reading is null and p_submission is null and 'bp:'||submission_id::text=p_episode))limit 1;
 -- Receipts in the existing append-only journal distinguish a repeated action
 -- from new evidence after staff completed the previous task.
 ref:=reading::text||':'||p_zone;
 select q.* into t from public.care_queue_tasks q where q.member_id=p_member and q.queue=p_queue
  and(q.source_ref=ref or exists(select 1 from public.care_queue_task_events v where v.task_id=q.id
   and v.detail->>'action'='bp_evidence_linked'and v.detail->>'readingId'=reading::text and v.detail->>'zone'=p_zone))
 order by q.created_at,q.id limit 1 for update of q;
 if found then
  r:=public.care_queue_raise(p_member,p_queue,p_zone,p_reason,p_rule_version,p_red_flags,p_action,p_summary,p_sla,t.source_ref);
  if r->>'ok'is distinct from 'true'then return r;end if;
  return jsonb_build_object('ok',true,'replayed',true,'task',public._care_queue_json(t));
 end if;
 -- Only actionable work can absorb another reading or be promoted.
 select q.* into t from public.care_queue_tasks q join public.zoe_bp_staff_items e on q.id=any(e.task_ids)
  where e.id=(link->>'itemId')::uuid and q.member_id=p_member and q.queue=p_queue and q.status in('sent','seen')
  order by q.created_at,q.id limit 1 for update of q;
 if found then
  r:=public.care_queue_raise(p_member,p_queue,p_zone,p_reason,p_rule_version,p_red_flags,p_action,p_summary,p_sla,t.source_ref);
  if r->>'ok'is distinct from 'true'then return r;end if;
  if t.zone='yellow'and p_zone='orange'then
   update public.care_queue_tasks set zone=p_zone,reason_code=p_reason,rule_version=p_rule_version,red_flags_status=p_red_flags,
    summary=p_summary,sla_deadline=least(sla_deadline,p_sla),state_seq=state_seq+1 where id=t.id returning * into t;
   insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,detail)
    values(t.id,t.status,t.status,null,jsonb_build_object('action','bp_zone_promoted','fromZone','yellow','toZone','orange'));
  end if;
  insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id,detail)
   values(t.id,t.status,t.status,null,jsonb_build_object('action','bp_evidence_linked','readingId',reading,'zone',p_zone));
  return jsonb_build_object('ok',true,'replayed',true,'task',public._care_queue_json(t));
 end if;
 -- A reading-specific source also recovers an insert whose episode link failed.
 r:=public.care_queue_raise(p_member,p_queue,p_zone,p_reason,p_rule_version,p_red_flags,p_action,p_summary,p_sla,ref);
 begin perform public._zoe_bp_reconcile((link->>'itemId')::uuid);
 exception when others then perform public._zoe_bp_merge_failed(p_member,p_episode,sqlstate);end;
 return r;
end$$;

-- #528 still raises independently of V3. Merge failures never roll the alert back.
create or replace function public._bp_check_raise(p_member uuid,p_ref text,p_level text,p_measured_at timestamptz)returns boolean
language plpgsql security definer set search_path=''as $$
declare e record;
begin
 begin
  perform pg_advisory_xact_lock(hashtextextended('bp-episode:'||p_member::text,0));
  perform public._care_alert_screen(p_member,'reading',p_ref,'escalate',p_level,array['RF-06'],'clinical.bp_one_rule','bp-one-rule-1');
  if p_level='bp_doctor_today'then
   update public.care_alerts set reason_code='bp_doctor_today',state_seq=state_seq+1 where member_id=p_member and source='reading'and state<>'resolved'and reason_code='bp_doctor_48h';
  end if;
  delete from public.bp_check_retries where ref=p_ref;
  -- Each episode is its own exception block: failed merging leaves the alert safe
  -- and the durable link row for zoe_bp_merge_retry.
  for e in select id from public.zoe_bp_staff_items link where member_id=p_member and(
   p_ref=any(select u::text from unnest(link.measurement_ids)u)
   or exists(select 1 from public.patient_measurements m where m.user_id=p_member and m.id::text=p_ref and m.created_at between link.starts_at and link.ends_at)
   or p_ref like 'nurse-mark:%')loop
   begin perform public._zoe_bp_reconcile(e.id);
   exception when lock_not_available or query_canceled or others then perform public._zoe_bp_merge_failed(p_member,p_ref,sqlstate);end;
  end loop;
  return true;
 exception when lock_not_available or query_canceled or others then
  -- The retry row is the durable work: it gets its own block, so a failed or cancelled trace cannot undo it.
  begin
   insert into public.bp_check_retries(ref,member_id,level,measured_at)values(p_ref,p_member,p_level,p_measured_at)on conflict(ref)do update set attempts=public.bp_check_retries.attempts+1;
  exception when lock_not_available or query_canceled or others then null;
  end;
  begin
   perform public._conversation_trace(p_member,null,'bp_reading',p_ref,'care_alert','care_alert.raise_failed','failed','alert_not_recorded_will_retry','clinical.bp_one_rule','bp-one-rule-1','system',null,
    jsonb_build_object('noreon.care_alert.source','reading','noreon.error.sqlstate',sqlstate));
  exception when lock_not_available or query_canceled or others then null;
  end;
  return false;
 end;
end$$;

-- A first-reading note cannot reappear beside an existing V3 task.
create or replace function public._bp_check_note(m public.patient_measurements,p_close boolean,p_open boolean)returns void
language plpgsql security definer set search_path=''as $$
declare e record;r record;intent text:=case when p_close and p_open then 'note_close_open'when p_open then 'note_open'else 'note_close'end;
begin
 begin
  perform pg_advisory_xact_lock(hashtextextended('bp-episode:'||m.user_id::text,0));
  -- Drain earlier failed note operations before applying the current one. No
  -- thresholds are evaluated here: these are the trigger's original decisions.
  for r in select x.* from(
   select n.id,n.user_id,n.systolic,n.diastolic,n.measured_at,n.created_at,b.level from public.bp_check_retries b
    join public.patient_measurements n on b.ref='note:'||n.id::text
    where b.member_id=m.user_id and b.level in('note_open','note_close','note_close_open')and n.id<>m.id
   union all select m.id,m.user_id,m.systolic,m.diastolic,m.measured_at,m.created_at,intent
  )x order by x.measured_at,x.created_at,x.id loop
   if r.level in('note_close','note_close_open')then
    update public.bp_repeat_notes set closed_at=clock_timestamp()where member_id=r.user_id and closed_at is null and measured_at<r.measured_at;
   end if;
   if r.level in('note_open','note_close_open')then
    insert into public.bp_repeat_notes(member_id,measurement_id,systolic,diastolic,measured_at)values(r.user_id,r.id,r.systolic,r.diastolic,r.measured_at)
     on conflict(member_id)where closed_at is null do update set measurement_id=excluded.measurement_id,systolic=excluded.systolic,diastolic=excluded.diastolic,measured_at=excluded.measured_at;
   end if;
   delete from public.bp_check_retries where ref='note:'||r.id::text;
  end loop;
  for e in select id from public.zoe_bp_staff_items where member_id=m.user_id loop
   begin perform public._zoe_bp_reconcile(e.id);
   exception when lock_not_available or query_canceled or others then perform public._zoe_bp_merge_failed(m.user_id,m.id::text,sqlstate);end;
  end loop;
 exception when lock_not_available or query_canceled or others then
  begin
   insert into public.bp_check_retries(ref,member_id,level,measured_at)values('note:'||m.id::text,m.user_id,intent,m.measured_at)
    on conflict(ref)do update set attempts=public.bp_check_retries.attempts+1;
  exception when lock_not_available or query_canceled or others then null;
  end;
  begin
   perform public._conversation_trace(m.user_id,null,'bp_reading',m.id::text,'care_alert','bp_note.failed','failed','note_not_recorded','clinical.bp_one_rule','bp-one-rule-1','system',null,
    jsonb_build_object('noreon.error.sqlstate',sqlstate));
  exception when lock_not_available or query_canceled or others then null;
  end;
 end;
end$$;

-- The existing sweep owns both alert retries and failed note intents. A failed
-- note is durable even when V3 has never registered an episode for that member.
create or replace function public.bp_check_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.bp_check_retries;m public.patient_measurements;n integer:=0;f integer:=0;s integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in select * from public.bp_check_retries
  where level in('note_open','note_close','note_close_open')or(public._care_alert_settings()).enabled is true
  order by measured_at,created_at,ref limit greatest(1,least(coalesce(p_limit,20),50))loop
  -- Try, never wait: a sweep holds every member lock it takes until it ends, so waiting could deadlock with another sweep that took them in the other
  -- order. A busy member keeps its retry row for the next pass. Recheck only after the lock: a save holding it may have drained this very intent.
  if not pg_try_advisory_xact_lock(hashtextextended('bp-episode:'||r.member_id::text,0))then s:=s+1;continue;end if;
  if not exists(select 1 from public.bp_check_retries where ref=r.ref)then continue;end if;
  if r.level in('note_open','note_close','note_close_open')then
   select * into m from public.patient_measurements where id::text=substr(r.ref,6)and user_id=r.member_id;
   if found then perform public._bp_check_note(m,r.level in('note_close','note_close_open'),r.level in('note_open','note_close_open'));end if;
   if exists(select 1 from public.bp_check_retries where ref=r.ref)then f:=f+1;end if;
  elsif public._bp_check_raise(r.member_id,r.ref,r.level,r.measured_at)then
   -- Preserve #528's note-close semantics, including nurse-mark retries.
   update public.bp_repeat_notes set closed_at=clock_timestamp()where member_id=r.member_id and closed_at is null and measured_at<r.measured_at;
   n:=n+1;
  else f:=f+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f,'skipped',s);
end$$;

-- Rotate the bounded scan, including failed links and merges. Unlike a raised alert,
-- a repaired merge does not count as another escalation in the sweep report.
create function public.zoe_bp_merge_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare e record;n integer:=0;f integer:=0;s integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for e in select id,member_id from public.zoe_bp_staff_items
  order by checked_at,id limit greatest(1,least(coalesce(p_limit,20),50))loop
  -- Member lock before any row lock (same order as save/raise), but only tried: see bp_check_retry. A busy member is picked up on the next pass.
  if not pg_try_advisory_xact_lock(hashtextextended('bp-episode:'||e.member_id::text,0))then s:=s+1;continue;end if;
  update public.zoe_bp_staff_items set checked_at=clock_timestamp()where id=e.id;
  begin perform public._zoe_bp_reconcile(e.id);n:=n+1;
  exception when others then f:=f+1;perform public._zoe_bp_merge_failed(e.member_id,e.id::text,sqlstate);end;
 end loop;
 return jsonb_build_object('ok',true,'raised',0,'merged',n,'failed',f,'skipped',s);
end$$;

-- The existing BP nurse task has no distinct action. It may stay with an eligible
-- nurse before an alert, but never adds a second line to the doctor fallback lane.
create or replace function public._care_queue_visible(t public.care_queue_tasks,actor jsonb)returns boolean language sql stable security definer set search_path=''as $$
 select case actor->>'role'
  when 'admin'then t.queue='admin'
  when 'nurse'then t.queue='nurse'and exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_nurse_id=(actor->>'id')::uuid)
  -- A member with no eligible nurse: their nurse tasks go to the doctor, so a task never reaches nobody.
  when 'doctor'then exists(select 1 from public.patient_clinical_cases c where c.user_id=t.member_id and c.assigned_doctor_id=(actor->>'id')::uuid
   and(t.queue='physician'or(t.queue='nurse'and not public._care_queue_eligible(c.assigned_nurse_id,'nurse')
    and not exists(select 1 from public.zoe_bp_staff_items e where e.member_id=t.member_id and t.id=any(e.task_ids)
     and(exists(select 1 from public.care_alerts a where a.id=e.alert_id and a.state<>'resolved')or exists(select 1 from public.care_queue_tasks q where q.id=any(e.task_ids)and q.queue='physician'and q.status in('sent','seen')))))))
  else false end
$$;

-- A system merge is not a staff answer. The member chip keeps that distinction.
create or replace function public.care_queue_member_tasks()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();
begin
 if m is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'queue',t.queue,'status',t.status,'slaDeadline',t.sla_deadline,'createdAt',t.created_at)||case when t.merged_into_alert_id is null then '{}'::jsonb else jsonb_build_object('mergedIntoAlertId',t.merged_into_alert_id)end order by t.created_at desc,t.id)
  from(select * from public.care_queue_tasks where member_id=m and queue<>'admin'order by created_at desc,id limit 50)t),'[]'::jsonb));
end$$;

-- Existing audited alert reads include everything merged into the surviving item.
create or replace function public._care_alert_json(a public.care_alerts)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',a.id,'memberId',a.member_id,'memberName',coalesce((select display_name from public.profiles where id=a.member_id),''),
  'source',a.source,'priority',a.priority,'reason',a.reason_code,'redFlags',to_jsonb(a.red_flags),'state',a.state,'stateSeq',a.state_seq,
  'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,
  'lastReason',(select e.detail->>'reason'from public.care_alert_audit e where e.alert_id=a.id and e.kind='repeated'order by e.id desc limit 1),
  'doctorName',(select display_name from public.workspace_staff where user_id=a.doctor_id),
  'acknowledgedAt',a.acknowledged_at,'acknowledgedBy',(select display_name from public.workspace_staff where user_id=a.acknowledged_by),
  'resolvedAt',a.resolved_at,'resolvedBy',(select display_name from public.workspace_staff where user_id=a.resolved_by),
  'resolution',a.resolution,'resolutionNote',a.resolution_note,
  'bpEpisodes',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'measurementIds',coalesce(e.alert_readings->a.id::text,to_jsonb(e.measurement_ids)),'taskIds',e.task_ids,'noteIds',e.note_ids)order by e.starts_at,e.id)
   from public.zoe_bp_staff_items e where(e.alert_id=a.id or e.alert_readings ? a.id::text)and e.member_id=a.member_id),'[]'::jsonb),
  'telegram',coalesce((select jsonb_agg(jsonb_build_object('recipient',coalesce(ws.display_name,''),'state',tm.state,'reason',tm.reason)order by d.created_at)
   from public.care_alert_deliveries d join public.telegram_auth_messages tm on tm.id=d.telegram_message_id left join public.workspace_staff ws on ws.user_id=d.recipient_id
   where d.alert_id=a.id and d.occurrence=a.occurrences),'[]'))
$$;

revoke all on function public._zoe_bp_reconcile(uuid),public._zoe_bp_merge_failed(uuid,text,text),
 public.zoe_bp_staff_item(uuid,text,uuid,uuid,integer),
 public.zoe_bp_task_raise(uuid,text,text,text,text,text,text,jsonb,timestamptz,text,text,uuid,uuid,integer),
 public.zoe_bp_merge_retry(integer)from public,anon,authenticated,service_role;
grant execute on function public.zoe_bp_staff_item(uuid,text,uuid,uuid,integer),
 public.zoe_bp_task_raise(uuid,text,text,text,text,text,text,jsonb,timestamptz,text,text,uuid,uuid,integer),
 public.zoe_bp_merge_retry(integer)to service_role;
-- CREATE OR REPLACE preserves the existing #528 and alert-read grants.
