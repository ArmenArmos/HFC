-- Recipient-bound notice links. Synthetic fixtures only; Verify auto-discovers this pair.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n integer)returns uuid language sql immutable as $$select ('d2a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.as_staff(n integer)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.id(n+1000))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.resolve(t text)returns jsonb language sql as $$select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)from public.staff_notice_resolve(t)r$$;
create function pg_temp.denied(command text)returns boolean language plpgsql as $$begin execute command;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(integer),pg_temp.as_staff(integer),pg_temp.as_service(),pg_temp.resolve(text),pg_temp.denied(text)to authenticated,service_role,anon;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated,service_role;

-- No table access, including service. Only issue is service-callable; resolve is authenticated-only.
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.staff_notice_links'::regclass),'RLS enabled');
select pg_temp.ok(not has_table_privilege(w,'public.staff_notice_links',p),w||' cannot '||p)
 from unnest(array['anon','authenticated','service_role'])w,unnest(array['select','insert','update','delete'])p;
select pg_temp.ok(not has_function_privilege('anon','public.staff_notice_issue(uuid,uuid,uuid)','execute')and not has_function_privilege('authenticated','public.staff_notice_issue(uuid,uuid,uuid)','execute')and has_function_privilege('service_role','public.staff_notice_issue(uuid,uuid,uuid)','execute'),'Only service role may issue directly');
select pg_temp.ok(not has_function_privilege('anon','public.staff_notice_resolve(text)','execute')and not has_function_privilege('service_role','public.staff_notice_resolve(text)','execute')and has_function_privilege('authenticated','public.staff_notice_resolve(text)','execute'),'Resolve requires an authenticated caller');

set local session_replication_role=replica;
insert into auth.users(id)select pg_temp.id(n)from unnest(array[1,6,7,8,17])n;
insert into public.profiles(id,display_name,locale)values(pg_temp.id(1),'Synthetic notice member','en');
insert into public.workspace_clinics(id,name)values(pg_temp.id(90),'Synthetic notice clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(6),'admin','Synthetic notice admin',null),
 (pg_temp.id(7),'doctor','Synthetic notice doctor',pg_temp.id(90)),
 (pg_temp.id(8),'nurse','Synthetic notice nurse',pg_temp.id(90)),
 (pg_temp.id(17),'doctor','Synthetic replacement',pg_temp.id(90));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+1000),pg_temp.id(n),now(),now()from unnest(array[6,7,8,17])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id(1),pg_temp.id(7),pg_temp.id(8));
reset session_replication_role;

select pg_temp.as_service();set local role service_role;
insert into r values('token',to_jsonb(public.staff_notice_issue(pg_temp.id(7),pg_temp.id(1),null)));
insert into r values('nurse',to_jsonb(public.staff_notice_issue(pg_temp.id(8),pg_temp.id(1),null)));
insert into r values('admin',to_jsonb(public.staff_notice_issue(pg_temp.id(6),pg_temp.id(1),null)));
reset role;
select pg_temp.ok((select length(v#>>'{}')=48 and v#>>'{}' ~ '^[a-f0-9]{48}$' from r where k='token'),'At least 24 random bytes');
select pg_temp.ok((select count(*)=1 and bool_and(token_hash<>v#>>'{}')and bool_and(expires_at-created_at between interval '6 days 23 hours 59 minutes'and interval '7 days 1 minute')and bool_and(last_used_at is null)
 from public.staff_notice_links,r where k='token'and token_hash=encode(extensions.digest(v#>>'{}','sha256'),'hex')),'Hash only, seven-day expiry, unused');
select pg_temp.ok(not exists(select 1 from information_schema.columns where table_schema='public'and table_name='staff_notice_links'and column_name in('token','raw_token')),'No raw token column');

-- Run before any successful open, since its FOR SHARE lock lasts until transaction end.
-- Each refusal must avoid even the case table's RowShareLock, regardless of contention.
savepoint refused_lock_checks;
select pg_temp.as_staff(8);set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Wrong recipient refused before locking')from r where k='token';
reset role;
select pg_temp.as_staff(7);set local role authenticated;
select pg_temp.ok(pg_temp.resolve(repeat('0',48))='[]','Unknown token refused before locking');
reset role;
update public.staff_notice_links set expires_at=clock_timestamp()-interval '1 second'where recipient_id=pg_temp.id(7);
set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Expired token refused before locking')from r where k='token';
reset role;
update public.staff_notice_links set expires_at=clock_timestamp()+interval '7 days'where recipient_id=pg_temp.id(7);
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(17)where user_id=pg_temp.id(1);
set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Removed assignment refused before locking')from r where k='token';
reset role;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(7)where user_id=pg_temp.id(1);
update public.workspace_staff set active=false where user_id=pg_temp.id(7);
set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Inactive staff refused before locking')from r where k='token';
reset role;
update public.workspace_staff set active=true where user_id=pg_temp.id(7);
update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=pg_temp.id(1007);
set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Expired session refused before locking')from r where k='token';
reset role;
select pg_temp.ok(not exists(select 1 from pg_locks where pid=pg_backend_pid()
 and relation='public.patient_clinical_cases'::regclass and mode='RowShareLock'),
 'No refused request acquired the case lock');
select pg_temp.ok((select count(*)=6 and bool_and(member_id is null and object_id is null)
 from public.access_audit where surface='staff_notice_refused'and actor_id in(pg_temp.id(7),pg_temp.id(8))),
 'Pre-lock refusals keep the identical target-free audit');
rollback to savepoint refused_lock_checks;
release savepoint refused_lock_checks;

select pg_temp.as_staff(7);set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.staff_notice_issue(pg_temp.id(7),pg_temp.id(1),null)'),'Authenticated cannot issue');
insert into r select 'first',pg_temp.resolve(v#>>'{}')from r where k='token';
insert into r select 'again',pg_temp.resolve(v#>>'{}')from r where k='token';
reset role;
select pg_temp.ok((select v=jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(1),'alert_id',null))from r where k='first')and(select a.v=b.v from r a,r b where a.k='first'and b.k='again'),'Assigned doctor opens and reopens the same notice');
select pg_temp.ok(exists(select 1 from pg_locks where pid=pg_backend_pid()
 and relation='public.patient_clinical_cases'::regclass and mode='RowShareLock'),
 'An allowed open retains the case lock through its authorization recheck');
select pg_temp.ok((select count(*)=2 from public.access_audit where actor_id=pg_temp.id(7)and surface='staff_notice_open')and(select last_used_at is not null from public.staff_notice_links,r where k='token'and token_hash=encode(extensions.digest(v#>>'{}','sha256'),'hex')),'Each allowed open audited, last use recorded');
select pg_temp.as_staff(8);set local role authenticated;
insert into r select 'wrong',pg_temp.resolve(v#>>'{}')from r where k='token';
insert into r select 'nurse-open',pg_temp.resolve(v#>>'{}')from r where k='nurse';
reset role;
select pg_temp.ok((select v=jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(1),'alert_id',null))from r where k='nurse-open'),'Assigned nurse may open their own notice');
select pg_temp.as_staff(6);set local role authenticated;
insert into r select 'admin-open',pg_temp.resolve(v#>>'{}')from r where k='admin';
reset role;
select pg_temp.ok((select jsonb_array_length(v)=1 from r where k='admin-open'),'Existing alert admins may open their own notice');

update public.staff_notice_links set expires_at=clock_timestamp()-interval '1 second'where recipient_id=pg_temp.id(7);
select pg_temp.as_staff(7);set local role authenticated;
insert into r select 'expired',pg_temp.resolve(v#>>'{}')from r where k='token';
insert into r values('unknown',pg_temp.resolve(repeat('0',48)));
reset role;
update public.staff_notice_links set expires_at=clock_timestamp()+interval '7 days'where recipient_id=pg_temp.id(7);
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(17)where user_id=pg_temp.id(1);
select pg_temp.as_staff(7);set local role authenticated;
insert into r select 'unassigned',pg_temp.resolve(v#>>'{}')from r where k='token';
reset role;
select pg_temp.ok((select count(*)=4 and bool_and(v='[]'::jsonb)from r where k in('wrong','expired','unknown','unassigned')),'Every refusal is the identical empty result');
select pg_temp.ok((select count(*)=4 and bool_and(member_id is null and object_id is null)from public.access_audit where actor_id in(pg_temp.id(7),pg_temp.id(8))and surface='staff_notice_refused'),'Every refused open audited without target or token');
-- Nurse assignment and active staff/session checks apply independently of token ownership.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(7),assigned_nurse_id=null where user_id=pg_temp.id(1);
select pg_temp.as_staff(8);set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Unassigned nurse refused')from r where k='nurse';
reset role;
update public.workspace_staff set active=false where user_id=pg_temp.id(7);
select pg_temp.as_staff(7);set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Inactive doctor refused')from r where k='token';
reset role;
update public.workspace_staff set active=true where user_id=pg_temp.id(7);
update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=pg_temp.id(1007);
select pg_temp.as_staff(7);set local role authenticated;
select pg_temp.ok(pg_temp.resolve(v#>>'{}')='[]','Expired session refused')from r where k='token';
reset role;
update auth.sessions set not_after=null where id=pg_temp.id(1007);

-- Exercise the actual enqueue paths, with unapproved wording unchanged and no network sends.
insert into public.care_alert_settings(singleton,enabled,telegram_delivery,sandbox_test_accounts)values(true,true,true,false)
 on conflict(singleton)do update set enabled=true,telegram_delivery=true,sandbox_test_accounts=false;
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.id(8)where user_id=pg_temp.id(1);
delete from public.care_alert_routing;
insert into public.care_alert_routing(source,primary_role,backup_role,escalate_after_minutes)values('*','nurse','doctor',15);
select public._telegram_auth_bind(pg_temp.id(7),'staff','["telegram","notice_test",9201,"user",9707]','["telegram","notice_test",9201]','+37499019707','9707',null);
select public._telegram_auth_bind(pg_temp.id(8),'staff','["telegram","notice_test",9201,"user",9708]','["telegram","notice_test",9201]','+37499019708','9708',null);
select public._telegram_auth_bind(pg_temp.id(17),'staff','["telegram","notice_test",9201,"user",9717]','["telegram","notice_test",9201]','+37499019717','9717',null);
create temp table templates as select * from public.system_message_templates where template_id in('care_alert.staff_notice','staff_message.open_label');
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen(pg_temp.id(1),'zoe','notice-token-test','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
select pg_temp.ok((select count(*)=1 from public.care_alert_deliveries where recipient_id=pg_temp.id(8)and alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1))),'Initial notice goes to nurse');
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '16 minutes'where member_id=pg_temp.id(1);
select pg_temp.as_service();set local role service_role;
select public.care_alert_escalate_due();
reset role;
select pg_temp.ok((select count(*)=1 from public.care_alert_deliveries where recipient_id=pg_temp.id(7)and alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1))),'Escalation notice goes to doctor');
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(17)where user_id=pg_temp.id(1);
select public._care_team_reconcile(pg_temp.id(1),pg_temp.id(6),'staff',gen_random_uuid());
select pg_temp.ok((select count(*)=1 from public.care_alert_deliveries where recipient_id=pg_temp.id(17)and alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1))),'Reassignment notice goes to replacement doctor');
select pg_temp.ok((select count(*)=3 and bool_and(m.keyboard->>'url' ~ '^https://backoffice[.]noreon[.]health/staff/real/n/[a-f0-9]{48}$')and bool_and(m.body=t.body)and bool_and(m.body not like '%Synthetic%'and m.body not like '%'||pg_temp.id(1)::text||'%')
 from public.care_alert_deliveries d join public.telegram_auth_messages m on m.id=d.telegram_message_id
 join public.system_message_templates t on t.template_id=m.template_id and t.version=m.template_version and t.locale=m.locale
 where d.alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1))),'All three URLs are opaque; text remains the neutral template');
select pg_temp.ok((select count(*)=3 from public.care_alert_deliveries d join public.telegram_auth_messages m on m.id=d.telegram_message_id
 join public.staff_notice_links l on l.token_hash=encode(extensions.digest(substring(m.keyboard->>'url'from '/n/([a-f0-9]+)$'),'sha256'),'hex')
 where d.alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1))and l.recipient_id=d.recipient_id and l.alert_id=d.alert_id and l.member_id=pg_temp.id(1)),'Every notice token is bound to its recipient and alert');
select pg_temp.ok(not exists((select * from templates except select * from public.system_message_templates)union all(select * from public.system_message_templates where template_id in('care_alert.staff_notice','staff_message.open_label')except select * from templates)),'Template wording and approval flags unchanged');
insert into r select 'alert-token',to_jsonb(substring(m.keyboard->>'url'from '/n/([a-f0-9]+)$'))
 from public.care_alert_deliveries d join public.telegram_auth_messages m on m.id=d.telegram_message_id
 where d.recipient_id=pg_temp.id(17)and d.alert_id in(select id from public.care_alerts where member_id=pg_temp.id(1));
select pg_temp.as_staff(17);set local role authenticated;
insert into r select 'alert-open',pg_temp.resolve(v#>>'{}')from r where k='alert-token';
reset role;
select pg_temp.ok((select v=jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(1),'alert_id',(select id from public.care_alerts where member_id=pg_temp.id(1))))from r where k='alert-open'),'A queued notice resolves to its exact member and alert');
select 'PASS staff notice links: role ACLs, recipient, expiry, reuse, care-team revalidation, audit and three enqueue paths';
rollback;

-- Additional isolated-stack, two-session check (not exercised by this single-session file):
-- Commit synthetic fixtures and tokens only in that disposable stack. Session A updates
-- the member's case without committing. Session B sets lock_timeout='100ms' and compares
-- an unknown token with the old recipient's token after a committed reassignment/removal:
-- both return [] immediately. A still-assigned recipient's token returns [] on lock
-- timeout, with one target-free refusal audit, no open audit and unchanged last_used_at.
-- Roll back A and retry: the still-assigned recipient opens successfully. Also reassign
-- in A before committing while B waits: B must recheck after the lock and return [].
