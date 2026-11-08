-- N1/N2 risk path. Fictional identities only; Verify discovers check-*.sql.
-- All fixtures and effects are rolled back. No providers, models or outbound sends.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.uid(n integer)returns uuid language sql as $$select ('ad110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.claims(n integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method',case when n=1 then 'otp'else 'password'end)),'session_id',pg_temp.uid(n+10))::text,true);
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 (pg_temp.uid(1),'37499001101',now()),(pg_temp.uid(2),null,null),(pg_temp.uid(3),null,null),(pg_temp.uid(4),null,null),(pg_temp.uid(5),'37499001105',now());
insert into public.workspace_clinics(id,name)values(pg_temp.uid(9),'Nurse chat fictional clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.uid(2),'doctor','Fictional responsible doctor',pg_temp.uid(9)),
 (pg_temp.uid(3),'nurse','Fictional assigned nurse',pg_temp.uid(9)),
 (pg_temp.uid(4),'nurse','Fictional other nurse',pg_temp.uid(9));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.uid(n+10),pg_temp.uid(n),now(),now()from generate_series(1,5)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'nurse-chat-fictional',3600,600,60,100,true,false,true);
create temp table nc(label text primary key,value jsonb);
grant all on nc to authenticated;
-- Off by default even when bypassing the app and calling the RPC directly.
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'code'='off','Database defaults nurse read off');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),0,'Off request')->>'code'='off','Database defaults nurse send off');
reset role;
update public.nurse_chat_settings set enabled=true where singleton;
select pg_temp.claims(1);set local role authenticated;
select pg_temp.ok(public.conversation_receive(jsonb_build_object('requestId',pg_temp.uid(20),'text','Fictional scheduling question'))->>'ok'='true','Member uses unchanged intake');
reset role;
select pg_temp.claims(3);set local role authenticated;
insert into nc values('read',public.conversation_nurse_workspace(pg_temp.uid(1)));
select pg_temp.ok(value->>'ok'='true'and value#>>'{items,0,senderRole}'='member','Assigned nurse allowed to read shared thread')from nc where label='read';
select pg_temp.ok(not(value?|array['drafts','deliveries','sourceToken']),'Nurse read never discloses private doctor commands')from nc where label='read';
-- New route facts use the same assignment/session check and never expose an endpoint.
select pg_temp.ok(not(public.conversation_nurse_workspace(pg_temp.uid(1))?|array['telegramLinked','telegramSendingEnabled']),'Legacy reader keeps its strict JSON shape');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramLinked'='false','No active Telegram link is explained');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramSendingEnabled'='false','Database sending switch is explained');
reset role;
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.uid(1),'telegram','nurse-route-fictional','nurse-route-principal','private-address',1,true,'nurse-chat-fictional','infinity',4096);
update public.conversation_policy set delivery_enabled=true where singleton;
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramLinked'='true','Current linked member route is explained');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramSendingEnabled'='true','Enabled sending is explained');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),false)->>'telegramSendingEnabled'='false','Environment switch also disables Telegram handoff guidance');
select pg_temp.ok(not(public.conversation_nurse_workspace(pg_temp.uid(1),true)::text like '%private-address%'),'Nurse route projection hides endpoint address');
reset role;
update public.conversation_endpoints set expires_at=clock_timestamp()-interval '1 second'where member_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramLinked'='false','Expired link cannot suggest Telegram handoff');
reset role;
update public.conversation_endpoints set expires_at='infinity',policy_version='old-policy'where member_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramLinked'='false','Old policy link cannot suggest Telegram handoff');
reset role;
update public.conversation_endpoints set policy_version='nurse-chat-fictional',active=false where member_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)->>'telegramLinked'='false','Unlinked member cannot suggest Telegram handoff');
reset role;
update public.conversation_policy set delivery_enabled=false where singleton;
set local role authenticated;
insert into nc values('sent',public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Fictional nurse reply'));
select pg_temp.ok(value->>'ok'='true'and value->>'replayed'='false','Assigned nurse allowed to send')from nc where label='sent';
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Fictional nurse reply')->>'replayed'='true','Retry replays same immutable reply');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Altered reply')->>'code'='request_conflict','Retry cannot change body');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),0,'Fictional nurse reply')->>'code'='request_conflict','Retry cannot change context');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(22),0,'Stale reply')->>'code'='stale_context','New member text fences stale send');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(22),1,repeat('x',4097))->>'code'='invalid','SQL length bound');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(22),1,'   ')->>'code'='invalid','SQL empty body refused');
do $$begin perform public.conversation_workspace(pg_temp.uid(1));raise exception 'Nurse received doctor workspace';exception when insufficient_privilege then null;end$$;
do $$begin perform public.conversation_actions(pg_temp.uid(1));raise exception 'Nurse received doctor approval intents';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.claims(4);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'code'='denied','Another nurse refused read');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)='{"ok":false,"code":"denied"}'::jsonb,'Another nurse receives no route facts');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(23),1,'Other nurse reply')->>'code'='denied','Another nurse refused send');
do $$begin perform * from public.conversation_nurse_replies;raise exception 'Direct table read exposed';exception when insufficient_privilege then null;end$$;
reset role;
-- Snapshot attribution survives a rename; current doctor sees it through the normal entry point.
update public.workspace_staff set display_name='Renamed nurse'where user_id=pg_temp.uid(3);
select pg_temp.claims(2);set local role authenticated;
select pg_temp.ok(public.conversation_workspace(pg_temp.uid(1))#>>'{nurseReplies,0,senderName}'='Fictional assigned nurse','Doctor sees actual frozen nurse sender');
select pg_temp.ok(public.conversation_workspace(pg_temp.uid(1))#>>'{nurseReplies,0,text}'='Fictional nurse reply','Doctor sees shared nurse text');
insert into nc values('today',public.doctor_ai_inbox());
select pg_temp.ok(value#>>'{nurseActivity,0,senderName}'='Fictional assigned nurse'and value#>>'{nurseActivity,0,text}'='Fictional nurse reply','Today includes frozen nurse attribution and text')from nc where label='today';
select pg_temp.ok(exists(select 1 from nc,jsonb_array_elements(value->'items')i where label='today'and i->>'memberId'=pg_temp.uid(1)::text and i->>'kind'='reply_draft'),'Nurse activity does not close the pending doctor reply');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(24),1,'Doctor cannot pose as nurse')->>'code'='denied','Doctor cannot forge nurse role');
reset role;
-- The inbox replacement must retain urgent_reach's same-day routing after a nurse send.
insert into public.conversation_audit(conversation_id,kind,detail)
 select id,'zoe.forward',jsonb_build_object('seq',version,'urgency','same_day')from public.conversations where member_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_ai_inbox()->'items')i where i->>'memberId'=pg_temp.uid(1)::text and i->>'kind'='reply_draft'and i->>'lane'='P1'),'Same-day forward stays in Today after a nurse reply');
reset role;
select pg_temp.claims(1);set local role authenticated;
select pg_temp.ok(public.conversation_member_thread()#>>'{nurseReplies,0,senderRole}'='nurse','Member sees actual nurse role');
select pg_temp.ok(public.conversation_member_thread()#>>'{nurseReplies,0,text}'='Fictional nurse reply','Member reads nurse reply on same thread');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'code'='denied','Member cannot use staff reader');
reset role;
select pg_temp.claims(5);set local role authenticated;
select pg_temp.ok(not(public.conversation_member_thread()?'nurseReplies'),'Another member cannot read nurse reply');
reset role;
select pg_temp.claims(4);set local role authenticated;
do $$begin perform public.doctor_ai_inbox();raise exception 'Nurse received doctor Today';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok((select count(*)=1 from public.conversation_nurse_replies where conversation_id=(select id from public.conversations where member_id=pg_temp.uid(1))),'Exactly one nurse reply after replay/conflict/denied/stale');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where actor_id=pg_temp.uid(3)and kind='nurse.reply_sent'and detail->>'replyId'=(select value->>'replyId'from nc where label='sent')),'One audit written atomically with reply');
select pg_temp.ok(not exists(select 1 from public.conversation_audit where actor_id=pg_temp.uid(3)and detail::text like '%Fictional nurse reply%'),'Audit excludes message text');
select pg_temp.ok(exists(select 1 from public.access_audit where actor_id=pg_temp.uid(3)and member_id=pg_temp.uid(1)and surface='member_messages'),'Nurse read audited');
select pg_temp.ok(not exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=(select id from public.conversations where member_id=pg_temp.uid(1))),'Nurse send creates no doctor approval or takeover');
select pg_temp.ok(not exists(select 1 from public.zoe_runs where conversation_id=(select id from public.conversations where member_id=pg_temp.uid(1))),'Nurse reply never enters Zoe');
select pg_temp.ok((select version=1 from public.conversations where member_id=pg_temp.uid(1)),'Nurse reply does not create a member message or alter doctor context version');
select pg_temp.ok((select draft_epoch=1 from public.conversations where member_id=pg_temp.uid(1)),'Nurse reply advances staff work freshness exactly once across replay');
-- Reassignment and session revocation are checked again even on an accepted request id.
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.uid(4)where user_id=pg_temp.uid(1);
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Fictional nurse reply')->>'code'='denied','Reassigned nurse refused on replay');
reset role;
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.uid(3)where user_id=pg_temp.uid(1);
update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=pg_temp.uid(13);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'code'='denied','Expired session refused read');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Fictional nurse reply')->>'code'='denied','Expired session refused on replay');
reset role;
update auth.sessions set not_after=null where id=pg_temp.uid(13);
update public.conversation_policy set app_chat_enabled=false where singleton;
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'canSend'='false','App chat off is read-only');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(25),1,'No app route')->>'code'='unavailable','Unavailable app route refuses new send');
reset role;
-- Match the doctor's visibility warnings for unrecorded member input.
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 select id,pg_temp.uid(1),'message.media',jsonb_build_object('version',version+1)from public.conversations where member_id=pg_temp.uid(1);
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 select id,pg_temp.uid(1),'message.overflow',jsonb_build_object('version',version+1)from public.conversations where member_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'unsupportedMedia'='true','Nurse sees unread-media warning');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'unsavedOverLimit'='true','Nurse sees overflow warning');
reset role;
update public.nurse_chat_settings set enabled=false where singleton;
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1))->>'code'='off','Database disable refuses direct reader');
select pg_temp.ok(public.conversation_nurse_workspace(pg_temp.uid(1),true)='{"ok":false,"code":"off"}'::jsonb,'Disabled nurse chat exposes no route facts');
select pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),pg_temp.uid(21),1,'Fictional nurse reply')->>'code'='off','Database disable refuses replay as well');
reset role;
select pg_temp.claims(2);set local role authenticated;
select pg_temp.ok(public.conversation_workspace(pg_temp.uid(1))#>>'{nurseReplies,0,text}'='Fictional nurse reply','Disabling nurse chat retains doctor history');
reset role;
rollback;
