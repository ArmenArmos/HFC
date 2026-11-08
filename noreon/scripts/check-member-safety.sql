-- Member safety holds (DT P342 chest-pain card, P371/P389 exercise pause): the dark switch, which
-- answers open which hold, the 30-day expiry and "hide for today", the member's own view, who
-- may clear or keep (assigned doctor or admin with a reason; never another doctor, a nurse or
-- the member), the append-only audit, and the backfill for answers saved while off.
-- Synthetic fixtures, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.code(statement text)returns text language plpgsql as $$begin execute statement;return 'none';exception when others then return sqlstate;end$$;

-- 01 member, 02 assigned doctor, 03 other doctor, 04 nurse, 05 admin, 06 member (chest pain right now),
-- 07 member (vasovagal), 08 member (answered while off), 09 member (no hold), 10 clinic.
create function pg_temp.u(n int)returns uuid language sql immutable as $$select ('5a000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated','session_id',pg_temp.u(n),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)$$;
create function pg_temp.answers(pairs jsonb)returns jsonb language sql immutable as $$
 select coalesce(jsonb_object_agg(k,jsonb_build_object('value',v)),'{}')from jsonb_each(pairs)e(k,v)$$;
create function pg_temp.status(n int)returns jsonb language plpgsql as $$declare r jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;r:=public.member_safety_status();reset role;return r;end$$;
create function pg_temp.hold(n int,k text)returns public.member_safety_holds language sql security definer as $$
 select * from public.member_safety_holds where member_id=pg_temp.u(n)and kind=k order by started_at desc limit 1$$;

grant execute on function pg_temp.code(text),pg_temp.ok(boolean,text),pg_temp.u(int),pg_temp.hold(int,text)to authenticated,anon;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),'3740095'||lpad(n::text,4,'0'),now()from generate_series(1,9)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.u(n),pg_temp.u(n),now(),now()from generate_series(1,9)n;
update public.profiles set display_name='Synthetic safety member '||right(id::text,2)where id in(select pg_temp.u(n)from generate_series(1,9)n);
insert into public.workspace_clinics(id,name)values(pg_temp.u(10),'Synthetic safety clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(2),'doctor','Synthetic assigned doctor',pg_temp.u(10)),(pg_temp.u(3),'doctor','Synthetic other doctor',pg_temp.u(10)),
 (pg_temp.u(4),'nurse','Synthetic nurse',pg_temp.u(10)),(pg_temp.u(5),'admin','Synthetic admin',null);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(2),pg_temp.u(4));
delete from public.member_safety_settings;

-- 1. Off (no row): a qualifying save records nothing; every function says off.
insert into public.patient_assessments(user_id,answers,completed_at)values
 (pg_temp.u(8),pg_temp.answers('{"q9.present":"yes","q9.right_now":"no","q10.syncope":"exertion"}'),now()-interval '3 days');
insert into public.patient_assessments(user_id,answers)values(pg_temp.u(1),pg_temp.answers('{"q9.present":"yes","q9.right_now":"no","q10.syncope":"exertion"}'));
select pg_temp.ok(not exists(select 1 from public.member_safety_holds),'Off: no hold recorded');
select pg_temp.ok(pg_temp.status(1)='{"enabled":false,"chestPainCard":null,"exercisePaused":false}'::jsonb,'Off: member status disabled');
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok((public.staff_member_safety(pg_temp.u(1))->>'enabled')='false','Off: staff read disabled');
reset role;
delete from public.patient_assessments where user_id=pg_temp.u(1);
insert into public.member_safety_settings(enabled)values(false);
insert into public.patient_assessments(user_id,answers)values(pg_temp.u(1),pg_temp.answers('{"q9.present":"yes","q9.right_now":"no"}'));
select pg_temp.ok(not exists(select 1 from public.member_safety_holds),'Off (enabled=false): no hold recorded');
delete from public.patient_assessments where user_id=pg_temp.u(1);

-- 2. On: which answers open which hold.
update public.member_safety_settings set enabled=true;
insert into public.patient_assessments(user_id,answers)values(pg_temp.u(1),pg_temp.answers('{"q9.present":"yes"}'));
select pg_temp.ok(not exists(select 1 from public.member_safety_holds where member_id=pg_temp.u(1)),'Chest pain without the right-now answer: no card yet');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q9.right_now":"no"}'),revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.ok((pg_temp.hold(1,'chest_pain_card')).source_value='yes','Chest pain, not now: card opened');
select pg_temp.ok((pg_temp.hold(1,'chest_pain_card')).expires_at=((timezone('Asia/Yerevan',(pg_temp.hold(1,'chest_pain_card')).started_at))::date+31)::timestamp at time zone 'Asia/Yerevan','Card ends at Yerevan midnight after the 30th day');
select pg_temp.ok((pg_temp.hold(1,'chest_pain_card')).expires_at-(pg_temp.hold(1,'chest_pain_card')).started_at between interval '30 days' and interval '31 days','Card runs 30 to 31 days');
select pg_temp.ok(public._member_safety_card_end('2026-10-17 21:30+00')='2026-11-17 20:00+00','Answer at 01:30 Yerevan on 18 Oct: card shown through 17 Nov');
select pg_temp.ok(public._member_safety_card_end('2026-10-17 19:30+00')='2026-11-16 20:00+00','Answer at 23:30 Yerevan on 17 Oct: card shown through 16 Nov');
select pg_temp.ok((select count(*)from public.member_safety_audit where member_id=pg_temp.u(1)and action='opened'and actor_role='system')=1,'Opening audited');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q9.frequency":"weekly"}'),revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.ok((select count(*)from public.member_safety_holds where member_id=pg_temp.u(1))=1,'Later saves do not duplicate the card');
insert into public.patient_assessments(user_id,answers)values(pg_temp.u(6),pg_temp.answers('{"q9.present":"yes","q9.right_now":"yes"}'));
select pg_temp.ok(not exists(select 1 from public.member_safety_holds where member_id=pg_temp.u(6)),'Chest pain right now (103 screen): no card');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q9.present":"unsure","q9.right_now":"no"}') where user_id=pg_temp.u(6);
select pg_temp.ok((pg_temp.hold(6,'chest_pain_card')).source_value='unsure','"Not sure" counts as a positive answer');
insert into public.patient_assessments(user_id,answers)values(pg_temp.u(7),pg_temp.answers('{"q10.syncope":"vasovagal","q9.present":"no"}'));
select pg_temp.ok(not exists(select 1 from public.member_safety_holds where member_id=pg_temp.u(7)),'Vasovagal fainting and no chest pain: no hold');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q10.syncope":"rest"}') where user_id=pg_temp.u(7);
select pg_temp.ok((pg_temp.hold(7,'exercise_pause')).source_value='rest','Fainting at rest (RF-09): exercise paused');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q10.syncope":"exertion"}'),revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.ok((pg_temp.hold(1,'exercise_pause')).source_value='exertion'and(pg_temp.hold(1,'exercise_pause')).expires_at is null,'Fainting on exertion (RF-08): exercise paused, no end date');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q10.syncope":"never","q9.present":"no"}'),revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.ok((pg_temp.hold(1,'exercise_pause')).cleared_at is null and(pg_temp.hold(1,'chest_pain_card')).cleared_at is null,'A changed answer never closes a hold');
update public.patient_assessments set answers=answers||pg_temp.answers('{"q10.syncope":"exertion","q9.present":"yes"}'),revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.ok((select count(*)from public.member_safety_holds where member_id=pg_temp.u(1))=2,'Answering again while active opens nothing new');

-- 3. Member view and "hide for today".
select pg_temp.ok((pg_temp.status(1)->'chestPainCard'->>'id')::uuid=(pg_temp.hold(1,'chest_pain_card')).id and(pg_temp.status(1)->>'exercisePaused')::boolean,'Member sees the card and the pause');
select pg_temp.ok(pg_temp.status(9)='{"enabled":true,"chestPainCard":null,"exercisePaused":false}'::jsonb,'Member without holds: nothing');
select pg_temp.as_user(9);set local role authenticated;
select pg_temp.ok((public.member_safety_hide_today((pg_temp.hold(1,'chest_pain_card')).id)->>'code')='not_open','Another member cannot hide the card');
select pg_temp.ok(pg_temp.code($$select * from public.member_safety_holds$$)='42501','No direct table read');
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety(pg_temp.u(1))$$)='42501','Member cannot read staff view');
reset role;
select pg_temp.as_user(1);set local role authenticated;
select pg_temp.ok((public.member_safety_hide_today((pg_temp.hold(1,'exercise_pause')).id)->>'code')='not_open','Exercise pause cannot be hidden');
select pg_temp.ok((public.member_safety_hide_today((pg_temp.hold(1,'chest_pain_card')).id)->>'result')='hidden','Member hides the card for today');
select pg_temp.ok((public.member_safety_hide_today((pg_temp.hold(1,'chest_pain_card')).id)->>'result')='already_hidden','Second hide is a no-op');
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety_decide((select id from public.member_safety_holds limit 1),'clear','x')$$)='42501','Member cannot clear');
reset role;
select pg_temp.ok((pg_temp.status(1)->'chestPainCard'->>'hiddenToday')::boolean,'Hidden today');
select pg_temp.ok((select count(*)from public.member_safety_audit where member_id=pg_temp.u(1)and action='hidden_today'and actor_role='member')=1,'Hide audited once');
update public.member_safety_holds set hidden_on=hidden_on-1 where id=(pg_temp.hold(1,'chest_pain_card')).id;
select pg_temp.ok(not(pg_temp.status(1)->'chestPainCard'->>'hiddenToday')::boolean,'The card returns the next day');
set local role anon;
select pg_temp.ok(pg_temp.code($$select public.member_safety_status()$$)='42501','Anon refused');
reset role;

-- 4. Who may decide.
do $$begin
 perform pg_temp.as_user(3);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.staff_member_safety(pg_temp.u(1))$q$)='42501','Other doctor cannot read');
 perform pg_temp.ok(pg_temp.code($q$select public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'clear')$q$)='42501','Other doctor cannot clear');
 reset role;perform pg_temp.as_user(4);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.staff_member_safety(pg_temp.u(1))$q$)='42501','Nurse cannot read');
 perform pg_temp.ok(pg_temp.code($q$select public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'clear')$q$)='42501','Nurse cannot clear');
 reset role;
end$$;
select pg_temp.ok((pg_temp.hold(1,'exercise_pause')).cleared_at is null,'Refused attempts changed nothing');
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok((select jsonb_array_length(public.staff_member_safety(pg_temp.u(1))->'holds'))=2 and public.staff_member_safety(pg_temp.u(1))->>'role'='doctor','Assigned doctor reads both holds');
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'pause')$$)='23514','Unknown action refused');
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'keep','Seen, cardiology booked')->>'result')='kept','Doctor keeps the pause');
reset role;
select pg_temp.ok((pg_temp.hold(1,'exercise_pause')).reviewed_by=pg_temp.u(2)and(pg_temp.hold(1,'exercise_pause')).cleared_at is null,'Keep records the review, hold stays');
select pg_temp.ok((pg_temp.status(1)->>'exercisePaused')::boolean,'Still paused after keep');
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'clear')->>'result')='cleared','Assigned doctor clears the pause');
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(1,'exercise_pause')).id,'clear')->>'code')='not_open','Clearing twice is refused');
reset role;
select pg_temp.ok((pg_temp.hold(1,'exercise_pause')).cleared_by_role='doctor'and not(pg_temp.status(1)->>'exercisePaused')::boolean,'Cleared: member exercise no longer paused');
select pg_temp.ok((select array_agg(action order by id)from public.member_safety_audit where hold_id=(pg_temp.hold(1,'exercise_pause')).id)=array['opened','kept','cleared'],'Audit: opened, kept, cleared');
select pg_temp.ok((select actor_id from public.member_safety_audit where hold_id=(pg_temp.hold(1,'exercise_pause')).id and action='cleared')=pg_temp.u(2),'Audit names the doctor');
select pg_temp.as_user(5);set local role authenticated;
select pg_temp.ok(public.staff_member_safety(pg_temp.u(1))->>'role'='admin','Admin reads');
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety_decide((pg_temp.hold(1,'chest_pain_card')).id,'clear')$$)='23514','Admin clear without a reason refused');
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety_decide((pg_temp.hold(1,'chest_pain_card')).id,'clear','   ')$$)='23514','Blank reason refused');
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(1,'chest_pain_card')).id,'clear','Doctor on leave, confirmed by phone')->>'result')='cleared','Admin clears with a reason');
reset role;
select pg_temp.ok((pg_temp.hold(1,'chest_pain_card')).cleared_by_role='admin'and pg_temp.status(1)->'chestPainCard'='null'::jsonb,'Card gone after admin clear');
select pg_temp.ok((select note from public.member_safety_audit where hold_id=(pg_temp.hold(1,'chest_pain_card')).id and action='cleared')='Doctor on leave, confirmed by phone','Admin reason audited');
-- An ended session cannot decide.
delete from auth.sessions where id=pg_temp.u(2);
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.staff_member_safety(pg_temp.u(1))$$)='42501','Ended session refused');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.u(2),pg_temp.u(2),now(),now());

-- 5. Expiry: the card ends after 30 days by itself; a later qualifying save opens a new one.
update public.member_safety_holds set started_at=now()-interval '31 days',expires_at=now()-interval '1 day' where member_id=pg_temp.u(6);
select pg_temp.ok(pg_temp.status(6)->'chestPainCard'='null'::jsonb,'Expired card is not shown');
select pg_temp.as_user(5);set local role authenticated;
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(6,'chest_pain_card')).id,'keep')->>'code')='not_open','Expired card cannot be kept');
select pg_temp.ok(not(public.staff_member_safety(pg_temp.u(6))->'holds'->0->>'active')::boolean,'Staff view shows it ended');
reset role;
update public.patient_assessments set answers=answers||pg_temp.answers('{"q9.right_now":"yes"}') where user_id=pg_temp.u(6);
update public.patient_assessments set answers=answers||pg_temp.answers('{"q9.right_now":"no"}') where user_id=pg_temp.u(6);
select pg_temp.ok((select count(*)from public.member_safety_holds where member_id=pg_temp.u(6))=2 and pg_temp.status(6)->'chestPainCard'<>'null'::jsonb,'New qualifying answer after expiry opens a new card');

-- 6. Audit is append-only.
select pg_temp.ok(pg_temp.code($$update public.member_safety_audit set note='x'$$)='55000','Audit cannot be edited');
select pg_temp.ok(pg_temp.code($$delete from public.member_safety_audit$$)='55000','Audit cannot be deleted');
savepoint f6;
delete from public.member_safety_holds where id=(pg_temp.hold(7,'exercise_pause')).id;
select pg_temp.ok((select count(*)from public.member_safety_audit where member_id=pg_temp.u(7))>=1,'Audit outlives a hold deleted by hand');
rollback to savepoint f6;

-- 7. Switched off again: holds stay recorded but nothing shows and nobody can decide.
update public.member_safety_settings set enabled=false;
select pg_temp.ok(pg_temp.status(7)='{"enabled":false,"chestPainCard":null,"exercisePaused":false}'::jsonb,'Off: member sees nothing');
select pg_temp.as_user(2);set local role authenticated;
select pg_temp.ok((public.staff_member_safety_decide((pg_temp.hold(1,'chest_pain_card')).id,'keep')->>'code')='unavailable','Off: decisions refused');
reset role;
select pg_temp.ok(pg_temp.code($$select public.member_safety_backfill()$$)='55000','Backfill refused while off');

-- 8. Backfill: answers saved while off get their holds, dated from the answer; nothing twice.
update public.member_safety_settings set enabled=true;
select pg_temp.ok(public.member_safety_backfill()=2,'Backfill opens the member-08 card and pause');
select pg_temp.ok((pg_temp.hold(8,'chest_pain_card')).expires_at<now()+interval '28 days','Backfilled card counts from the saved answer');
select pg_temp.ok((select count(*)from public.member_safety_audit where member_id=pg_temp.u(8)and action='backfilled')=2,'Backfill audited');
select pg_temp.ok(public.member_safety_backfill()=0,'Backfill is idempotent and does not reopen cleared holds');
set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.member_safety_backfill()$$)='42501','Backfill not callable by users');
reset role;

-- Account deletion still removes the member's holds and audit rows.
delete from auth.users where id=pg_temp.u(8);
select pg_temp.ok(not exists(select 1 from public.member_safety_holds where member_id=pg_temp.u(8))and not exists(select 1 from public.member_safety_audit where member_id=pg_temp.u(8)),'Account deletion cascades holds and audit');

rollback;
\echo 'member safety checks passed'
