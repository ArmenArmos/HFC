-- WP T: member_risk_tiers and care_team_worklist (20261108080830_risk_tiers_worklist.sql). Rolled back; synthetic fixtures.
-- Staff: 03 family physician (clinic 10), 04 cardiologist (clinic 11), 0d doctor (clinic 11), 05 admin, 06 nurse (clinic 10),
-- 09 coordinator (clinic 10). Members 11..17 belong to 03 (11..13 also to nurse 06, 12 also to cardiologist 04), 18 to 0d,
-- 19 is a test account of 03.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;
exception when insufficient_privilege then return true;end$$;
create function pg_temp.state(q text)returns text language plpgsql as $$begin execute q;return 'ok';
exception when others then return sqlstate;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5ec0f000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5ec0f000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.as_user(u text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(u),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
-- The listed member ids, in order, as two-character suffixes.
create function pg_temp.order_of(w jsonb)returns text[] language sql as $$select coalesce(array_agg(right(i->>'memberId',2)order by o),'{}')from jsonb_array_elements(w->'items')with ordinality x(i,o)$$;

insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when m then '374990003'||n end,case when m then now()end
 from unnest(array['03','04','05','06','09','0d','11','12','13','14','15','16','17','18','19'])n,lateral(select n in('11','12','13','14','15','16','17','18','19')m)x;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['03','04','05','06','09','0d','11'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic worklist clinic A'),(pg_temp.id('1a'),'Synthetic worklist clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('03'),'doctor','Synthetic family physician',pg_temp.id('10')),(pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10')),(pg_temp.id('09'),'coordinator','Synthetic coordinator',pg_temp.id('10')),
 (pg_temp.id('0d'),'doctor','Synthetic doctor B',pg_temp.id('1a'));
insert into public.workspace_staff(user_id,role,specialty,display_name,clinic_id)values(pg_temp.id('04'),'doctor','cardiologist','Synthetic cardiologist',pg_temp.id('1a'));
insert into public.profiles(id,display_name,is_test_account)select pg_temp.id(n),'Synthetic member '||n,n='19'from unnest(array['11','12','13','14','15','16','17','18','19'])n
 on conflict(id)do update set display_name=excluded.display_name,is_test_account=excluded.is_test_account;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,assigned_cardiologist_id)values
 (pg_temp.id('11'),pg_temp.id('03'),pg_temp.id('06'),null),(pg_temp.id('12'),pg_temp.id('03'),pg_temp.id('06'),pg_temp.id('04')),
 (pg_temp.id('13'),pg_temp.id('03'),pg_temp.id('06'),null),(pg_temp.id('14'),pg_temp.id('03'),null,null),(pg_temp.id('15'),pg_temp.id('03'),null,null),
 (pg_temp.id('16'),pg_temp.id('03'),null,null),(pg_temp.id('17'),pg_temp.id('03'),null,null),(pg_temp.id('18'),pg_temp.id('0d'),null,null),
 (pg_temp.id('19'),pg_temp.id('03'),null,null);

-- 1. Recording tiers: service role only, append on change ---------------------------------------------------------------
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.member_risk_tier_record(pg_temp.id('11'),'low',0,'[]','risk-tier-1')$q$),'Staff cannot record a tier');
select pg_temp.ok(pg_temp.denied($q$select public.clinical_review_inputs(null,10,30)$q$),'Staff cannot read the job inputs');
select pg_temp.ok(pg_temp.denied($q$select * from public.member_risk_tiers$q$),'No direct table read');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.member_risk_tier_record(pg_temp.id(m),t,s,r::jsonb,'risk-tier-1',f::jsonb))->>'changed'='true','tier '||m)
 from(values('11','low',5,'["risk.contact_stale"]','{}'),('12','very_high',80,'["risk.secondary_prevention","risk.bp_alert_range"]','{}'),
  ('13','high',40,'["risk.secondary_prevention"]','{"aboveTargetStreak":3}'),('14','moderate',20,'["risk.bp_above_target"]','{}'),('15','low',5,'["risk.contact_stale"]','{}'),
  ('16','high',40,'["risk.secondary_prevention"]','{"aboveTargetStreak":0}'),('17','low',0,'[]','{}'),('18','high',40,'["risk.red_flag"]','{}'),('19','very_high',90,'["risk.open_urgent"]','{}'))v(m,t,s,r,f);
select pg_temp.ok((public.member_risk_tier_record(pg_temp.id('11'),'low',5,'["risk.contact_stale"]','risk-tier-1','{}'))->>'changed'='false','An unchanged decision appends nothing');
select pg_temp.ok((public.member_risk_tier_record(pg_temp.id('11'),'low',5,'["Not A Rule"]','risk-tier-1','{}'))->>'code'='invalid','Reasons are rule ids only');
select pg_temp.ok((public.member_risk_tier_record(pg_temp.id('11'),'extreme',5,'[]','risk-tier-1','{}'))->>'code'='invalid','Known tiers only');
select pg_temp.ok((public.member_risk_tier_record(pg_temp.id('11'),'low',5,'[]','risk-tier-1','{"name":"x"}'))->>'code'='invalid','Facts are numbers only');
select pg_temp.ok((public.clinical_review_inputs(null,3,30))->>'version'='clinical-review-inputs-v1','The job reads its inputs');
reset role;
select pg_temp.ok((select count(*)from public.member_risk_tiers where member_id=pg_temp.id('11'))=1,'History holds one row for an unchanged tier');
select pg_temp.ok(pg_temp.state($q$update public.member_risk_tiers set tier='high'$q$)='55000','History is append-only');
select pg_temp.ok(pg_temp.state($q$delete from public.member_risk_tiers$q$)='55000','History cannot be deleted');

-- 2. Open work: 14 has same-day work, 11 an overdue task, 17 was reached yesterday ---------------------------------------
insert into public.care_queue_tasks(member_id,queue,zone,reason_code,rule_version,summary,sla_deadline,source_ref)values
 (pg_temp.id('14'),'physician','orange','bp_same_day','zones-v1','{}',now()+interval '4 hours','wl:14'),
 (pg_temp.id('11'),'nurse','yellow','missed_measurements','zones-v1','{}',now()-interval '1 hour','wl:11'),
 (pg_temp.id('15'),'admin',null,'lab_booking_needed','zones-v1','{}',null,'wl:15');
insert into public.care_queue_tasks(member_id,queue,zone,reason_code,rule_version,summary,sla_deadline,source_ref,status,seen_at,seen_by,answered_at,answered_by)values
 (pg_temp.id('17'),'nurse','yellow','bp_yellow','zones-v1','{}',now()+interval '2 days','wl:17','answered',now()-interval '1 day',pg_temp.id('06'),now()-interval '1 day',pg_temp.id('06'));

-- 3. Ordering and per-role scoping -----------------------------------------------------------------------------------------
select pg_temp.as_user('03');set local role authenticated;
create temp table w03 as select public.care_team_worklist(50)w;
select pg_temp.ok((select pg_temp.order_of(w)from w03)=array['14','12','13','16','11','15','17'],
 'Physician order: same-day work, then tier, then overdue, then the above-target run, then the oldest contact (never first); the test account hidden');
select pg_temp.ok((select w->>'role'='doctor' and (w#>>'{items,0,urgent}')::int=1 and w#>'{items,0,taskKinds}'='["bp_same_day"]' and (w#>>'{items,2,aboveTargetStreak}')::int=3
 and (w#>>'{items,4,overdue}')::int=1 and w#>'{items,5,daysSinceContact}'='null'::jsonb and (w#>>'{items,6,daysSinceContact}')::int=1 from w03),'Clinical items carry the counts the order used');
select pg_temp.ok(pg_temp.order_of(public.care_team_worklist(2))=array['14','12'],'The limit keeps the top of the list');
select pg_temp.ok(pg_temp.state($q$select public.care_team_worklist(0)$q$)='22023','The limit is bounded');
reset role;
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok(pg_temp.order_of(public.care_team_worklist(50))=array['12'],'The cardiologist sees only the members they are cardiologist for');
reset role;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok(pg_temp.order_of(public.care_team_worklist(50))=array['12','13','11'],'The nurse sees the members assigned to her, in order');
reset role;
select pg_temp.as_user('0d');set local role authenticated;
select pg_temp.ok(pg_temp.order_of(public.care_team_worklist(50))=array['18'],'Another doctor sees only their own');
reset role;
select pg_temp.as_user('09');set local role authenticated;
create temp table w09 as select public.care_team_worklist(50)w;
select pg_temp.ok((select pg_temp.order_of(w)from w09)=array['14','12','13','16','11','15','17'],'The coordinator sees their clinic''s members, in the same order');
select pg_temp.ok((select bool_and(not(i?'urgent')and not(i?'overdue')and not(i?'score')and not(i?'aboveTargetStreak')and not(i?'daysSinceContact'))from w09,jsonb_array_elements(w->'items')i),'No clinical values for the coordinator');
select pg_temp.ok((select jsonb_agg(i->'taskKinds' order by i->>'memberId')from w09,jsonb_array_elements(w->'items')i where i->>'memberId' in(pg_temp.id('14')::text,pg_temp.id('15')::text))
 ='[[],["lab_booking_needed"]]','The coordinator sees logistics task kinds only');
reset role;
select pg_temp.as_user('05');set local role authenticated;
create temp table w05 as select public.care_team_worklist(50)w;
select pg_temp.ok((select '18'=any(pg_temp.order_of(w))and not('19'=any(pg_temp.order_of(w)))and cardinality(pg_temp.order_of(w))=8 from w05),'The admin sees everyone except hidden test accounts');
select pg_temp.ok((select w->>'role'='admin' and bool_and(not(i?'urgent')and not(i?'overdue')and not(i?'score')and not(i?'aboveTargetStreak')and not(i?'daysSinceContact'))
 from w05,jsonb_array_elements(w->'items')i group by w),'The admin gets the logistics shape: no clinical counts or values');
select pg_temp.ok((select bool_and(not(i->'taskKinds' ?| array['bp_same_day','missed_measurements','bp_yellow']))from w05,jsonb_array_elements(w->'items')i)
 and(select i->'taskKinds'='["lab_booking_needed"]' from w05,jsonb_array_elements(w->'items')i where i->>'memberId'=pg_temp.id('15')::text),
 'The admin sees admin-queue task kinds only, never nurse or physician reason codes');
reset role;
select pg_temp.as_user('11');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.care_team_worklist(50)$q$),'A member has no worklist');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_risk_tier(pg_temp.id('11'))$q$),'A member cannot read a tier');
reset role;
update public.workspace_staff set sees_test_members=true where user_id=pg_temp.id('03');
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok((pg_temp.order_of(public.care_team_worklist(50)))[1:3]=array['14','12','19'],'A staff member who sees test accounts sees them in order (ties by member id)');
reset role;

-- 4. The tier read and the audit ---------------------------------------------------------------------------------------
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok((public.staff_member_risk_tier(pg_temp.id('12')))#>>'{tier,tier}'='very_high','The nurse reads a tier of her member');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_risk_tier(pg_temp.id('14'))$q$),'Not of a member not assigned to her');
reset role;
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok((public.staff_member_risk_tier(pg_temp.id('12')))#>>'{tier,tier}'='very_high','The coordinator reads the tier of a clinic member');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_risk_tier(pg_temp.id('18'))$q$),'Not of another clinic');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.id('06')and surface='care_team_worklist')=3,'Each listed member is audited for the nurse');
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.id('09')and surface='care_team_worklist'and actor_role='coordinator')=7,'Coordinator reads are audited as coordinator');
select pg_temp.ok(exists(select 1 from public.access_audit where actor_id=pg_temp.id('06')and surface='risk_tier'and member_id=pg_temp.id('12')),'The tier read is audited');
select 'check-worklist: ok' as result;
rollback;
