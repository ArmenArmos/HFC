-- Synthetic members only. Run after a clean migration replay; no provider calls; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n integer)returns uuid language sql immutable as $$
 select('c7800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.as_nurse()returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(12),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.id(32))::text,true)$$;
create function pg_temp.command(m integer,sub uuid,test text default null,status text default null)returns jsonb language sql as $$
 select jsonb_build_object('version','nurse-visit-v1','memberId',pg_temp.id(m),'source','home-request','sourceId',pg_temp.id(100+m),
 'submissionId',sub,'expectedRevision',d->'caseRevision','arrangementToken',d#>'{visit,arrangementToken}')
 ||case when test is null then '{"all":true}'::jsonb else jsonb_build_object('testId',test,'status',status,
 'reason',case when status='collected'then null else 'Synthetic exception reason'end)end
 from(select public.nurse_visit_detail(pg_temp.id(m),'home-request',pg_temp.id(100+m))d)s$$;
create function pg_temp.collect(m integer,test text default null,status text default null)returns jsonb language sql as $$
 select public.nurse_visit_collect(pg_temp.command(m,gen_random_uuid(),test,status))$$;
create temp table evidence(k text primary key,v jsonb);
grant all on evidence to authenticated,service_role;

-- Members 1..3: linked EN/HY/RU. 4: unlinked, clinical HY, no UI preference.
-- 5..7: linked EN/HY/RU with exceptions. 8: injected failure. 9: care off.
-- 10: linked but opted out. The UI and clinical preferences deliberately differ.
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.id(n),'3740078'||lpad(n::text,4,'0'),now()from generate_series(1,12)n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(20),'Synthetic collection clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(11),'doctor','Synthetic collection doctor',pg_temp.id(20)),
 (pg_temp.id(12),'nurse','Synthetic collection nurse',pg_temp.id(20));
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.id(32),pg_temp.id(12),now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)
 select pg_temp.id(n),pg_temp.id(11),pg_temp.id(12)from generate_series(1,10)n;
insert into public.profiles(id,locale,ui_locale,display_name)
 select pg_temp.id(n),case when n in(2,6)then 'en'else 'hy'end,
 case when n=4 then null when n in(2,6)then 'hy'when n in(3,7)then 'ru'else 'en'end,'Synthetic collection member'
 from generate_series(1,10)n on conflict(id)do update set locale=excluded.locale,ui_locale=excluded.ui_locale;
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select pg_temp.id(100+n),pg_temp.id(n),'confirmed','{}',
 '[{"id":"hba1c","title":"HbA1c","method":"lab"},{"id":"lipid-panel","title":"Lipid profile with LDL-C","method":"lab"},{"id":"creatinine-egfr","title":"Creatinine and eGFR","method":"lab"},{"id":"urine-acr","title":"Urine albumin to creatinine ratio (ACR)","method":"lab"},{"id":"urinalysis","title":"Urinalysis","method":"lab"},{"id":"potassium","title":"Potassium","method":"lab"},{"id":"sodium","title":"Sodium","method":"lab"},{"id":"cbc-hb","title":"Full blood count","method":"lab"}]',
 'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',date_trunc('minute',now()),
 'endsAt',date_trunc('minute',now())+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street'))from generate_series(1,10)n;
-- Do not manufacture link side effects: these are synthetic bindings, as in the notice suite.
set local session_replication_role=replica;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_sc',9278,600,'synthetic-sc')
 on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id(n),'member','synthetic-collected-'||n,public._telegram_account_ref(s),'+3740078'||lpad(n::text,4,'0'),'57800'||n,1
 from public.telegram_channel_settings s cross join unnest(array[1,2,3,5,6,7,8,9,10])n;
set local session_replication_role=origin;
insert into public.telegram_audit(member_id,kind,detail,created_at)values
 (pg_temp.id(10),'link.redeemed','{}',now()-interval '1 minute'),(pg_temp.id(10),'link.unlinked','{}',now());
update public.nurse_visit_settings set enabled=true;
update public.member_notice_settings set care=true,throttle_seconds=0,hourly_cap=60;
select pg_temp.ok((select count(*)=6 and bool_and(not approved)from public.system_message_templates
 where template_id in('member.samples_collected','member.samples_collected_exceptions')),'All three languages registered as unapproved Telegram drafts');
select pg_temp.ok(not has_function_privilege('authenticated','public._sample_collected_notice(uuid,text,uuid,timestamptz,jsonb)','execute')
 and not has_function_privilege('service_role','public._sample_collected_notice(uuid,text,uuid,timestamptz,jsonb)','execute'),'Notice helper is internal');

-- Confirm-all uses the actual nurse RPC. Save its command to exercise exact replay.
select pg_temp.as_nurse();
set local role authenticated;
insert into evidence select 'original',pg_temp.command(1,gen_random_uuid());
insert into evidence select 'all-en',public.nurse_visit_collect(v)from evidence where k='original';
insert into evidence select 'replay',public.nurse_visit_collect(v)from evidence where k='original';
insert into evidence values('second-confirm',pg_temp.collect(1));
insert into evidence values('all-hy',pg_temp.collect(2)),('all-ru',pg_temp.collect(3)),('unlinked',pg_temp.collect(4)),('opted-out',pg_temp.collect(10));
reset role;
select pg_temp.ok((select bool_and(v->>'status'='saved')from evidence where k<>'original'),'Confirm, replay and no-op confirm save');
select pg_temp.ok((select v->>'replayed'='true'from evidence where k='replay'),'Replay returns its receipt');
select pg_temp.ok((select count(*)=1 and bool_and(app_text='Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.')
 from public.member_notices where member_id=pg_temp.id(1)),'EN exact text, one app message despite replay and second confirm');
select pg_temp.ok((select count(*)=1 and bool_and(app_text='Ձեր նմուշները վերցված են։ Կտեղեկացնենք ձեզ, երբ ձեր բժիշկը վերանայի արդյունքները և հաստատի ձեր պլանը։')
 from public.member_notices where member_id=pg_temp.id(2)),'HY exact text uses screen language before clinical language');
select pg_temp.ok((select count(*)=1 and bool_and(app_text='Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.')
 from public.member_notices where member_id=pg_temp.id(3)),'RU uses English until Russian wording is approved');
select pg_temp.ok((select count(*)=1 and bool_and(telegram_message_id is null and reason='not_connected'and
 app_text='Ձեր նմուշները վերցված են։ Կտեղեկացնենք ձեզ, երբ ձեր բժիշկը վերանայի արդյունքները և հաստատի ձեր պլանը։')
 from public.member_notices where member_id=pg_temp.id(4)),'Unlinked gets app only, clinical locale when screen locale absent');
select pg_temp.ok((select count(*)=1 and bool_and(telegram_message_id is null and reason='turned_off'and app_text is not null)
 from public.member_notices where member_id=pg_temp.id(10)),'Opted-out member still gets the app notice');
select pg_temp.ok((select count(*)=3 and bool_and(n.outcome='queued'and n.notice_group='care'and o.locale=case when p.ui_locale='ru'then 'en'else p.ui_locale end)
 from public.member_notices n join public.telegram_auth_messages o on o.id=n.telegram_message_id join public.profiles p on p.id=n.member_id
 where n.member_id in(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3))),'Linked members queue exactly one localized outbox delivery each');
-- The original, unapproved wording is really held by the normal claim path.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Outbox IDs are private, so obtain it as the test owner, then claim as service role.
insert into evidence select 'draft-message',jsonb_build_object('id',telegram_message_id)from public.member_notices where member_id=pg_temp.id(3);
set local role service_role;
insert into evidence select 'draft-held',public.telegram_auth_message_claim((v->>'id')::uuid,gen_random_uuid())from evidence where k='draft-message';
reset role;
select pg_temp.ok((select v->>'code'='template_unapproved'from evidence where k='draft-held'),'Telegram held pending wording approval');

-- Seven exceptions, both statuses, across three languages. Nothing sends while any sample is pending.
select pg_temp.as_nurse();
set local role authenticated;
do $$declare m integer;t text;n integer;v jsonb;begin
 for m in 5..7 loop
  n:=0;
  foreach t in array array['lipid-panel','creatinine-egfr','urine-acr','urinalysis','potassium','sodium','cbc-hb']loop
   n:=n+1;v:=pg_temp.collect(m,t,case when n%2=0 then 'issue'else 'not-collected'end);
   perform pg_temp.ok(v->>'status'='saved','Exception saves');
  end loop;
 end loop;
end$$;
reset role;
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id in(pg_temp.id(5),pg_temp.id(6),pg_temp.id(7))),'Pending or all-exception samples do not claim collection');
select pg_temp.as_nurse();set local role authenticated;
insert into evidence values('exceptions-en',pg_temp.collect(5)),('exceptions-hy',pg_temp.collect(6)),('exceptions-ru',pg_temp.collect(7));
reset role;
select pg_temp.ok((select bool_and(v->>'status'='saved')from evidence where k like 'exceptions-%'),'Confirm remaining collected with exceptions saves');
select pg_temp.ok((select count(*)=1 and bool_and(app_text=E'Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.\nSamples were not collected for: Lipid profile with LDL-C, Creatinine and eGFR, Urine albumin to creatinine ratio (ACR), Urinalysis, Potassium and 2 more. Your nurse will be in touch.')
 from public.member_notices where member_id=pg_temp.id(5)),'EN exceptions list first five and remaining count');
select pg_temp.ok((select count(*)=1 and bool_and(app_text=E'Ձեր նմուշները վերցված են։ Կտեղեկացնենք ձեզ, երբ ձեր բժիշկը վերանայի արդյունքները և հաստատի ձեր պլանը։\nՆմուշներ չեն վերցվել հետևյալ հետազոտությունների համար՝ Լիպիդային պրոֆիլ և LDL-C, Կրեատինին և eGFR, Միզի ալբումին/կրեատինին հարաբերություն (ACR), Մեզի ընդհանուր հետազոտություն, Կալիում և ևս 2։ Ձեր բուժքույրը կկապվի ձեզ հետ։')
 from public.member_notices where member_id=pg_temp.id(6)),'HY exceptions use the card catalogue labels');
select pg_temp.ok((select count(*)=1 and bool_and(app_text=E'Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.\nSamples were not collected for: Липидный профиль с LDL-C, Креатинин и eGFR, Соотношение альбумина и креатинина в моче (ACR), Общий анализ мочи, Калий и ещё 2. Your nurse will be in touch.')
 from public.member_notices where member_id=pg_temp.id(7)),'RU uses the English template with existing Russian catalogue labels');
select pg_temp.as_nurse();set local role authenticated;
insert into evidence values('correct-after-send',pg_temp.collect(5,'lipid-panel','collected'));
reset role;
select pg_temp.ok((select v->>'status'='saved'from evidence where k='correct-after-send')and
 (select count(*)=1 from public.member_notices where member_id=pg_temp.id(5)),'A correction saves without a second notice');

-- Synthetic approval exercises real claim rendering, without sending anything to a provider.
update public.system_message_templates set approved=true
 where template_id in('member.samples_collected_exceptions','member_notice.open_label');
insert into evidence select 'approved-message-'||p.ui_locale,jsonb_build_object('id',n.telegram_message_id,'text',n.app_text)
 from public.member_notices n join public.profiles p on p.id=n.member_id
 where n.member_id in(pg_temp.id(5),pg_temp.id(6),pg_temp.id(7));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into evidence select 'approved-claim-'||right(k,2),public.telegram_auth_message_claim((v->>'id')::uuid,gen_random_uuid())
 from evidence where k like 'approved-message-%';
reset role;
select pg_temp.ok((select count(*)=3 and bool_and(c.v->>'ok'='true'and c.v#>>'{envelope,text}'=m.v->>'text')
 from evidence c join evidence m on right(c.k,2)=right(m.k,2)
 where c.k like 'approved-claim-%'and m.k like 'approved-message-%'),'Approved Telegram claims render exactly the same text as app chat in EN/HY/RU');

-- Inject a notice write failure. The receipt and all collected marks must survive it.
create function pg_temp.fail_notice()returns trigger language plpgsql as $$begin
 if new.member_id=pg_temp.id(8)then raise exception using errcode='P0001',message='Synthetic notice failure';end if;return new;end$$;
create trigger synthetic_notice_failure before insert on public.member_notices for each row execute function pg_temp.fail_notice();
select pg_temp.as_nurse();set local role authenticated;
insert into evidence values('notice-failure',pg_temp.collect(8));
reset role;
select pg_temp.ok((select v->>'status'='saved'from evidence where k='notice-failure')and
 (select count(*)=1 from public.nurse_visit_collection_receipts where member_id=pg_temp.id(8))and
 (select count(*)=8 from public.nurse_visit_marks where member_id=pg_temp.id(8)and collection_status='collected'),'Notice failure cannot undo collection or receipt');
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id=pg_temp.id(8))and
 not exists(select 1 from public.telegram_auth_messages where principal_ref='synthetic-collected-8'),'Failed notice rolls back its outbox too');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where member_id=pg_temp.id(8)and name='member_notice.failed'and reason_code='p0001'),'Failure traced with fixed code, no member data');
drop trigger synthetic_notice_failure on public.member_notices;
update public.member_notice_settings set care=false;
select pg_temp.as_nurse();set local role authenticated;
insert into evidence values('care-off',pg_temp.collect(9));
reset role;
select pg_temp.ok((select v->>'status'='saved'from evidence where k='care-off')and
 not exists(select 1 from public.member_notices where member_id=pg_temp.id(9)),'Care switch suppresses both channels without failing collection');

-- No new results-ready notices, and old queued/history entries cannot reach members.
update public.member_notice_settings set care=true,results=true;
select public._member_notice(pg_temp.id(1),'results','member.results_received','test:disabled-results','{}','/patient/results',null);
select public._member_notice(pg_temp.id(1),'care','member.document_released','test:disabled-document','{}','/patient/results',null);
select pg_temp.ok(not exists(select 1 from public.member_notices where event_key in('test:disabled-results','test:disabled-document')),'Results and document release producers cannot create member notices');
select pg_temp.ok((select count(*)=2 and bool_and(not(chat or telegram or push))from public.notice_channels
 where template_id in('member.results_received','member.document_released')),'Every results-ready member channel is off');
select pg_temp.ok(public._member_notice_closed(pg_temp.id(1),'results.received:old','member.results_received','{}')and
 public._member_notice_closed(pg_temp.id(1),'care.document:old','member.document_released','{}'),'Already queued results-ready notices are closed at delivery claim');
insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,app_text)values
 (pg_temp.id(1),'test:old-results','results','member.results_received','skipped','not_connected','Synthetic retired results notice'),
 (pg_temp.id(1),'test:old-document','care','member.document_released','skipped','not_connected','Synthetic retired document notice');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
set local role authenticated;
insert into evidence values('member-chat',public.member_notices_read());
reset role;
select pg_temp.ok((select jsonb_array_length(v->'notices')=1 and v#>>'{notices,0,text}'='Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.'from evidence where k='member-chat'),'App chat shows collection and hides old results-ready history');
-- A genuinely new arrangement of the same visit has a separate one-time event key.
update public.patient_test_requests set revision=revision+1,current_arrangement=jsonb_set(jsonb_set(current_arrangement,
 '{terms,startsAt}',to_jsonb((current_arrangement#>>'{terms,startsAt}')::timestamptz+interval '30 seconds')),
 '{terms,endsAt}',to_jsonb((current_arrangement#>>'{terms,endsAt}')::timestamptz+interval '30 seconds'))where id=pg_temp.id(104);
select pg_temp.as_nurse();set local role authenticated;
insert into evidence values('new-arrangement',pg_temp.collect(4));
reset role;
select pg_temp.ok((select v->>'status'='saved'from evidence where k='new-arrangement')and
 (select count(*)=2 and count(distinct event_key)=2 from public.member_notices where member_id=pg_temp.id(4)),
 'A new arrangement can notify once without reusing the previous arrangement key');
select pg_temp.ok(public._zoe_chat_card_for_template('member.results_received')is null and public._zoe_chat_card_for_template('member.plan_ready')='plan','Retired results-ready button route does not remove approved plan cards');
select pg_temp.ok(public._member_notice_params_ok(jsonb_build_object('collection_tests',repeat('a',2520)))and not public._member_notice_params_ok('{"collection_tests":"{value}"}')and not public._member_notice_params_ok('{"collection_tests":"CBC","value":"5"}'),'Five maximum-length card titles fit; braces and unrelated data remain rejected');
select pg_temp.ok(public._sample_collected_test_title('lipid-panel','Provider-specific panel','ru')='Provider-specific panel','Provider-authored titles follow testTitle unchanged');
select 'PASS sample collection notices: locales, exceptions, linked delivery, replay, correction, care gate, failure isolation and results-ready suppression' as result;
rollback;
