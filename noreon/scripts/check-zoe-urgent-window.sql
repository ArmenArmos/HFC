-- Zoe 103 window (20261019184651): zoe_run_urgent_window returns, per started run, minutes since the current run of
-- urgent answers began, over the whole history (eleven urgent answers, more than the claim's ten); null when the newest
-- answer is not urgent or there is none; nothing for finished runs; never text; service role only. Rolled back. Synthetic only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.win(runs uuid[])returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_urgent_window(runs);reset role;return j;end$$;

insert into auth.users(id,phone,phone_confirmed_at)values('e1830000-0000-4000-8000-000000000001','37499083801',now()),('e1830000-0000-4000-8000-000000000002','37499083802',now());
insert into public.patient_clinical_cases(user_id)values('e1830000-0000-4000-8000-000000000001'),('e1830000-0000-4000-8000-000000000002');
insert into public.conversations(id,member_id)values('e1830000-0000-4000-8000-0000000000c1','e1830000-0000-4000-8000-000000000001'),('e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002');
-- Conversation 1: 14 answers, one every 12 minutes from 168 minutes ago (urgent from 120 minutes ago on), and one at 200 minutes (outside).
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select ('e1830000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e1830000-0000-4000-8000-0000000000c1','e1830000-0000-4000-8000-000000000001',n,0,0,current_date,'finished','discarded','synthetic',now()
 from generate_series(1,15)n;
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 select 'e1830000-0000-4000-8000-0000000000c1','e1830000-0000-4000-8000-000000000001',('e1830000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n,
  case when n>=5 then 'Synthetic urgent text, call 103 now.'else 'Synthetic answer.'end,'en','noreon.rules','zoe-urgent-fixed',case when n>=5 then 'urgent'else 'answer'end,
  clock_timestamp()-make_interval(mins=>case when n=1 then 200 else 168-(n-2)*12 end)
 from generate_series(1,15)n;
-- The claimed run (started) for conversation 1, a finished run, and a started run in conversation 2 with no answers.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)values
 ('e1830000-0000-4000-8000-0000000000a1','e1830000-0000-4000-8000-0000000000c1','e1830000-0000-4000-8000-000000000001',16,0,0,current_date,'started'),
 ('e1830000-0000-4000-8000-0000000000a2','e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002',1,0,0,current_date,'started');

-- Conversation 2: an urgent answer, then an ordinary one (newest): no open run.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)values
 ('e1830000-0000-4000-8000-0000000000b1','e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002',11,0,0,current_date,'finished','discarded','synthetic',now()),
 ('e1830000-0000-4000-8000-0000000000b2','e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002',12,0,0,current_date,'finished','answered','synthetic',now());
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)values
 ('e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002','e1830000-0000-4000-8000-0000000000b1',11,'Synthetic urgent text.','en','noreon.rules','zoe-urgent-fixed','urgent',clock_timestamp()-interval '30 minutes'),
 ('e1830000-0000-4000-8000-0000000000c2','e1830000-0000-4000-8000-000000000002','e1830000-0000-4000-8000-0000000000b2',12,'Synthetic answer.','en','noreon.rules','zoe-urgent-fixed','answer',clock_timestamp()-interval '10 minutes');
create function pg_temp.since(run uuid)returns jsonb language sql as $$select x->'urgentSinceMinutes' from jsonb_array_elements(pg_temp.win(array[run]))x$$;
select pg_temp.ok(jsonb_array_length(pg_temp.win(array['e1830000-0000-4000-8000-0000000000a1'::uuid,'e1830000-0000-4000-8000-0000000000a2'::uuid]))=2,'One row per started run');
select pg_temp.ok((pg_temp.since('e1830000-0000-4000-8000-0000000000a1')#>>'{}')::int between 131 and 132,'The run of eleven urgent answers began 132 minutes ago (whole history, not the last ten)');
select pg_temp.ok(pg_temp.since('e1830000-0000-4000-8000-0000000000a2')='null'::jsonb,'Newest answer ordinary: null');
-- Astra N1-2 (20261022071955): the newest member message a 103 text of the run answered, for exact exit ordering.
select pg_temp.ok((select x->'urgentThroughSeq' from jsonb_array_elements(pg_temp.win(array['e1830000-0000-4000-8000-0000000000a1'::uuid]))x)='15'::jsonb,'The run''s newest 103 text answered message 15');
select pg_temp.ok((select x->'urgentThroughSeq' from jsonb_array_elements(pg_temp.win(array['e1830000-0000-4000-8000-0000000000a2'::uuid]))x)='null'::jsonb,'No open run: no seq');
delete from public.zoe_member_answers where conversation_id='e1830000-0000-4000-8000-0000000000c2';
select pg_temp.ok(pg_temp.since('e1830000-0000-4000-8000-0000000000a2')='null'::jsonb,'No answers: null');
select pg_temp.ok(pg_temp.win(array['e1830000-0000-4000-8000-000000000005'::uuid])='[]'::jsonb,'A finished run gets nothing');
select pg_temp.ok(pg_temp.win(null)='[]'::jsonb,'No runs: empty');
select pg_temp.ok((select bool_and(x - 'runId' - 'urgentSinceMinutes' - 'urgentOpenedBy' - 'urgentThroughSeq' - 'memberClear' - 'selfHarmTodayMinutes'='{}'::jsonb and jsonb_typeof(x->'selfHarmTodayMinutes')in('number','null') and x->>'urgentOpenedBy'='rule')from jsonb_array_elements(pg_temp.win(array['e1830000-0000-4000-8000-0000000000a1'::uuid]))x),'A number and the opener code only, never the text (20261020182719)');
-- Service role only.
do $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','e1830000-0000-4000-8000-000000000001','role','authenticated')::text,true);
 begin set local role authenticated;perform public.zoe_run_urgent_window(array['e1830000-0000-4000-8000-0000000000a1'::uuid]);raise exception 'FAIL: a member read the window';
 exception when insufficient_privilege then null;end;reset role;
end$$;
select 'Zoe urgent window SQL checks passed.';
rollback;
