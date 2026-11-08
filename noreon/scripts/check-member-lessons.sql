-- Short lessons: a member marks only their own lessons done; Zoe's offer is one per member per
-- Yerevan day (a second claim returns the first); "Not now" sticks; staff, anonymous callers and
-- direct table access reach nothing. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('1e550000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated')::text,true)$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text),pg_temp.as_user(text)to authenticated;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated;

-- 0. Privileges.
select pg_temp.ok(not has_table_privilege('authenticated','public.member_lesson_done','select')and not has_table_privilege('authenticated','public.member_lesson_offers','insert')
 and not has_table_privilege('anon','public.member_lesson_offers','select'),'No direct table access');
select pg_temp.ok(not has_function_privilege('anon','public.member_lesson_offer(text)','execute')and not has_function_privilege('anon','public.member_lessons_read()','execute')
 and has_function_privilege('authenticated','public.member_lesson_done_set(text,boolean)','execute'),'Members only; anonymous callers reach nothing');

-- Fixtures: 01 and 02 members, 07 a doctor.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749913'||n||'00',now()from unnest(array['01','02','07'])n;
insert into public.profiles(id,locale,display_name)select pg_temp.id(n),'en','Fictional member '||n from unnest(array['01','02'])n
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('07'),'doctor','Fictional doctor',pg_temp.id('90'));
set local session_replication_role=origin;

set local role authenticated;
-- 1. Done, undone, invalid ids.
select pg_temp.as_user('01');
select pg_temp.ok((select public.member_lesson_done_set('bp-numbers',true)->>'status')='saved','Mark done');
select pg_temp.ok((select public.member_lesson_done_set('bp-numbers',true)->>'status')='saved','Marking twice is harmless');
select pg_temp.ok((select public.member_lesson_done_set('salt-less',true)->>'status')='saved','Another');
select pg_temp.ok((select public.member_lesson_done_set('salt-less',false)->>'status')='saved','Mark not done');
select pg_temp.ok((select public.member_lesson_done_set('Bad Id',true)->>'status')='invalid'and(select public.member_lesson_done_set(null,true)->>'status')='invalid'
 and(select public.member_lesson_done_set('bp-numbers',null)->>'status')='invalid','Malformed input is refused');
-- At most 200 done rows per member; re-marking an existing one still works at the cap.
reset role;
insert into public.member_lesson_done(user_id,lesson_id)select pg_temp.id('01'),'filler-'||g from generate_series(1,199)g;
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok((select public.member_lesson_done_set('one-more',true)->>'status')='limit','A direct caller cannot fill the table');
select pg_temp.ok((select public.member_lesson_done_set('bp-numbers',true)->>'status')='saved','Re-marking at the cap is fine');
reset role;
delete from public.member_lesson_done where lesson_id like 'filler-%';
set local role authenticated;
select pg_temp.as_user('01');
insert into r select 'read1',public.member_lessons_read();
select pg_temp.ok((select jsonb_array_length(v->'done')=1 and v->'done'->0->>'lessonId'='bp-numbers'from r where k='read1'),'Read shows only bp-numbers done');
select pg_temp.ok((select v->>'today'=(clock_timestamp()at time zone 'Asia/Yerevan')::date::text from r where k='read1'),'Today is the Yerevan date');

-- 2. One offer a day; the second claim returns the first.
insert into r select 'o1',public.member_lesson_offer('low-sugar-signs');
insert into r select 'o2',public.member_lesson_offer('salt-less');
select pg_temp.ok((select v->>'status'='offered'and v->>'lessonId'='low-sugar-signs'from r where k='o1'),'First offer claims the day');
select pg_temp.ok((select v->>'status'='already'and v->>'lessonId'='low-sugar-signs'and v->>'dismissed'='false'from r where k='o2'),'Second claim returns the day''s first offer');
select pg_temp.ok((select public.member_lesson_offer('BAD')->>'status')='invalid','Malformed offer is refused');
select pg_temp.ok((select public.member_lesson_offer_dismiss()->>'status')='dismissed','Not now');
select pg_temp.ok((select public.member_lesson_offer('cholesterol-basics')->>'dismissed')='true'and(select public.member_lesson_offer('cholesterol-basics')->>'lessonId')='low-sugar-signs',
 'After Not now, no other offer the same day');

-- 3. Another member sees none of it.
select pg_temp.as_user('02');
insert into r select 'read2',public.member_lessons_read();
select pg_temp.ok((select jsonb_array_length(v->'done')=0 and jsonb_array_length(v->'offers')=0 from r where k='read2'),'Member 02 sees nothing of 01');
select pg_temp.ok((select public.member_lesson_offer_dismiss()->>'status')='none','Dismiss with no offer today');
select pg_temp.ok((select public.member_lesson_offer('salt-less')->>'status')='offered','Member 02 has their own day');

-- 4. Staff accounts and anonymous sessions are refused.
select pg_temp.as_user('07');
do $$begin perform public.member_lessons_read();raise exception 'FAIL: staff read';exception when insufficient_privilege then null;end$$;
do $$begin perform public.member_lesson_done_set('bp-numbers',true);raise exception 'FAIL: staff write';exception when insufficient_privilege then null;end$$;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$begin perform public.member_lesson_offer('bp-numbers');raise exception 'FAIL: no subject';exception when insufficient_privilege then null;end$$;

-- 5. Yesterday's offer does not block today: the day is the key.
reset role;
update public.member_lesson_offers set offered_on=offered_on-1 where user_id=pg_temp.id('02');
set local role authenticated;
select pg_temp.as_user('02');
select pg_temp.ok((select public.member_lesson_offer('bp-numbers')->>'status')='offered','A new day, a new offer');
insert into r select 'read3',public.member_lessons_read();
select pg_temp.ok((select jsonb_array_length(v->'offers')=2 and v->'offers'->0->>'lessonId'='bp-numbers'from r where k='read3'),'Both days on record, newest first');
reset role;
select 'member lessons ok';
rollback;
