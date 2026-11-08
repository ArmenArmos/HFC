-- Typed observations are retained as raw evidence and for safety, but never used as
-- measured BP evidence. NULL is legacy measured provenance; photo/voice stay unchanged.
-- No clinical cut, triage, alert or member-facing urgent wording changes.
do $migration$
declare d text; sig text; old text; replacement text;
begin
 -- Aggregate-only readers. Pin each source fragment so drift fails the replay.
 for sig,old,replacement in select * from(values
  ('public.pilot_gm_overview(date,date)','count(*)from public.patient_measurements where measured_at>=lo','count(*)from public.patient_measurements where entry_source is distinct from ''patient_text_entry'' and measured_at>=lo'),
  ('public.pilot_gm_overview(date,date)','select user_id from public.patient_measurements where measured_at>=lo','select user_id from public.patient_measurements where entry_source is distinct from ''patient_text_entry'' and measured_at>=lo'),
  ('public._required_evidence_sources(uuid,text)','where m.user_id=p_user and m.measured_at>a.completed_at','where m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_user and m.measured_at>a.completed_at'),
  ('public._required_evidence_sources(uuid,text)','where b.week_id=w.id','where m.entry_source is distinct from ''patient_text_entry'' and b.week_id=w.id'),
  ('public._bp_weekly_trend(uuid,timestamptz)','where user_id=p_member and measured_at>=','where entry_source is distinct from ''patient_text_entry'' and user_id=p_member and measured_at>='),
  ('public.doctor_programme_member(uuid)','where x.user_id=p_user_id and','where x.entry_source is distinct from ''patient_text_entry'' and x.user_id=p_user_id and'),
  ('public.doctor_programme_member(uuid)','where m.user_id=p_user_id and','where m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_user_id and'),
  ('public._gp_report_source_body(uuid)','from public.patient_measurements m where m.user_id=p_member','from public.patient_measurements m where m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_member'),
  ('public.zoe_run_health_context(uuid[])','from public.patient_measurements pm where pm.user_id=r.member_id','from public.patient_measurements pm where pm.entry_source is distinct from ''patient_text_entry'' and pm.user_id=r.member_id'),
  ('public.zoe_run_health_context(uuid[])','from public.patient_measurements l where l.user_id=r.member_id','from public.patient_measurements l where l.entry_source is distinct from ''patient_text_entry'' and l.user_id=r.member_id')
 )v(sig,old,replacement)loop
  d:=pg_get_functiondef(sig::regprocedure);
  if cardinality(string_to_array(d,old))<>2 then raise exception 'Unexpected BP aggregate definition: %',sig;end if;
  execute replace(d,old,replacement);
 end loop;
 -- Keep raw chart rows, with explicit provenance, including NULL for legacy rows.
 for sig,old,replacement in select * from(values
  ('public.doctor_bp_repeat_notes()', '''systolic'',n.systolic,', '''entrySource'',(select pm.entry_source from public.patient_measurements pm where pm.id=n.measurement_id),''systolic'',n.systolic,'),
  ('public._bp_week_json(public.bp_weeks)', '''pulse'',m.pulse,''measuredAt'',m.measured_at)', '''pulse'',m.pulse,''entrySource'',m.entry_source,''measuredAt'',m.measured_at)'),
  ('public.member_bp_read_for(uuid)', '''pulse'',m.pulse,''measuredAt'',m.measured_at)', '''pulse'',m.pulse,''entrySource'',m.entry_source,''measuredAt'',m.measured_at)'),
  ('public.bp_staff_member_devices_unlogged(uuid)', '''source'',case when exists', '''entrySource'',m.entry_source,''source'',case when exists'),
  ('public.zoe_run_claim(integer)', '''systolic'',pm.systolic,''diastolic'',pm.diastolic,', '''systolic'',pm.systolic,''diastolic'',pm.diastolic,''entrySource'',pm.entry_source,')
 )v(sig,old,replacement)loop
  d:=pg_get_functiondef(sig::regprocedure);
  if cardinality(string_to_array(d,old))<>2 then raise exception 'Unexpected BP evidence definition: %',sig;end if;
  execute replace(d,old,replacement);
 end loop;
 -- Urgent advice is published before the background observation save. Accept only those completed
 -- urgent runs in addition to started ones; member/message validation and replay keys stay unchanged.
 sig:='public.zoe_run_bp_typed_save(uuid,bigint,integer,integer,integer)';
 old:='if not found or r.state<>''started''';
 replacement:='if not found or (r.state<>''started'' and not coalesce(r.state=''finished'' and
  (r.outcome=''intake_escalated'' or r.outcome=''discarded'' and r.reason_code like ''urgent\_%''),false))';
 d:=pg_get_functiondef(sig::regprocedure);
 if cardinality(string_to_array(d,old))<>2 then raise exception 'Unexpected typed BP save definition';end if;
 execute replace(d,old,replacement);
 -- Zoe can still quote an observation as reported, separate from its verified week.
 sig:='public.zoe_run_health_context(uuid[])';d:=pg_get_functiondef(sig::regprocedure);old:='''bpWeek'',(';
 replacement:=$new$'bpReported',coalesce((select jsonb_agg(jsonb_build_object('systolic',o.systolic,'diastolic',o.diastolic,
    'daysAgo',floor(extract(epoch from clock_timestamp()-o.measured_at)/86400)::integer,'entrySource',o.entry_source)order by o.measured_at desc,o.id)
   from(select m.* from public.patient_measurements m where m.user_id=r.member_id and m.entry_source='patient_text_entry'
    and m.measured_at<=clock_timestamp()and m.measured_at>clock_timestamp()-interval '7 days'order by m.measured_at desc,m.id limit 20)o),'[]'::jsonb),
   'bpWeek',($new$;
 if cardinality(string_to_array(d,old))<>2 then raise exception 'Unexpected Zoe BP context';end if;
 execute replace(d,old,replacement);
end $migration$;

-- Verification work has no clinical zone or deadline. Keep all existing clinical
-- task requirements, with one narrow exception for these internally created rows.
do $$declare c record;zone_checks integer:=0;sla_checks integer:=0;begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint
  where conrelid='public.care_queue_tasks'::regclass and contype='c'loop
  if strpos(c.definition,'zone IS NULL')>0 and strpos(c.definition,'''admin''')>0 then
   execute format('alter table public.care_queue_tasks drop constraint %I',c.conname);zone_checks:=zone_checks+1;
  elsif strpos(c.definition,'sla_deadline IS NOT NULL')>0 then
   execute format('alter table public.care_queue_tasks drop constraint %I',c.conname);sla_checks:=sla_checks+1;
  end if;
 end loop;
 if zone_checks<>1 or sla_checks<>1 then raise exception 'Unexpected care queue verification constraints';end if;
end$$;
alter table public.care_queue_tasks add constraint care_queue_zone_or_verification check(
 ((queue='admin')=(zone is null))or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource'='patient_text_entry',false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));
alter table public.care_queue_tasks add constraint care_queue_sla_or_verification check(
 queue='admin'or sla_deadline is not null or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource'='patient_text_entry',false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));

-- A verification task is separate from the clinical alert's lifecycle. Its identity
-- is the observation, so saves/replays cannot multiply it and #565 never merges it
-- away. Keep a task even before a team is assigned; the existing queue ACL controls
-- who may see it when assignment happens. No external delivery is introduced.
create function public._typed_bp_task(m public.patient_measurements)returns void
language plpgsql security definer set search_path=''as $$
declare task uuid;note uuid;alert uuid;body jsonb;
begin
 if m.entry_source is distinct from 'patient_text_entry' or m.systolic<180 then return;end if;
 select n.id into note from public.bp_repeat_notes n where n.member_id=m.user_id and n.measurement_id=m.id order by n.created_at,n.id limit 1;
 select s.alert_id into alert from public.care_alert_screenings s join public.patient_measurements rpt on rpt.id::text=s.source_ref and rpt.user_id=m.user_id
  where s.member_id=m.user_id and s.source='reading'and s.alert_id is not null
   and(rpt.id=m.id or rpt.measured_at between m.measured_at and m.measured_at+interval '120 minutes')
  order by(rpt.id=m.id)desc,rpt.measured_at,rpt.id limit 1;
 body:=jsonb_build_object('text','Check reported BP '||m.systolic||'/'||m.diastolic||' mmHg. Member-reported, not verified',
  'systolic',m.systolic,'diastolic',m.diastolic,'entrySource',m.entry_source,'measurementId',m.id,'noteId',note,'alertId',alert);
 insert into public.care_queue_tasks(member_id,queue,zone,reason_code,rule_version,red_flags_status,suggested_action,summary,sla_deadline,source_ref,sandbox)
 values(m.user_id,'nurse',null,'bp_member_reported_high','typed-bp-1',null,'verify_bp',body,
  null,'typed-bp:'||m.id::text,coalesce((select is_test_account from public.profiles where id=m.user_id),false))
 on conflict(member_id,queue,source_ref)do nothing returning id into task;
 if task is not null then
  insert into public.care_queue_task_events(task_id,from_status,to_status,actor_id)values(task,null,'sent',null);
 else
  -- Only enrich links. Never reopen work or replace a link established on rpt.
  update public.care_queue_tasks set summary=summary||jsonb_strip_nulls(jsonb_build_object('noteId',coalesce(summary->>'noteId',note::text),'alertId',coalesce(summary->>'alertId',alert::text)))
   where member_id=m.user_id and queue='nurse'and source_ref='typed-bp:'||m.id::text;
 end if;
end$$;
create function public._typed_bp_task_saved()returns trigger
language plpgsql security definer set search_path=''as $$begin perform public._typed_bp_task(new);return null;end$$;
-- Runs after bp_check_saved, whose existing note/alert must be linked, not copied.
create trigger typed_bp_task_saved after insert or update of entry_source on public.patient_measurements
 for each row execute function public._typed_bp_task_saved();

-- A repeat may create the alert after the original task. Link the same episode's
-- existing tasks after screening has its alert id. Keep both surfaces actionable.
create function public._typed_bp_task_alert_link()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.source='reading'and new.alert_id is not null then
  update public.care_queue_tasks t set summary=t.summary||jsonb_build_object('alertId',new.alert_id)
   from public.patient_measurements m,public.patient_measurements rpt
   where t.member_id=new.member_id and t.queue='nurse'and t.summary->>'alertId'is null and t.source_ref='typed-bp:'||m.id::text
    and m.user_id=new.member_id and rpt.user_id=new.member_id and rpt.id::text=new.source_ref
    and(m.id=rpt.id or m.measured_at between rpt.measured_at-interval '120 minutes'and rpt.measured_at);
 end if;
 return null;
end$$;
create trigger typed_bp_task_alert_link after insert or update of alert_id on public.care_alert_screenings
 for each row execute function public._typed_bp_task_alert_link();
revoke all on function public._typed_bp_task(public.patient_measurements),public._typed_bp_task_saved(),public._typed_bp_task_alert_link()
 from public,anon,authenticated,service_role;

-- Backfill only stored observations. No conversation text parsing or fabrication.
do $$declare m public.patient_measurements;begin
 for m in select * from public.patient_measurements where entry_source='patient_text_entry'and systolic>=180 loop
  perform public._typed_bp_task(m);
 end loop;
end$$;
