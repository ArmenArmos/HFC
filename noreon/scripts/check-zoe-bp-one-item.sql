-- Synthetic fixtures only. Run after a clean replay, and roll everything back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.claim(m uuid default null)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',case when m is null then '{"role":"service_role"}'else jsonb_build_object('sub',m,'role','authenticated')::text end,true);end$$;
create function pg_temp.save(m uuid,s integer,d integer,ago integer default 0)returns uuid language plpgsql as $$declare r uuid;begin
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at,created_at)
 values(m,gen_random_uuid(),s,d,clock_timestamp()-make_interval(mins=>ago),clock_timestamp()-make_interval(mins=>ago))returning id into r;return r;end$$;
create function pg_temp.task(m uuid,e text,r uuid,q text default 'physician',z text default 'orange')returns jsonb language plpgsql as $$begin
 perform pg_temp.claim();
 return public.zoe_bp_task_raise(m,q,z,'bp_same_day','zones-v1-test','unknown',null,'{}',clock_timestamp()+case when z='yellow'then interval '48 hours'else interval '4 hours'end,e||':'||z,e,r,null,10);
end$$;
create function pg_temp.open_items(m uuid)returns bigint language sql as $$
 select(select count(*)from public.care_alerts where member_id=m and source='reading'and state<>'resolved')
  +(select count(*)from public.care_queue_tasks t where t.member_id=m and t.status in('sent','seen')
   and t.merged_into_alert_id is null
   and public._care_queue_visible(t,jsonb_build_object('id','bd000000-0000-4000-8000-000000000099','role','doctor')))
  +(select count(*)from public.bp_repeat_notes where member_id=m and closed_at is null)
$$;
insert into auth.users(id,email)
 select ('bd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'bp-one-'||i||'@example.test'from generate_series(1,20)i;
insert into auth.users(id,email)values('bd000000-0000-4000-8000-000000000099','bp-one-doctor@example.test');
insert into public.workspace_clinics(id,name)values('bd000000-0000-4000-8000-000000000098','Synthetic BP one clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)
 values('bd000000-0000-4000-8000-000000000099','doctor','Synthetic BP doctor','bd000000-0000-4000-8000-000000000098');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)
 select ('bd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'bd000000-0000-4000-8000-000000000099'from generate_series(1,20)i;
insert into public.care_alert_settings(enabled,telegram_delivery,sandbox_test_accounts)values(true,false,true)
 on conflict(singleton)do update set enabled=true,telegram_delivery=false,sandbox_test_accounts=true;

-- Alert first, including staff entry and repeated/replayed flow calls.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000001';r uuid;a uuid;j jsonb;begin
 perform pg_temp.claim('bd000000-0000-4000-8000-000000000099');r:=pg_temp.save(m,185,112);
 select id into a from public.care_alerts where member_id=m and source='reading';
 perform pg_temp.ok(a is not null,'Staff-entry alert was raised by the real trigger');
 for i in 1..2 loop
  j:=pg_temp.task(m,'alert-first',r);
  perform pg_temp.ok(j->>'code'='bp_alert'and j#>>'{alert,id}'=a::text and j#>>'{alert,sentTo}'='physician','Alert first: linked truthful routing');
  perform pg_temp.task(m,'alert-first',r,'nurse');
 end loop;
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Alert first: one open item');
 perform pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id=m),'Alert first: no task was inserted');
 update public.patient_clinical_cases set assigned_doctor_id=null where user_id=m;
 j:=pg_temp.task(m,'alert-first',r);
 perform pg_temp.ok(j#>>'{alert,sentTo}'is null,'Removed doctor cannot receive an alert receipt');
 update public.patient_clinical_cases set assigned_doctor_id='bd000000-0000-4000-8000-000000000099'where user_id=m;
 j:=pg_temp.task(m,'alert-first',r);
 perform pg_temp.ok(j#>>'{alert,sentTo}'='physician','Current doctor assignment controls receipt');
end$$;

-- Quiet note, then tasks, then a repeat alert. The note is replaced before the
-- repeat too, and the fallback nurse task never adds a second doctor-lane line.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000002';r uuid;r2 uuid;a uuid;t uuid;n uuid;j jsonb;before_events bigint;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112,6);
 select id into n from public.bp_repeat_notes where member_id=m and closed_at is null;
 perform pg_temp.ok(n is not null,'First reading leaves the real quiet note');
 j:=pg_temp.task(m,'note-first',r);t:=(j#>>'{task,id}')::uuid;
 perform pg_temp.task(m,'note-first',r,'nurse');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Task replaces note and duplicate nurse stays out of doctor lane');
 perform pg_temp.ok((select closed_at is not null and merged_into_task_id=t from public.bp_repeat_notes where id=n),'Quiet note links to the first surviving task');
 perform pg_temp.claim(m);r2:=pg_temp.save(m,186,113);
 select id into a from public.care_alerts where member_id=m and source='reading';
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Repeat alert replaces all earlier doctor work');
 perform pg_temp.ok((select count(*)=2 and bool_and(status in('sent','seen')and merged_into_alert_id=a and closed_at is null and closed_by is null and seen_by is null and answered_by is null)from public.care_queue_tasks where member_id=m),'A merged duplicate is linked to the alert and stays open, with no staff read or answer invented');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks qt where qt.member_id=m and qt.queue='physician'and qt.status in('sent','seen')
  and public._care_queue_visible(qt,jsonb_build_object('id','bd000000-0000-4000-8000-000000000099','role','doctor'))),'The linked physician task is still in the queue the assigned doctor reads');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks qt where qt.member_id=m and qt.queue='nurse'and qt.status in('sent','seen')),'The linked nurse duplicate is still open');
 update public.care_queue_tasks set status='answered',seen_at=clock_timestamp(),seen_by='bd000000-0000-4000-8000-000000000099',answered_at=clock_timestamp(),answered_by='bd000000-0000-4000-8000-000000000099'where member_id=m and queue='physician';
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks qt where qt.member_id=m and qt.queue='nurse'and public._care_queue_visible(qt,jsonb_build_object('id','bd000000-0000-4000-8000-000000000099','role','doctor'))),'Once the physician task is done the open nurse duplicate reaches the doctor');
 update public.care_queue_tasks set status='sent',answered_at=null,answered_by=null,seen_at=null,seen_by=null where member_id=m and queue='physician';
 perform pg_temp.ok((select count(*)=2 from public.care_queue_tasks qt where qt.member_id=m and qt.id in(select jsonb_array_elements_text(public._care_alert_json(x)#>'{bpEpisodes,0,taskIds}')::uuid from public.care_alerts x where x.id=a)),'The alert read lists the linked duplicates');
 begin update public.care_queue_tasks set status='closed',closed_at=clock_timestamp()where member_id=m and queue='physician';
  raise exception 'Expected no system close';exception when check_violation then null;end;
 perform pg_temp.ok((select closed_at is not null and merged_into_alert_id=a from public.bp_repeat_notes where id=n),'Quiet note is durably merged into alert');
 perform pg_temp.ok((select measurement_ids@>array[r,r2]and task_ids@>array[t]and note_ids@>array[n]and alert_id=a from public.zoe_bp_staff_items where member_id=m),'Episode stores readings, tasks, note and alert');
 perform pg_temp.ok((select public._care_alert_json(x)#>>'{bpEpisodes,0,id}'is not null from public.care_alerts x where id=a),'Surviving alert read exposes the linked episode');
 select count(*)into before_events from public.care_queue_task_events where task_id=t;
 perform pg_temp.task(m,'note-first',r2);perform pg_temp.task(m,'alias-from-another-tab',r2);
 perform public._bp_check_raise(m,r2::text,'bp_doctor_today',clock_timestamp());
 perform pg_temp.claim();perform public.zoe_bp_merge_retry(50);perform public.zoe_bp_merge_retry(50);
 perform pg_temp.ok((select count(*)=before_events from public.care_queue_task_events where task_id=t),'Replays append no second link event');
 perform pg_temp.ok((select count(*)=1 from public.zoe_bp_staff_items where member_id=m),'Overlapping identities share a link row');
 perform pg_temp.ok((select occurrences=1 from public.care_alerts where id=a),'Replayed screening never repeats the alert');
end$$;

-- Separate members, plain task-first (no note), and sandbox accounts.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000003';other uuid:='bd000000-0000-4000-8000-000000000004';r uuid;o uuid;j jsonb;begin
 update public.profiles set is_test_account=true where id=m;
 perform pg_temp.claim(m);r:=pg_temp.save(m,170,112);
 perform pg_temp.claim(other);o:=pg_temp.save(other,170,112);
 j:=pg_temp.task(m,'same-name',r);perform pg_temp.task(other,'same-name',o);
 perform pg_temp.ok((j#>>'{task,sandbox}')::boolean,'Test account uses the sandbox');
 perform public._bp_check_raise(m,r::text,'bp_doctor_48h',clock_timestamp());
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Task first, sandbox: one item after alert');
 perform pg_temp.ok(pg_temp.open_items(other)=1 and not exists(select 1 from public.care_alerts where member_id=other),'Another member keeps its own task');
 perform pg_temp.ok((select status='sent'from public.care_queue_tasks where member_id=other),'Another member was not merged');
 j:=public.zoe_bp_staff_item(m,'foreign-reading',o,null,10);
 perform pg_temp.ok(j->>'code'='not_found','Episode registration rejects another member reading');
end$$;

-- Nurse mark alerts have no measurement FK. They join only the same member's
-- co-temporal episode, including a live alert whose original ref was older.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000005';r uuid;n uuid;a uuid;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 perform pg_temp.task(m,'nurse-mark',r);
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,vals,submission_id,actor_id,actor_name)
 values(m,'appointment',gen_random_uuid(),'measure:bp',true,'{"systolic":186,"diastolic":122}',gen_random_uuid(),'bd000000-0000-4000-8000-000000000099','Synthetic')returning id into n;
 select id into a from public.care_alerts where member_id=m and source='reading';
 perform pg_temp.ok((select source_ref='nurse-mark:'||n::text from public.care_alerts where id=a),'Nurse mark raised the alert');
 perform pg_temp.ok(pg_temp.open_items(m)=1 and(select alert_id=a from public.zoe_bp_staff_items where member_id=m),'Nurse mark merged the episode task');
 perform pg_temp.task(m,'nurse-mark',r);
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Nurse-mark replay stays merged');
end$$;

-- Deliberately fail an alert insert. The save and task survive, and the ordinary
-- #528 retry raises the alert then merges the task without another member action.
create function pg_temp.fail_alert()returns trigger language plpgsql as $$begin
 if current_setting('test.bp_fail_alert',true)='yes'then raise exception 'Synthetic alert failure';end if;return new;end$$;
create trigger test_bp_fail_alert before insert on public.care_alerts for each row execute function pg_temp.fail_alert();
do $$declare m uuid:='bd000000-0000-4000-8000-000000000006';r uuid;r2 uuid;j jsonb;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112,6);perform pg_temp.task(m,'failed-alert',r);
 perform set_config('test.bp_fail_alert','yes',true);perform pg_temp.claim(m);r2:=pg_temp.save(m,186,113);
 perform pg_temp.ok(exists(select 1 from public.patient_measurements where id=r2),'Failed raise keeps reading');
 perform pg_temp.ok(exists(select 1 from public.bp_check_retries where ref=r2::text),'Failed raise has durable retry');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Failed raise leaves the task open');
 perform set_config('test.bp_fail_alert','no',true);perform pg_temp.claim();j:=public.bp_check_retry(50);
 perform pg_temp.ok(j->>'failed'='0'and pg_temp.open_items(m)=1,'Retry raises and merges without member action');
 perform pg_temp.ok(exists(select 1 from public.care_queue_tasks where member_id=m and status='sent'and merged_into_alert_id is not null and closed_by is null),'Retry links the task and leaves it open');
 perform public.bp_check_retry(50);perform public.zoe_bp_merge_retry(50);
 perform pg_temp.ok((select count(*)=1 and max(occurrences)=1 from public.care_alerts where member_id=m),'Retry replay is idempotent');
end$$;

-- Deliberately fail the merge after the alert is saved. The alert must survive;
-- the new sweep retries the link, with one append-only event.
create function pg_temp.fail_merge()returns trigger language plpgsql as $$begin
 if new.merged_into_alert_id is not null and current_setting('test.bp_fail_merge',true)='yes'then raise exception 'Synthetic merge failure';end if;return new;end$$;
create trigger test_bp_fail_merge before update on public.care_queue_tasks for each row execute function pg_temp.fail_merge();
do $$declare m uuid:='bd000000-0000-4000-8000-000000000007';r uuid;t uuid;j jsonb;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,170,112);j:=pg_temp.task(m,'failed-merge',r);t:=(j#>>'{task,id}')::uuid;
 perform set_config('test.bp_fail_merge','yes',true);
 perform public._bp_check_raise(m,r::text,'bp_doctor_48h',clock_timestamp());
 perform pg_temp.ok(exists(select 1 from public.care_alerts where member_id=m),'Merge failure preserves alert');
 perform pg_temp.ok((select status='sent'from public.care_queue_tasks where id=t),'Merge failure preserves original task until sweep');
 perform pg_temp.ok(exists(select 1 from public.conversation_trace_events where member_id=m and name='bp_episode.merge_failed'),'Failure is traced');
 perform set_config('test.bp_fail_merge','no',true);perform pg_temp.claim();perform public.zoe_bp_merge_retry(50);perform public.zoe_bp_merge_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Sweep converges after merge failure');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_task_events where task_id=t and detail->>'action'='bp_linked_to_alert'and actor_id is null),'One audited link');
 begin update public.care_queue_task_events set to_status='sent'where task_id=t;raise exception 'Expected immutable event';exception when sqlstate '55000'then null;end;
end$$;

-- A zone increase inside the five-minute #528 rest still leaves one physician
-- item, with the original identity, promoted urgency and an append-only audit.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000010';r uuid;r2 uuid;j jsonb;t uuid;deadline timestamptz;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,170,112,2);
 r2:=pg_temp.save(m,170,112,1);
 j:=pg_temp.task(m,'promotion',r2,'physician','yellow');t:=(j#>>'{task,id}')::uuid;deadline:=(j#>>'{task,slaDeadline}')::timestamptz;
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 j:=pg_temp.task(m,'promotion',r);
 perform pg_temp.ok(j#>>'{task,id}'=t::text and j#>>'{task,zone}'='orange','Same task is promoted to orange');
 perform pg_temp.ok((j#>>'{task,slaDeadline}')::timestamptz<deadline,'Promotion brings the deadline forward');
 perform pg_temp.ok(not exists(select 1 from public.care_alerts where member_id=m),'Inside five minutes there is still no alert');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'No-alert zone change still leaves one doctor item');
 perform pg_temp.task(m,'promotion',r);perform pg_temp.task(m,'promotion-alias',r,'physician','yellow');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks where member_id=m and queue='physician'),'Zone and alias replays do not duplicate');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_task_events where task_id=t and detail->>'action'='bp_zone_promoted'),'One system promotion event');
 update public.care_queue_tasks set status='answered',seen_at=clock_timestamp(),seen_by='bd000000-0000-4000-8000-000000000099',
  answered_at=clock_timestamp(),answered_by='bd000000-0000-4000-8000-000000000099'where id=t;
 j:=pg_temp.task(m,'promotion',r);
 perform pg_temp.ok(j#>>'{task,id}'=t::text and j#>>'{task,status}'='answered','Promoted evidence replays its completed task');
end$$;

-- An old repeat card can outlive its episode. Reusing its alias tomorrow must
-- not inherit a resolved alert or close the new note as if a doctor was told.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000011';old uuid;r uuid;a uuid;j jsonb;begin
 perform pg_temp.claim(m);old:=pg_temp.save(m,185,112,1500);
 perform pg_temp.task(m,'stale-card',old);
 perform public._bp_check_raise(m,old::text,'bp_doctor_today',clock_timestamp()-interval '25 hours');
 select id into a from public.care_alerts where member_id=m;
 update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='bd000000-0000-4000-8000-000000000099',resolution='member_contacted',
  acknowledged_at=clock_timestamp(),acknowledged_by='bd000000-0000-4000-8000-000000000099'where id=a;
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 j:=pg_temp.task(m,'stale-card',r);
 perform pg_temp.ok(j->>'ok'='true'and j#>>'{task,status}'='sent','Stale alias starts fresh work');
 perform pg_temp.ok((select count(*)=2 from public.zoe_bp_staff_items where member_id=m),'Disconnected episodes have separate link rows');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Fresh episode leaves one open doctor item');
 perform pg_temp.ok((select merged_into_alert_id is null from public.bp_repeat_notes where member_id=m),'Today note never merges into yesterday alert');
end$$;

-- A task made by #565 before this adapter used the measurement source key.
-- Registering the actual reading adopts it; an alert then merges it normally.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000012';r uuid;j jsonb;t uuid;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,170,112);
 perform pg_temp.claim();
 j:=public.care_queue_raise(m,'physician','orange','bp_same_day','zones-v1-test','unknown',null,'{}',clock_timestamp()+interval '4 hours',r::text||':orange');
 t:=(j#>>'{task,id}')::uuid;
 perform public.zoe_bp_staff_item(m,r::text,r,null,10);
 perform public._bp_check_raise(m,r::text,'bp_doctor_48h',clock_timestamp());
 perform pg_temp.ok(pg_temp.open_items(m)=1,'An adopted legacy task merges into its reading alert');
 perform pg_temp.ok((select status='sent'and merged_into_alert_id is not null and closed_at is null from public.care_queue_tasks where id=t),'Legacy source is durably linked and still open');
end$$;

-- A task can land even if storing its link fails. Re-discovering its canonical
-- source in the sweep must recover the note/task/alert relationship.
create function pg_temp.fail_link()returns trigger language plpgsql as $$begin
 if cardinality(new.task_ids)>0 and current_setting('test.bp_fail_link',true)='yes'then raise exception 'Synthetic link failure';end if;return new;end$$;
create trigger test_bp_fail_link before update on public.zoe_bp_staff_items for each row execute function pg_temp.fail_link();
do $$declare m uuid:='bd000000-0000-4000-8000-000000000013';r uuid;j jsonb;t uuid;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 perform set_config('test.bp_fail_link','yes',true);j:=pg_temp.task(m,'failed-link',r);t:=(j#>>'{task,id}')::uuid;
 perform pg_temp.ok(j->>'ok'='true'and exists(select 1 from public.patient_measurements where id=r),'Failed link preserves reading and successful task receipt');
 perform public._bp_check_raise(m,r::text,'bp_doctor_today',clock_timestamp());
 perform pg_temp.ok(exists(select 1 from public.care_alerts where member_id=m),'Failed link preserves alert');
 perform set_config('test.bp_fail_link','no',true);perform pg_temp.claim();perform public.zoe_bp_merge_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Sweep repairs a lost task link');
 perform pg_temp.ok((select t=any(task_ids)and cardinality(note_ids)=1 and alert_id is not null from public.zoe_bp_staff_items where member_id=m),'Sweep restores all durable links');
end$$;

-- Partial success: only the nurse task lands, and with no eligible nurse it
-- reaches the doctor. It must replace the quiet note too.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000014';r uuid;j jsonb;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 j:=pg_temp.task(m,'nurse-fallback-only',r,'nurse');
 perform pg_temp.ok(j->>'ok'='true'and pg_temp.open_items(m)=1,'Nurse fallback alone leaves one doctor-facing item');
 perform pg_temp.ok((select merged_into_task_id=(j#>>'{task,id}')::uuid from public.bp_repeat_notes where member_id=m),'Quiet note links to the actual fallback task');
end$$;

-- Completed work is history, not coverage for the next reading. Exact-reading
-- replays still return the stored task, even when its source alias is reused.
do $$declare m uuid;r uuid;r2 uuid;t uuid;j jsonb;state text;begin
 foreach state in array array['answered','closed']loop
  m:=case when state='answered'then 'bd000000-0000-4000-8000-000000000015'::uuid else 'bd000000-0000-4000-8000-000000000016'::uuid end;
  perform pg_temp.claim(m);r:=pg_temp.save(m,170,112,2);r2:=pg_temp.save(m,170,112,1);
  j:=pg_temp.task(m,'completed',r2,'physician','yellow');t:=(j#>>'{task,id}')::uuid;
  update public.care_queue_tasks set status=state,seen_at=clock_timestamp(),seen_by='bd000000-0000-4000-8000-000000000099',
   answered_at=clock_timestamp(),answered_by='bd000000-0000-4000-8000-000000000099',
   closed_at=case when state='closed'then clock_timestamp()end,closed_by=case when state='closed'then 'bd000000-0000-4000-8000-000000000099'::uuid end where id=t;
  j:=pg_temp.task(m,'completed',r2,'physician','yellow');
  perform pg_temp.ok(j#>>'{task,id}'=t::text and j#>>'{task,status}'=state,'Completed exact replay returns stored work');
  update public.patient_clinical_cases set assigned_doctor_id=null where user_id=m;
  j:=pg_temp.task(m,'completed',r2,'physician','yellow');
  perform pg_temp.ok(j->>'code'='no_care_team','Completed replay still validates current routing');
  update public.patient_clinical_cases set assigned_doctor_id='bd000000-0000-4000-8000-000000000099'where user_id=m;
  perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
  -- Only the nurse raise lands first. A completed physician item cannot hide it.
  j:=pg_temp.task(m,'completed',r,'nurse');
  perform pg_temp.ok(pg_temp.open_items(m)=1,'Completed physician never hides the new nurse fallback');
  j:=pg_temp.task(m,'completed',r);
  perform pg_temp.ok(j#>>'{task,id}'<>t::text and j#>>'{task,status}'='sent'and j#>>'{task,zone}'='orange','New orange evidence creates actionable orange work');
  perform pg_temp.ok(not exists(select 1 from public.care_alerts where member_id=m),'Inside five minutes no repeat alert fires');
  perform pg_temp.ok(pg_temp.open_items(m)=1,'Completed yellow then orange leaves exactly one open doctor item');
  t:=(j#>>'{task,id}')::uuid;j:=pg_temp.task(m,'completed',r);
  perform pg_temp.ok(j#>>'{task,id}'=t::text,'New orange replay is idempotent');
  update public.care_queue_tasks set status='answered',seen_at=clock_timestamp(),seen_by='bd000000-0000-4000-8000-000000000099',
   answered_at=clock_timestamp(),answered_by='bd000000-0000-4000-8000-000000000099'where id=t;
  perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);j:=pg_temp.task(m,'completed',r);
  perform pg_temp.ok(j#>>'{task,id}'<>t::text and j#>>'{task,status}'='sent'and pg_temp.open_items(m)=1,'New evidence in the same zone and alias also gets open work');
 end loop;
end$$;

-- A resolved staff alert cannot cover a later member reading inside the same
-- episode. Preserve the old alert link and exact replay, then allow same-day work.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000017';old uuid;r uuid;a uuid;j jsonb;begin
 perform pg_temp.claim('bd000000-0000-4000-8000-000000000099');old:=pg_temp.save(m,185,112,2);
 perform pg_temp.task(m,'resolved',old);select id into a from public.care_alerts where member_id=m;
 update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='bd000000-0000-4000-8000-000000000099',resolution='member_contacted',
  acknowledged_at=clock_timestamp(),acknowledged_by='bd000000-0000-4000-8000-000000000099'where id=a;
 j:=pg_temp.task(m,'resolved',old);
 perform pg_temp.ok(j->>'code'='bp_alert'and j#>>'{alert,id}'=a::text and pg_temp.open_items(m)=0,'Resolved exact-reading replay stays historical');
 perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);perform pg_temp.claim();
 j:=public.zoe_bp_staff_item(m,'resolved',r,null,10);
 perform pg_temp.ok(j->'alert'='null'::jsonb,'Resolved alert does not suppress new evidence');
 perform pg_temp.ok((select closed_at is null and merged_into_alert_id is null from public.bp_repeat_notes where member_id=m),'New quiet note stays open after resolution');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Unreviewed reading has one open quiet note');
 j:=pg_temp.task(m,'resolved',r);
 perform pg_temp.ok(j->>'ok'='true'and j#>>'{task,status}'='sent'and j#>>'{task,zone}'='orange','Same-day task is not suppressed by resolution');
 perform pg_temp.ok(pg_temp.open_items(m)=1,'New same-day task replaces only the new note');
 perform pg_temp.ok((select public._care_alert_json(x)#>>'{bpEpisodes,0,id}'is not null from public.care_alerts x where id=a),'Resolved historical link remains readable');
 perform public._bp_check_raise(m,r::text,'bp_doctor_today',clock_timestamp());
 perform pg_temp.ok(pg_temp.open_items(m)=1,'A later actual alert merges the new work');
 perform pg_temp.ok((select public._care_alert_json(x)#>>'{bpEpisodes,0,id}'is not null from public.care_alerts x where id=a),'Old link survives replacement by a new alert');
end$$;

-- Nearby but separate episodes: a nurse mark belongs to the closest reading
-- already saved when the mark was recorded, never a reading saved afterwards.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000018';old uuid;r uuid;n uuid;a uuid;j jsonb;begin
 perform pg_temp.claim(m);old:=pg_temp.save(m,170,112,11);perform pg_temp.task(m,'nurse-old',old);
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,vals,submission_id,actor_id,actor_name,recorded_at)
 values(m,'appointment',gen_random_uuid(),'measure:bp',true,'{"systolic":186,"diastolic":122}',gen_random_uuid(),'bd000000-0000-4000-8000-000000000099','Synthetic',clock_timestamp()-interval '2 minutes')returning id into n;
 select id into a from public.care_alerts where member_id=m;
 perform pg_temp.claim(m);r:=pg_temp.save(m,150,95);perform pg_temp.task(m,'nurse-new',r);
 perform pg_temp.ok((select alert_id is null from public.zoe_bp_staff_items where member_id=m and r=any(measurement_ids)),'Prior nurse mark cannot cover a later separate episode');
 perform pg_temp.ok(pg_temp.open_items(m)=2,'Separate episodes keep one open item each');
 update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='bd000000-0000-4000-8000-000000000099',resolution='member_contacted',
  acknowledged_at=clock_timestamp(),acknowledged_by='bd000000-0000-4000-8000-000000000099'where id=a;
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Resolving the older episode leaves the new task open');
 perform public._bp_check_raise(m,'nurse-mark:'||n::text,'bp_doctor_today',clock_timestamp());
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Historical nurse-mark replay cannot merge the newer episode');
 j:=pg_temp.task(m,'nurse-old',old);
 perform pg_temp.ok(j->>'code'='bp_alert'and j#>>'{alert,id}'=a::text and pg_temp.open_items(m)=1,'Resolved nurse episode exact replay stays historical');
end$$;

-- SQLSTATEs omitted by WHEN OTHERS (query_canceled) must still preserve the save
-- and leave durable alert/note work. Real lock contention is in the race script.
create function pg_temp.cancel_bp_work()returns trigger language plpgsql as $$begin
 if current_setting('test.bp_cancel',true)='yes'then raise exception using errcode='57014',message='Synthetic BP cancellation';end if;return new;end$$;
create trigger test_bp_cancel_note before insert on public.bp_repeat_notes for each row execute function pg_temp.cancel_bp_work();
create trigger test_bp_cancel_alert before insert on public.care_alerts for each row execute function pg_temp.cancel_bp_work();
do $$declare m uuid:='bd000000-0000-4000-8000-000000000019';r uuid;begin
 perform set_config('test.bp_cancel','yes',true);perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 perform pg_temp.ok(exists(select 1 from public.patient_measurements where id=r),'Note cancellation preserves measurement');
 perform pg_temp.ok(exists(select 1 from public.bp_check_retries where member_id=m),'Note cancellation has durable work');
 perform set_config('test.bp_cancel','no',true);perform pg_temp.claim();perform public.bp_check_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Sweep restores the quiet note without a member action');
end$$;
do $$declare m uuid:='bd000000-0000-4000-8000-000000000020';r uuid;begin
 perform set_config('test.bp_cancel','yes',true);perform pg_temp.claim('bd000000-0000-4000-8000-000000000099');r:=pg_temp.save(m,185,112);
 perform pg_temp.ok(exists(select 1 from public.patient_measurements where id=r),'Alert cancellation preserves measurement');
 perform pg_temp.ok(exists(select 1 from public.bp_check_retries where ref=r::text),'Alert cancellation has durable work');
 perform set_config('test.bp_cancel','no',true);perform pg_temp.claim();perform public.bp_check_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1 and not exists(select 1 from public.bp_check_retries where member_id=m),'Sweep restores the alert and clears retry');
end$$;

-- A cancelled trace write must not undo the retry row (it is the only durable record of the work).
create function pg_temp.cancel_trace()returns trigger language plpgsql as $$begin
 if current_setting('test.bp_cancel_trace',true)='yes'then raise exception using errcode='57014',message='Synthetic trace cancellation';end if;return new;end$$;
create trigger test_bp_cancel_trace before insert on public.conversation_trace_events for each row execute function pg_temp.cancel_trace();
insert into auth.users(id,email)values('bd000000-0000-4000-8000-000000000021','bp-one-21@example.test'),('bd000000-0000-4000-8000-000000000022','bp-one-22@example.test');
do $$declare m uuid:='bd000000-0000-4000-8000-000000000021';r uuid;begin
 perform set_config('test.bp_cancel','yes',true);perform set_config('test.bp_cancel_trace','yes',true);perform pg_temp.claim(m);r:=pg_temp.save(m,185,112);
 perform pg_temp.ok(exists(select 1 from public.patient_measurements where id=r),'Trace cancellation keeps the measurement (note)');
 perform pg_temp.ok(exists(select 1 from public.bp_check_retries where member_id=m),'Trace cancellation keeps the note retry row');
 perform set_config('test.bp_cancel','no',true);perform set_config('test.bp_cancel_trace','no',true);perform pg_temp.claim();perform public.bp_check_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1,'Sweep restores the quiet note after a cancelled trace');
end$$;
do $$declare m uuid:='bd000000-0000-4000-8000-000000000022';r uuid;begin
 perform set_config('test.bp_cancel','yes',true);perform set_config('test.bp_cancel_trace','yes',true);perform pg_temp.claim('bd000000-0000-4000-8000-000000000099');r:=pg_temp.save(m,185,112);
 perform pg_temp.ok(exists(select 1 from public.patient_measurements where id=r),'Trace cancellation keeps the measurement (alert)');
 perform pg_temp.ok(exists(select 1 from public.bp_check_retries where ref=r::text),'Trace cancellation keeps the alert retry row');
 perform set_config('test.bp_cancel','no',true);perform set_config('test.bp_cancel_trace','no',true);perform pg_temp.claim();perform public.bp_check_retry(50);
 perform pg_temp.ok(pg_temp.open_items(m)=1 and not exists(select 1 from public.bp_check_retries where member_id=m),'Sweep restores the alert after a cancelled trace');
end$$;

-- Rows the old merge closed with no person: while the alert is open the task opens again with a history line;
-- once a person has closed the alert they stay as they were. (The trigger is off only to build the old shape.)
do $$declare m uuid:='bd000000-0000-4000-8000-000000000023';m2 uuid:='bd000000-0000-4000-8000-000000000024';t uuid;t2 uuid;a uuid;a2 uuid;r uuid;j jsonb;n integer;begin
 insert into auth.users(id,email)values(m,'bp-one-23@example.test'),(m2,'bp-one-24@example.test');
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(m,'bd000000-0000-4000-8000-000000000099'),(m2,'bd000000-0000-4000-8000-000000000099');
 perform pg_temp.claim(m);r:=pg_temp.save(m,170,112);j:=pg_temp.task(m,'old-merge',r);t:=(j#>>'{task,id}')::uuid;
 perform public._bp_check_raise(m,r::text,'bp_doctor_48h',clock_timestamp());select id into a from public.care_alerts where member_id=m;
 perform pg_temp.claim(m2);r:=pg_temp.save(m2,170,112);j:=pg_temp.task(m2,'old-merge',r);t2:=(j#>>'{task,id}')::uuid;
 perform public._bp_check_raise(m2,r::text,'bp_doctor_48h',clock_timestamp());select id into a2 from public.care_alerts where member_id=m2;
 update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='bd000000-0000-4000-8000-000000000099',resolution='member_contacted',
  acknowledged_at=clock_timestamp(),acknowledged_by='bd000000-0000-4000-8000-000000000099'where id=a2;
 alter table public.care_queue_tasks disable trigger care_queue_tasks_no_system_close;
 update public.care_queue_tasks set status='closed',closed_at=clock_timestamp(),closed_by=null where id in(t,t2);
 alter table public.care_queue_tasks enable trigger care_queue_tasks_no_system_close;
 perform pg_temp.claim();n:=public._care_queue_reopen_merge_closed();
 perform pg_temp.ok((select status='sent'and closed_at is null and merged_into_alert_id=a from public.care_queue_tasks where id=t),'A task the old merge closed under an open alert opens again');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_task_events where task_id=t and detail->>'action'='bp_merge_close_reopened'),'The reopening is in the task history');
 perform pg_temp.ok((select status='closed'and closed_by is null from public.care_queue_tasks where id=t2),'A task under an alert a person already closed is left as it was');
 perform pg_temp.ok(public._care_queue_reopen_merge_closed()=0,'The repair is idempotent');
 -- A person's close of a linked task stays a person's close: it cannot be turned back into an actorless one, and the member's chip reads it as done.
 update public.care_queue_tasks set status='closed',seen_at=clock_timestamp(),seen_by='bd000000-0000-4000-8000-000000000099',answered_at=clock_timestamp(),answered_by='bd000000-0000-4000-8000-000000000099',
  closed_at=clock_timestamp(),closed_by='bd000000-0000-4000-8000-000000000099'where id=t;
 begin update public.care_queue_tasks set closed_by=null where id=t;raise exception 'Expected the person to stay recorded';exception when check_violation then null;end;
 perform pg_temp.claim(m);
 perform pg_temp.ok(not(public.care_queue_member_tasks()#>'{tasks,0}' ? 'mergedIntoAlertId'),'A task a person closed is not reported to the member as merged');
 perform pg_temp.claim(m2);
 perform pg_temp.ok(public.care_queue_member_tasks()#>'{tasks,0,mergedIntoAlertId}'=to_jsonb(a2::text),'An old actorless merge close is still reported as merged');
 perform pg_temp.claim();
end$$;

-- Staff closure checks remain strict. No invented actor permits a staff close.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000008';r uuid;j jsonb;t uuid;begin
 perform pg_temp.claim(m);r:=pg_temp.save(m,150,95);j:=pg_temp.task(m,'staff-checks',r);t:=(j#>>'{task,id}')::uuid;
 begin update public.care_queue_tasks set status='closed',closed_at=clock_timestamp()where id=t;
  raise exception 'Expected staff actor check';exception when check_violation then null;end;
 perform pg_temp.ok((select status='sent'from public.care_queue_tasks where id=t),'An unaudited staff close still fails');
end$$;

-- V3 off: no episode rows. #528 raises normally, including a same-reading replay.
do $$declare m uuid:='bd000000-0000-4000-8000-000000000009';r uuid;begin
 perform pg_temp.claim('bd000000-0000-4000-8000-000000000099');r:=pg_temp.save(m,185,112);
 perform public._bp_check_raise(m,r::text,'bp_doctor_today',clock_timestamp());
 perform pg_temp.ok(not exists(select 1 from public.zoe_bp_staff_items where member_id=m),'No V3 calls create no link rows');
 perform pg_temp.ok((select count(*)=1 and max(occurrences)=1 from public.care_alerts where member_id=m),'V3 off preserves #528');
end$$;
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_bp_staff_items','select'),'Link table is not member-readable');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_bp_staff_item(uuid,text,uuid,uuid,integer)','execute'),'Episode registration is service only');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_bp_merge_retry(integer)','execute'),'Sweep is service only');
rollback;
