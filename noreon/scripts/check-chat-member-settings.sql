-- Local, rolled-back constraint check. Run after replaying migrations.
\set ON_ERROR_STOP on
begin;
do $$
declare definition text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='public.zoe_chat_cards'::regclass and conname='zoe_chat_cards_kind_check';
 if definition is null or position('medicines' in definition)=0 or position('account' in definition)=0 then
  raise exception 'Member settings card kinds missing';
 end if;
 -- RLS and the existing role boundary must survive the additive constraint update.
 if not (select relrowsecurity from pg_class where oid='public.zoe_chat_cards'::regclass) then
  raise exception 'Member card RLS missing';
 end if;
 if has_function_privilege('authenticated','public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb)','execute') then
  raise exception 'A member must not write arbitrary card snapshots';
 end if;
 if has_function_privilege('anon','public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb)','execute') then
  raise exception 'Anonymous card writes must stay denied';
 end if;
end $$;
-- Reproduce a classic dose-only save after the chat snapshot, then a times-only save.
-- The expected-dose check must reject it under the same per-member lock.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at) values('ce000000-0000-4000-8000-000000000001','37499009901',now());
insert into public.profiles(id,locale,display_name) values('ce000000-0000-4000-8000-000000000001','en','Synthetic card member');
insert into public.member_medicines(id,user_id,name,dose,times,started_on)
values('ce000000-0000-4000-8000-000000000002','ce000000-0000-4000-8000-000000000001','Synthetic medicine','1 tablet',array['08:00'::time],current_date);
reset session_replication_role;
update public.member_medicine_settings set enabled=true where singleton;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
 if public.member_medicine_update('ce000000-0000-4000-8000-000000000002','2 tablets',array['08:00'::time])->>'status' is distinct from 'saved' then raise exception 'Classic update failed';end if;
 if public.member_medicine_update_times('ce000000-0000-4000-8000-000000000002',array['09:00'::time],'1 tablet')->>'status' is distinct from 'conflict' then raise exception 'A stale dose was overwritten';end if;
 if public.member_medicine_update_times('ce000000-0000-4000-8000-000000000002',array['09:00'::time],'2 tablets')->>'status' is distinct from 'saved' then raise exception 'Current times update failed';end if;
 if public.member_medicine_update_times('ce000000-0000-4000-8000-000000000002',array['10:00'::time],'2 tablets')->>'status' is distinct from 'not-found' then raise exception 'A repeated old schedule was accepted';end if;
end $$;
reset role;
do $$
begin
 if not exists(select 1 from public.member_medicines where user_id='ce000000-0000-4000-8000-000000000001' and dose='2 tablets' and times=array['09:00'::time] and stopped_at is null) then raise exception 'Current dose was not preserved';end if;
 if has_function_privilege('anon','public.member_medicine_update_times(uuid,time[],text)','execute') then raise exception 'Anonymous times edits allowed';end if;
end $$;
rollback;
