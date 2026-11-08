-- Zoe chat action cards (20261029172131): dark by default; only the service role posts and records; a typed card opens
-- only for the member's newest message after Zoe's run cleared it (never urgent, careful, forwarded or
-- injection outcomes); idempotent posts; write-once outcomes; immutable snapshots; members read only their own cards.
-- Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.post(m text,rid text,kind text,src text,seq bigint)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.zoe_chat_card_post(m::uuid,rid::uuid,kind,src,seq,jsonb_build_object('v',1));reset role;return j;end$$;
create function pg_temp.rec(m text,card uuid,item text,val jsonb,close boolean)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_record(m::uuid,card,item,val,close);reset role;return j;end$$;
create function pg_temp.claim(m text,card uuid,item text,op text,payload jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_claim(m::uuid,card,item,op::uuid,payload);reset role;return j;end$$;
create function pg_temp.release(m text,card uuid,attempt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_release(m::uuid,card,attempt::uuid);reset role;return j;end$$;
create function pg_temp.mine(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m);set local role authenticated;j:=public.zoe_chat_cards_member();reset role;return j;end$$;
create function pg_temp.visible(m text)returns bigint language plpgsql as $$declare n bigint;begin
 perform pg_temp.as_user(m);set local role authenticated;select count(*)into n from public.zoe_chat_cards;reset role;return n;end$$;
-- A member message and Zoe's finished run on it.
create function pg_temp.msg(c uuid,m uuid,seq bigint,outcome text,reason text)returns void language plpgsql as $$begin
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c,seq,m,'synthetic message '||seq,'authenticated_member',gen_random_uuid());
 if outcome is not null then
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
  values(c,m,seq,0,0,'finished',outcome,reason,current_date,clock_timestamp());
 end if;end$$;

insert into auth.users(id,phone,phone_confirmed_at)values('ac000000-0000-4000-8000-000000000001','37499080001',now()),('ac000000-0000-4000-8000-000000000002','37499080002',now());
insert into public.patient_clinical_cases(user_id)values('ac000000-0000-4000-8000-000000000001'),('ac000000-0000-4000-8000-000000000002');
insert into public.conversations(id,member_id)values('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001'),('ac000000-0000-4000-8000-0000000000c2','ac000000-0000-4000-8000-000000000002');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)values(true,'zoe-chat-cards-check',600,600,600,10)
 on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=false where singleton;

-- 1. Dark by default: no cards read, no post.
select pg_temp.ok((pg_temp.mine('ac000000-0000-4000-8000-000000000001')->>'enabled')='false','off: the member read says disabled');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a1','dose','chip',null)->>'code'='disabled','off: a post is refused');
-- The app chat switch gates the cards too.
update public.conversation_policy set app_chat_enabled=false,zoe_chat_actions_enabled=true where singleton;
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a1','dose','chip',null)->>'code'='disabled','app chat off: a post is refused');
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;

-- 2. Only the service role posts and records; a member cannot write a snapshot or an outcome of their own.
do $$begin
 perform pg_temp.as_user('ac000000-0000-4000-8000-000000000001');set local role authenticated;
 begin perform public.zoe_chat_card_post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a9','dose','chip',null,'{"v":1}');raise exception 'FAIL: member post';
 exception when insufficient_privilege then null;end;
 begin perform public.zoe_chat_card_record('ac000000-0000-4000-8000-000000000001',gen_random_uuid(),'x','{}',false);raise exception 'FAIL: member record';
 exception when insufficient_privilege then null;end;
 begin perform public.zoe_chat_card_claim('ac000000-0000-4000-8000-000000000001',gen_random_uuid(),'x',gen_random_uuid(),'{}');raise exception 'FAIL: member claim';
 exception when insufficient_privilege then null;end;
 begin insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot)values('ac000000-0000-4000-8000-000000000001',gen_random_uuid(),'dose','chip','{}');raise exception 'FAIL: member insert';
 exception when insufficient_privilege then null;end;
 reset role;
end$$;
do $$begin
 perform set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
 begin perform public.zoe_chat_cards_member();raise exception 'FAIL: anon read';exception when insufficient_privilege then null;end;
 reset role;
end$$;

-- 3. A chip card: posted, replayed on the same request id, conflict on a different kind.
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
insert into kv values('c1',pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a1','dose','chip',null));
select pg_temp.ok((v->>'ok')::boolean and (v->>'replayed')='false' and v#>>'{card,kind}'='dose' and v#>>'{card,state}'='open','chip post')from kv where k='c1';
select pg_temp.ok((pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a1','dose','chip',null)->>'replayed')='true','same request id replays');
select pg_temp.ok((select count(*)from public.zoe_chat_cards where member_id='ac000000-0000-4000-8000-000000000001')=1,'replay stores one card');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a1','plan','chip',null)->>'code'='conflict','same request id, other kind: conflict');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a2','ldl_goal','chip',null)->>'code'='invalid','unknown kind is refused');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a2','dose','chip',5)->>'code'='invalid'
 or (pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a3','dose','chip',5)#>>'{card,sourceSeq}')is null,'a chip card never carries a message seq');

-- 4. Typed cards open only after Zoe cleared the member's newest message.
-- No run yet: not cleared.
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',1,null,null);
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000b1','dose','typed',1)->>'code'='not_cleared','no run: not cleared');
select pg_temp.ok(pg_temp.mine('ac000000-0000-4000-8000-000000000001')->'clearedSeq'='null'::jsonb,'no run: no offer');
-- Each outcome that is not an ordinary chat or logistics answer.
do $$declare r record;n bigint:=1;begin
 for r in select * from(values('discarded','urgent_route_no_model_call'),('discarded','urgent_in_window_no_model_call'),('summary_only','same_day_floor_bp'),
   ('summary_only','health_forward_member_yes'),('summary_only','careful_line_today'),('answered','health_answer_emergency_not_confirmed'),
   ('chatted','chat_injection_fixed_wording'),('chatted','urgent_followup'),('intake_asked','intake_started'),('intake_escalated','intake_red_flag_answer_no_model_call'),
   ('draft_proposed','draft_passed_guards'),('no_output','none'))x(o,reason)loop
  n:=n+1;
  perform pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',n,r.o,r.reason);
  perform pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001',gen_random_uuid()::text,'dose','typed',n)->>'code'='not_cleared',format('%s/%s is not cleared',r.o,r.reason));
  perform pg_temp.ok(pg_temp.mine('ac000000-0000-4000-8000-000000000001')->'clearedSeq'='null'::jsonb,format('%s/%s: no offer',r.o,r.reason));
 end loop;
end$$;
-- An ordinary chat reply clears it: offered, then opened once.
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',20,'chatted','chat_reply_passed_guards');
select pg_temp.ok((pg_temp.mine('ac000000-0000-4000-8000-000000000001')->>'clearedSeq')::bigint=20,'chat reply: offered');
select pg_temp.ok((pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000b2','plan','typed',20)#>>'{card,sourceSeq}')='20','chat reply: typed card opens');
select pg_temp.ok(pg_temp.mine('ac000000-0000-4000-8000-000000000001')->'clearedSeq'='null'::jsonb,'used offer is not offered again');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000b3','plan','typed',20)->>'code'='not_cleared','one typed card per message');
-- A logistics answer clears it; a newer member message takes the offer away from the older one.
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',21,'answered','direct_answer_passed_guards');
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',22,null,null);
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000b4','visit','typed',21)->>'code'='not_cleared','only the newest message');
-- Another member's cleared message never opens a card for this member.
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c2','ac000000-0000-4000-8000-000000000002',1,'chatted','chat_reply_passed_guards');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000b5','visit','typed',1)->>'code'='not_cleared','another member''s message');
-- An old message is not offered.
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 values('ac000000-0000-4000-8000-0000000000c2',2,'ac000000-0000-4000-8000-000000000002','synthetic old message','authenticated_member',gen_random_uuid(),now()-interval '2 hours');
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 values('ac000000-0000-4000-8000-0000000000c2','ac000000-0000-4000-8000-000000000002',2,0,0,'finished','chatted','chat_reply_passed_guards',current_date,clock_timestamp());
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-0000000000b6','visit','typed',2)->>'code'='not_cleared','older than an hour');

-- 5. Claims and outcomes (Astra ZCA-01/02): the first claim wins and is returned to every later caller; only a claimed
-- item records; outcomes are write-once; a closed card takes no new claim; switched off, no claim at all.
insert into kv select 'card',v->'card' from kv where k='c1';
create function pg_temp.cid()returns uuid language sql as $$select (v->>'id')::uuid from kv where k='card'$$;
select pg_temp.ok(pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','{"status":"taken"}',false)->>'code'='invalid','no record without a claim');
select pg_temp.ok((pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','ac000000-0000-4000-8000-0000000000e1','{"status":"taken"}')->>'won')='true','first claim wins');
select pg_temp.ok((select j#>>'{claim,op}'='ac000000-0000-4000-8000-0000000000e1' and j#>>'{claim,payload,status}'='taken' and (j->>'won')='false'
 from(select pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','ac000000-0000-4000-8000-0000000000e2','{"status":"skipped"}')j)x),'a second tab gets the first claim back');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000002',pg_temp.cid(),'dose:a:1','ac000000-0000-4000-8000-0000000000e3','{"status":"taken"}')->>'code'='not_found','another member cannot claim it');
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:2','ac000000-0000-4000-8000-0000000000e4','{"status":"taken"}')->>'code'='disabled','switched off: no claim, so no write');
update public.conversation_policy set zoe_chat_actions_enabled=true,app_chat_enabled=false where singleton;
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:2','ac000000-0000-4000-8000-0000000000e4','{"status":"taken"}')->>'code'='disabled','app chat off: no claim');
update public.conversation_policy set app_chat_enabled=true where singleton;
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','{"status":"taken"}',false)->>'ok')::boolean,'record a claimed item');
select set_config('test.done',(select outcome#>>'{dose:a:1,doneAt}' from public.zoe_chat_cards where id=pg_temp.cid()),true);
select pg_temp.ok(current_setting('test.done')::timestamptz between now() and clock_timestamp(),'an action keeps the database time it was done, the clock of the messages');
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','{"status":"taken"}',false)->>'replayed')='true','same item and value replays');
select pg_temp.ok((select outcome#>>'{dose:a:1,doneAt}' from public.zoe_chat_cards where id=pg_temp.cid())=current_setting('test.done'),'a replay keeps the first time');
select pg_temp.ok((select outcome->'dose:a:1'->>'status' from public.zoe_chat_cards where id=pg_temp.cid())='taken','the value stays as recorded');
select pg_temp.ok(pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:1','{"status":"skipped"}',false)->>'code'='recorded','a recorded item is never rewritten');
select pg_temp.ok(pg_temp.rec('ac000000-0000-4000-8000-000000000002',pg_temp.cid(),'dose:a:1','{"status":"taken"}',false)->>'code'='not_found','another member cannot record on it');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'Bad Item!','ac000000-0000-4000-8000-0000000000e5','{}')->>'code'='invalid','item keys are codes');
select pg_temp.ok((pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:2','ac000000-0000-4000-8000-0000000000e6','{"status":"skipped"}')->>'won')='true','claim a second item');
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:2','{"status":"skipped"}',true)#>>'{card,state}')='done','close the card');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:3','ac000000-0000-4000-8000-0000000000e7','{"status":"taken"}')->>'code'='closed','a done card takes no new claim');
select pg_temp.ok((pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.cid(),'dose:a:2','ac000000-0000-4000-8000-0000000000e8','{"status":"taken"}')#>>'{claim,op}')='ac000000-0000-4000-8000-0000000000e6','a retry after closing still gets its claim back');

-- Two concurrent sessions: output/zoe-chat-actions/scripts/claim-race.mjs (row lock; exactly one wins).
-- One send in flight per card: a second text waits until the first was recorded as definitely not sent.
insert into kv values('msg',pg_temp.post('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000f1','message','chip',null)->'card');
create function pg_temp.mid()returns uuid language sql as $$select (v->>'id')::uuid from kv where k='msg'$$;
insert into kv values('att_a',pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000f2','{"text":"a"}'));
select pg_temp.ok((select v->>'won' from kv where k='att_a')='true','first text claims');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}')->>'code'='busy','second text is busy while the first may be sending');
select pg_temp.ok(pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'fail:ccc','{"status":"rate_limited"}',false)->>'code'='invalid','a failure only for a claimed text');
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'fail:aaa','{"status":"rate_limited"}',false)->>'ok')::boolean,'record the first text as not sent');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}')->>'code'='busy','still busy until that attempt ends');
select pg_temp.release('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),(select v->>'attempt' from kv where k='att_a'));
insert into kv values('att_b',pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}'));
select pg_temp.ok((select v->>'won' from kv where k='att_b')='true'and(select v->>'attempt' from kv where k='att_b')is not null,'then an edited text may claim, with a send lease');
-- ZCA-POST-01: every send attempt holds a lease; a failure marker exempts a text only while no attempt of it is going.
-- Real two-session races in both orders: scripts/check-zoe-chat-retry-race.mjs.
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000f2','{"text":"a"}')->>'code'='busy','a retry of the refused text is busy while the edited one is in flight');
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'fail:bbb','{"status":"rate_limited"}',false)->>'ok')::boolean,'the edited text is refused too');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000f2','{"text":"a"}')->>'code'='busy','its failure marker does not free the card while its attempt holds the lease');
select pg_temp.ok((pg_temp.release('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),gen_random_uuid()::text)->>'ok')::boolean
 and(select send_attempts from public.zoe_chat_cards where id=pg_temp.mid())?(select v->>'attempt' from kv where k='att_b'),'releasing another attempt id leaves the lease');
select pg_temp.release('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),(select v->>'attempt' from kv where k='att_b'));
insert into kv values('att_a1',pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000f9','{"text":"a"}'));
select pg_temp.ok((select v#>>'{claim,op}' from kv where k='att_a1')='ac000000-0000-4000-8000-0000000000f2'and(select v->>'attempt' from kv where k='att_a1')is not null,'released: a retry of the first text replays its request id with a lease');
insert into kv values('att_a2',pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000fa','{"text":"a"}'));
select pg_temp.ok((select v->>'attempt' from kv where k='att_a2')<>(select v->>'attempt' from kv where k='att_a1'),'the same text from another tab joins with its own lease');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}')->>'code'='busy','an edited text is busy while the retry is in flight');
select pg_temp.release('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),(select v->>'attempt' from kv where k='att_a1'));
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}')->>'code'='busy','one attempt ending releases only its own lease');
-- A lease left by a crashed server expires after 15 minutes.
update public.zoe_chat_cards set send_attempts=jsonb_set(send_attempts,array[(select v->>'attempt' from kv where k='att_a2')],
 jsonb_build_object('item','sent:aaa','at',clock_timestamp()-interval '16 minutes'))where id=pg_temp.mid();
insert into kv values('att_b2',pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','ac000000-0000-4000-8000-0000000000f3','{"text":"b"}'));
select pg_temp.ok((select v->>'attempt' from kv where k='att_b2')is not null
 and(select count(*)from jsonb_object_keys((select send_attempts from public.zoe_chat_cards where id=pg_temp.mid())))=1,'an expired lease no longer holds the card and is dropped');
select pg_temp.ok((pg_temp.rec('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:bbb','{"requestId":"ac000000-0000-4000-8000-0000000000f3"}',true)#>>'{card,state}')='done','the edited text is sent');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:aaa','ac000000-0000-4000-8000-0000000000f2','{"text":"a"}')->>'attempt' is null,'after the send nothing gets a new lease');
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:ddd','ac000000-0000-4000-8000-0000000000fb','{"text":"d"}')->>'code'='closed','a sent card takes no new text');

-- 6. Snapshots are immutable, even for the table owner; outcomes only grow; done stays done.
do $$begin
 begin update public.zoe_chat_cards set snapshot='{"v":2}' where member_id='ac000000-0000-4000-8000-000000000001';raise exception 'FAIL: snapshot rewritten';
 exception when check_violation then null;end;
 begin update public.zoe_chat_cards set outcome='{}' where member_id='ac000000-0000-4000-8000-000000000001' and outcome<>'{}';raise exception 'FAIL: outcome removed';
 exception when check_violation then null;end;
 begin update public.zoe_chat_cards set state='open' where state='done';raise exception 'FAIL: reopened';
 exception when check_violation then null;end;
 begin update public.zoe_chat_cards set kind='plan' where kind='dose';raise exception 'FAIL: kind changed';
 exception when check_violation then null;end;
 begin update public.zoe_chat_cards set claims='{}' where claims<>'{}';raise exception 'FAIL: claim removed';
 exception when check_violation then null;end;
end$$;

-- 7. Each member reads only their own cards, through the RPC and through RLS.
select pg_temp.ok(jsonb_array_length(pg_temp.mine('ac000000-0000-4000-8000-000000000001')->'cards')=(select count(*)from public.zoe_chat_cards where member_id='ac000000-0000-4000-8000-000000000001'),'own cards in the read');
select pg_temp.ok(pg_temp.visible('ac000000-0000-4000-8000-000000000001')=(select count(*)from public.zoe_chat_cards where member_id='ac000000-0000-4000-8000-000000000001'),'RLS: own rows');
select pg_temp.ok(pg_temp.visible('ac000000-0000-4000-8000-000000000002')=0,'RLS: none of another member''s rows');
select pg_temp.ok(jsonb_array_length(pg_temp.mine('ac000000-0000-4000-8000-000000000002')->'cards')=0,'another member''s read is empty');

-- 8. At most 40 direct chip cards an hour. Typed cards use the message allowance instead.
do $$declare i int;begin
 for i in 1..60 loop exit when (select count(*)from public.zoe_chat_cards where member_id='ac000000-0000-4000-8000-000000000002')>=40;
  perform pg_temp.post('ac000000-0000-4000-8000-000000000002',gen_random_uuid()::text,'results','chip',null);end loop;
end$$;
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000002',gen_random_uuid()::text,'results','chip',null)->>'code'='rate_limited','rate limit');
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c2','ac000000-0000-4000-8000-000000000002',100,'chatted','task_request_no_model');
insert into kv values('typed_after_cap',pg_temp.post('ac000000-0000-4000-8000-000000000002',gen_random_uuid()::text,'plan','typed',100));
select pg_temp.ok((select v->>'ok'from kv where k='typed_after_cap')='true','a cleared suggestion still opens its card after 40 direct chips');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000002',gen_random_uuid()::text,'results','typed',100)->>'code'='not_cleared','the cap exception keeps one typed card per message');
select pg_temp.msg('ac000000-0000-4000-8000-0000000000c2','ac000000-0000-4000-8000-000000000002',101,'discarded','urgent_route_no_model_call');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000002',gen_random_uuid()::text,'plan','typed',101)->>'code'='not_cleared','the cap exception never clears an urgent message');
do $$declare i int;begin
 for i in 100..140 loop
  perform pg_temp.msg('ac000000-0000-4000-8000-0000000000c1','ac000000-0000-4000-8000-000000000001',i,'chatted','task_request_no_model');
  perform pg_temp.ok((pg_temp.post('ac000000-0000-4000-8000-000000000001',gen_random_uuid()::text,'plan','typed',i)->>'ok')::boolean,'typed suggestions have no second 40-card allowance');
 end loop;
 perform pg_temp.ok((pg_temp.post('ac000000-0000-4000-8000-000000000001',gen_random_uuid()::text,'results','chip',null)->>'ok')::boolean,'typed suggestions do not consume the direct chip allowance');
end$$;
do $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.zoe_chat_card_post('ac000000-0000-4000-8000-000000000001',gen_random_uuid(),'results','chip',null,jsonb_build_object('v',1,'pad',repeat('x',40000)));reset role;
 perform pg_temp.ok(j->>'code'='invalid','oversized snapshot is refused');
end$$;

-- 9. Switched off again: the member read and every post stop; stored cards stay.
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select pg_temp.ok((pg_temp.mine('ac000000-0000-4000-8000-000000000001')->>'enabled')='false','off again: read disabled');
select pg_temp.ok(pg_temp.post('ac000000-0000-4000-8000-000000000001',gen_random_uuid()::text,'dose','chip',null)->>'code'='disabled','off again: post refused');
-- Claims refuse while off; recording a claimed item and ending a send attempt are bookkeeping and still run (Astra note on #402).
select pg_temp.ok(pg_temp.claim('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),'sent:eee','ac000000-0000-4000-8000-0000000000fc','{"text":"e"}')->>'code'='disabled','off again: claim refused');
select pg_temp.ok((pg_temp.release('ac000000-0000-4000-8000-000000000001',pg_temp.mid(),gen_random_uuid()::text)->>'ok')::boolean,'off again: release still runs');

select 'check-zoe-chat-actions.sql: all checks passed';
rollback;
