/**
 * The dose on Telegram end to end against a real local database, with Telegram itself faked at the HTTP port: the real
 * webhook, inbox, sweep, shared command, outbox and adapter. A member types, Zoe's run clears the message (a synthetic
 * finished run; no model), the card arrives with its buttons, and each press is delivered the way Telegram delivers it.
 *
 * Needs a lane's local stack; it writes synthetic rows there and never leaves the machine. Run it by hand:
 *   NOREON_TEST_DB_CONTAINER=supabase_db_<lane> DOCKER_CONTEXT=colima-<profile> \
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api port> SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *   node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/zoe-card-telegram-flow.ts
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {createTelegramAdapter,type TelegramHttpPort} from '@/lib/telegram-channel/outbound';
import {runTelegramSweep} from '@/lib/telegram-runtime/dispatch';
import {LDL_RETEST_ALGORITHM,LDL_RETEST_REQUIREMENT} from '@/lib/ldl/retest';
import {handleCardPress} from '@/lib/telegram-runtime/cards';
import {serviceRpc,telegramCards,telegramWebhook} from '@/lib/telegram-runtime/server';

const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_')||container==='supabase_db_noreon-core')throw Error('Set NOREON_TEST_DB_CONTAINER to a lane\'s isolated local Supabase container.');
const ACCOUNT='noreon_flow',BOT_ID=9301,SECRET='synthetic_flow_webhook_secret_0123456789',TOKEN=`${BOT_ID}:synthetic_opaque_bot_token_0123456789AB`;
Object.assign(process.env,{NOREON_TELEGRAM_ENABLED:'true',NOREON_TELEGRAM_ACCOUNT:ACCOUNT,NOREON_TELEGRAM_BOT_ID:String(BOT_ID),NOREON_TELEGRAM_WEBHOOK_SECRET:SECRET,NOREON_TELEGRAM_BOT_TOKEN:TOKEN});
globalThis.fetch=new Proxy(globalThis.fetch,{apply(target,self,args:[RequestInfo|URL,RequestInit?]){
 const url=String(args[0] instanceof Request?args[0].url:args[0]);
 if(!url.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL!))throw Error('Only the local database may be reached.');
 return Reflect.apply(target,self,args);
}});

const sql=(text:string)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-q','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
const one=(text:string)=>sql(text).split('\n').at(-1)??'';

const member=randomUUID(),other=randomUUID(),medicine=randomUUID(),chat=randomInt(100_000_000,900_000_000),otherChat=chat+1,stranger=chat+2;
const principal=(u:number)=>`["telegram","${ACCOUNT}",${BOT_ID},"user",${u}]`;
const account=`["${ACCOUNT}",${BOT_ID}]`;
const yerevanTime=sql(`select to_char((clock_timestamp()-interval '5 minutes')at time zone 'Asia/Yerevan','HH24:MI')`);
sql(`
insert into auth.users(id,phone,phone_confirmed_at)values('${member}','3749${chat}',now()),('${other}','3749${otherChat}',now());
insert into public.patient_clinical_cases(user_id)values('${member}'),('${other}');
update public.profiles set locale='en'where id in('${member}','${other}');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('${ACCOUNT}',${BOT_ID},600,'consent-v1')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-flow',3600,600,60,100,false,true)on conflict(singleton)do update set delivery_enabled=true;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true,delivery_enabled=true where singleton;
update public.member_medicine_settings set enabled=true where singleton;
update public.system_message_templates set approved=true where template_id='zoe.card';
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values('${medicine}','${member}','Synthetic statin','10 mg',array['${yerevanTime}'::time],current_date-3);
select public._telegram_replies_activate('${member}',(public._telegram_auth_bind('${member}','member','${principal(chat)}','${account}',public._auth_phone('${member}'),'${chat}',null)->>'bindingId')::uuid);
select public._telegram_replies_activate('${other}',(public._telegram_auth_bind('${other}','member','${principal(otherChat)}','${account}',public._auth_phone('${other}'),'${otherChat}',null)->>'bindingId')::uuid);
`);

type Call={method:string;body:Record<string,unknown>};
const telegramCalls:Call[]=[];
let sentId=7000,failNext:string|null=null;
const http:TelegramHttpPort=async(url,init)=>{
 const method=url.slice(url.lastIndexOf('/')+1),body=JSON.parse(init.body) as Record<string,unknown>;
 telegramCalls.push({method,body});
 if(failNext===method){failNext=null;throw Error('synthetic timeout');}
 if(method==='answerCallbackQuery')return Response.json({ok:true,result:true});
 return Response.json({ok:true,result:{message_id:body.message_id??++sentId,date:1_760_000_000,from:{id:BOT_ID,is_bot:true,first_name:'Noreon'},chat:{id:body.chat_id,type:'private'},text:body.text}});
};
const rpc=serviceRpc()!;
const adapter=createTelegramAdapter({config:{account:ACCOUNT,botId:BOT_ID,enabled:true,botToken:TOKEN,timeoutMs:2000,maxResponseBytes:262_144},http});
const sweep=()=>runTelegramSweep({rpc,adapter,accountRef:account,cards:telegramCards});
const hook=telegramWebhook();
let update=randomInt(1,1_000_000)*1000;
const post=async(body:unknown)=>hook(new Request('https://noreon.invalid/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(body)}));
const person=(id:number)=>({id,is_bot:false,first_name:'Synthetic'});
const text=(from:number,t:string)=>({update_id:++update,message:{message_id:update,date:1_760_000_000,from:person(from),chat:{id:from,type:'private',first_name:'Synthetic'},text:t}});
const callback=(from:number,messageId:number,data:string,id=`cb_${++update}`)=>({update_id:++update,callback_query:{id,from:person(from),chat_instance:'-555',data,
 message:{message_id:messageId,date:1_760_000_000,from:{id:BOT_ID,is_bot:true,first_name:'Noreon',username:'noreon_test_bot'},chat:{id:from,type:'private',first_name:'Synthetic'},text:'Zoe card',has_protected_content:true}}});
const doses=()=>sql(`select status||':'||revision from public.member_medicine_doses where medicine_id='${medicine}'`);
const calls=(method:string)=>telegramCalls.filter(c=>c.method===method);
const step=(s:string)=>console.log(`ok   ${s}`);

// 1. The member types; Zoe's run clears it; the card arrives with buttons, protected.
assert.equal((await post(text(chat,'I took my pill, can you log it'))).status,200);
await sweep();
assert.equal(calls('sendMessage').filter(c=>String(c.body.text).startsWith('Zoe:')).length,0,'nothing before Zoe has cleared the message');
const seq=one(`select max(m.seq)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${member}'`);
sql(`insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 select id,member_id,${seq},0,0,'finished','answered','health_answer_passed_guards',current_date,clock_timestamp()from public.conversations where member_id='${member}'`);
await sweep();
const card=calls('sendMessage').find(c=>String(c.body.text).startsWith('Zoe:'));
assert.ok(card,'the card message was sent');
assert.equal(card.body.chat_id,chat);assert.equal(card.body.protect_content,true);
assert.match(String(card.body.text),/Synthetic statin 10 mg/);
const keyboard=(card.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
assert.deepEqual(keyboard.map(r=>r.map(b=>b.text)),[['Mark as taken','Mark as missed'],['Show current in chat']]);
assert.ok(keyboard.flat().every(b=>/^ni1:[A-Za-z0-9_-]{16,60}$/.test(b.callback_data)&&!b.callback_data.includes(member)&&!b.callback_data.includes(medicine)),'buttons carry only an opaque reference');
assert.equal(one(`select state from public.system_messages where template_id='zoe.card'and member_id='${member}'`),'accepted_by_provider');
step('a typed message cleared by Zoe brings the card, with opaque buttons, protected');
const messageId=sentId,taken=keyboard[0][0].callback_data,missed=keyboard[0][1].callback_data,current=keyboard[1][0].callback_data;

// 2. A forged reference, another member's press and a stranger's press do nothing.
for(const [from,data] of [[chat,'ni1:AAAAAAAAAAAAAAAAAAAAAAAA'],[otherChat,taken],[stranger,taken]] as const){
 assert.equal((await post(callback(from,messageId,data))).status,200);
 await sweep();
}
assert.equal(doses(),'','no write');
assert.deepEqual(calls('answerCallbackQuery').map(c=>c.body.text),['This button no longer works. Write to Zoe here again.','This button no longer works. Write to Zoe here again.',
 'Այս զրույցն այլևս կապված չէ ձեր Noreon հաշվին։']);
assert.equal(calls('editMessageText').length,0);
step('a forged reference, another member and an unlinked stranger change nothing, and each gets one short line');

// 3. A double tap, processed by two sweeps at once: one dose, both answered.
telegramCalls.length=0;
const first=callback(chat,messageId,taken),second=callback(chat,messageId,taken);
await post(first);await post(second);
await Promise.all([sweep(),sweep()]);
await sweep();
assert.equal(doses(),'taken:1','one dose');
assert.equal(calls('answerCallbackQuery').length,2);
assert.ok(calls('answerCallbackQuery').every(c=>c.body.text==='Logged as taken.'));
assert.ok(calls('editMessageText').length>=1);
assert.match(String(calls('editMessageText')[0].body.text),/Synthetic statin 10 mg, \d\d:\d\d: Taken/);
assert.equal(one(`select outcome::text from public.zoe_chat_cards where member_id='${member}'`).includes('"status": "taken"'),true,'the card records it');
step('a double tap across two concurrent sweeps writes one dose and answers both');

// 4. Telegram redelivers a press after the answer timed out: the same row, nothing again.
telegramCalls.length=0;
failNext='answerCallbackQuery';
const third=callback(chat,messageId,taken);
await post(third);await sweep();
assert.equal(calls('answerCallbackQuery').length,1,'the answer was tried once');
assert.equal((await post(third)).status,200,'the redelivered update is acknowledged');
await sweep();
assert.equal(calls('answerCallbackQuery').length,1,'and not processed again');
assert.equal(doses(),'taken:1');
step('a delivery timeout repeats nothing, and a redelivered update is the same row');

// 5. The other answer on the same dose is refused by the claim.
telegramCalls.length=0;
await post(callback(chat,messageId,missed));await sweep();
assert.equal(doses(),'taken:1');
assert.match(String(calls('answerCallbackQuery')[0].body.text),/changed after the card was shown/);
step('the other answer on a logged dose changes nothing and says so');

// 5b. Changed elsewhere after the card logged it (QA a9-01, a9-02): the old card does not confirm, and keeps no buttons to press.
telegramCalls.length=0;
sql(`update public.member_medicine_doses set status='skipped',revision=revision+1 where medicine_id='${medicine}'`);
await post(callback(chat,messageId,taken));await sweep();
assert.match(String(calls('answerCallbackQuery')[0].body.text),/changed after the card was shown/);
assert.equal(doses(),'skipped:2','the record stands');
assert.doesNotMatch(String(calls('editMessageText')[0].body.text),/: Taken/);
assert.deepEqual((calls('editMessageText')[0].body.reply_markup as {inline_keyboard:{text:string}[][]}).inline_keyboard.flat().map(b=>b.text),['Show current in chat']);
sql(`update public.member_medicine_doses set status='taken',revision=revision+1 where medicine_id='${medicine}'`);
step('a dose changed elsewhere is not confirmed by the old card, which keeps no buttons');

// 6. Show current posts a fresh card, once, and keeps the old message.
telegramCalls.length=0;
const show=callback(chat,messageId,current);
await post(show);await sweep();
const fresh=calls('sendMessage').filter(c=>String(c.body.text).startsWith('Zoe:'));
assert.equal(fresh.length,1,'one fresh card');
assert.match(String(fresh[0].body.text),/: Taken/,'it shows the record as it is now');
assert.equal(calls('editMessageText').length,0);
assert.equal(one(`select count(*)from public.zoe_chat_cards where member_id='${member}'`),'2');
step('show current posts one fresh card and leaves the old one as it was shown');

// 7. The same card is in the app: one conversation, two channels.
assert.equal(sql(`begin;select set_config('request.jwt.claims','{"sub":"${member}","role":"authenticated"}',true);set local role authenticated;select jsonb_array_length(public.zoe_chat_cards_member()->'cards');rollback;`).split('\n').at(-1),'2','the app reads both cards');
step('the app reads the same two cards with their outcome');

// 7b. A medicine from the published plan: on the same card, saved through the plan's own report, recorded as the member.
const plan=randomUUID(),planMed=randomUUID();
sql(`insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values('${plan}','${member}','Fictional doctor','Fictional only',now()-interval '2 days');
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date)values('${planMed}','${member}','${plan}','Synthetic plan medicine','20 mg','Fictional only',array['${yerevanTime}'::time],current_date-1);`);
telegramCalls.length=0;
await post(callback(chat,messageId,current));await sweep();
const planCard=calls('sendMessage').filter(c=>String(c.body.text).startsWith('Zoe:')).at(-1)!;
assert.match(String(planCard.body.text),/Synthetic plan medicine 20 mg/);
const planKeys=(planCard.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
telegramCalls.length=0;
await post(callback(chat,sentId,planKeys[0][0].callback_data));await sweep();
assert.equal(sql(`select status||':'||revision from public.patient_dose_events where medication_id='${planMed}'`),'taken:1');
assert.equal(sql(`select recorded_by from public.patient_dose_event_history where medication_id='${planMed}'and kind='report'`),member,'the history names the member');
assert.equal(calls('answerCallbackQuery')[0].body.text,'Logged as taken.');
assert.match(String(calls('editMessageText')[0].body.text),/Synthetic plan medicine 20 mg, \d\d:\d\d: Taken/);
step('a plan medicine is on the card, saved by the plan\'s report, and its history names the member');

// 7c. Blood pressure: no form on Telegram, so the numbers come as a message, through Zoe, and the card shows them back.
sql(`update public.profiles set display_name='Fictional',birth_date='1970-01-01',biological_sex='male'where id='${member}';
insert into public.patient_consents(user_id,version)values('${member}','patient-pilot-v1');insert into public.patient_assessments(user_id)values('${member}');`);
const zoeFinished=(outcome:string,reason:string)=>sql(`insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 select c.id,c.member_id,(select max(m.seq)from public.conversation_messages m where m.conversation_id=c.id),0,0,'finished','${outcome}','${reason}',current_date,clock_timestamp()from public.conversations c where c.member_id='${member}'`);
const newestCard=()=>calls('sendMessage').filter(c=>String(c.body.text).startsWith('Zoe:')).at(-1);
// The menu: no chips on Telegram, so /menu is the way in. It needs no Zoe run and leaves nothing in the conversation.
telegramCalls.length=0;
const messagesBefore=one(`select count(*)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${member}'`);
await post(text(chat,'/menu'));await sweep();
const menu=newestCard()!;
assert.equal(String(menu.body.text),'Zoe: What would you like to do?');
const menuKeys=(menu.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
assert.deepEqual(menuKeys.flat().map(b=>b.text),['Log today’s medicine','Record blood pressure','My latest results','My plan','My LDL goal','My visit','Report a side effect','Message my care team']);
assert.equal(one(`select count(*)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${member}'`),messagesBefore,'the command is not a message to Zoe');
telegramCalls.length=0;
await post(text(stranger,'/menu'));await sweep();
assert.equal(newestCard(),undefined,'an unlinked chat gets its next step, not a menu');
telegramCalls.length=0;
await post(callback(chat,sentId,menuKeys[0][0].callback_data));await sweep();
assert.match(String(newestCard()!.body.text),/Today’s medicines/);
step('/menu lists the tasks and a button opens the card, with no message to Zoe; an unlinked chat gets no menu');
// Results: the page's rows, in the chat.
sql(`set session_replication_role=replica;insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)
 values('${member}','Synthetic LDL cholesterol',2.1,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',now(),'Fictional doctor','${plan}'),('${member}','Synthetic unreviewed',9,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',null,null,'${plan}');set session_replication_role=origin;`);
telegramCalls.length=0;
await post(callback(chat,sentId-1,menuKeys[2][0].callback_data));await sweep();
assert.match(String(newestCard()!.body.text),/Your latest results[\s\S]*Synthetic LDL cholesterol: 2\.1 mmol\/L/);
assert.doesNotMatch(String(newestCard()!.body.text),/unreviewed/);
step('results come into the chat, and an unreviewed row does not');
telegramCalls.length=0;
await post(callback(chat,sentId-2,menuKeys[3][0].callback_data));await sweep();
assert.match(String(newestCard()!.body.text),/Your plan[\s\S]*Fictional only[\s\S]*Synthetic plan medicine, 20 mg/);
step('the published plan comes into the chat');
// A notice opens its task in the chat: the notice's own line, with a button instead of a link, and the card on the press.
telegramCalls.length=0;
sql(`update public.member_notice_settings set reminders=true,care=true,throttle_seconds=0,hourly_cap=60;insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.ldl_result_with_doctor',${update%1000000+1000},'en','Synthetic notice line.',true),('member_notice.open_label',${update%1000000+1000},'en','Open Noreon',true)on conflict do nothing;
select public._member_notice_safe('${member}','care','member.ldl_result_with_doctor','ldl.result_with_doctor:flow${chat}','{}','/patient/progress','open_progress');`);
await sweep();
const notice=calls('sendMessage').find(c=>!String(c.body.text).startsWith('Zoe:'))!;
assert.ok(notice,'the notice went');
const noticeKeys=(notice.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
assert.deepEqual(noticeKeys.flat().map(b=>b.text),['My LDL goal']);
assert.ok(!JSON.stringify(notice.body.reply_markup).includes('"url"'),'no link');
telegramCalls.length=0;
await post(callback(chat,sentId,noticeKeys[0][0].callback_data));await sweep();await sweep();
assert.match(String(newestCard()!.body.text),/Your LDL cholesterol goal/);
step('a notice keeps its line, and its button opens the card in the chat');
const readings=()=>sql(`select coalesce(string_agg(systolic||'/'||diastolic||':'||coalesce(pulse::text,'-'),','),'')from public.patient_measurements where user_id='${member}'`);
telegramCalls.length=0;
await post(text(chat,'record my blood pressure'));await sweep();
zoeFinished('chatted','chat_reply_passed_guards');await sweep();
const asked=newestCard()!;
assert.match(String(asked.body.text),/Write the two numbers here/);
assert.deepEqual((asked.body.reply_markup as {inline_keyboard:{text:string}[][]}).inline_keyboard.flat().map(b=>b.text),['Show current in chat']);
telegramCalls.length=0;
await post(text(chat,'BP 150/95 pulse 70'));await sweep();
assert.equal(newestCard(),undefined,'nothing before Zoe has cleared the message');
zoeFinished('answered','health_answer_passed_guards');await sweep();
const shownBack=newestCard()!;
assert.match(String(shownBack.body.text),/Save this reading: 150\/95, pulse 70/);
const saveKeys=(shownBack.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
assert.deepEqual(saveKeys.map(r=>r.map(b=>b.text)),[['Yes, save it'],['Show current in chat']]);
assert.equal(readings(),'','nothing saved before the press');
const saveId=sentId;
telegramCalls.length=0;
await post(callback(chat,saveId,saveKeys[0][0].callback_data));await post(callback(chat,saveId,saveKeys[0][0].callback_data));
await Promise.all([sweep(),sweep()]);await sweep();
assert.equal(readings(),'150/95:70','one reading');
assert.ok(calls('answerCallbackQuery').length===2&&calls('answerCallbackQuery').every(c=>c.body.text==='Saved.'));
assert.match(String(calls('editMessageText')[0].body.text),/Saved: 150\/95, pulse 70\.[\s\S]*does not automatically notify a doctor/);
assert.equal(sql(`select count(*)from public.care_alerts where member_id='${member}'`),'0','a saved reading alerts nobody');
telegramCalls.length=0;
await post(callback(chat,saveId,saveKeys[1][0].callback_data));await sweep();
assert.match(String(newestCard()!.body.text),/Last saved reading: 150\/95, pulse 70/);
step('a typed reading comes back as a card, one press saves it once, nobody is told, and show current shows it');
// Numbers alone: Zoe answers them in free mode; a run from before that (no language, no reply) keeps the card too.
telegramCalls.length=0;
await post(text(chat,'148/92'));await sweep();
zoeFinished('answered','health_answer_passed_guards');await sweep();
assert.match(String(newestCard()!.body.text),/Save this reading: 148\/92/);
telegramCalls.length=0;
await post(text(chat,'149/93'));await sweep();
zoeFinished('discarded','language_not_supported');await sweep();
assert.match(String(newestCard()!.body.text),/Save this reading: 149\/93/);
step('numbers alone come back as a card after Zoe\'s reply, and after an older run with no reply');
// Words around the numbers, or an urgent or forwarded run: no card, and nothing saved.
telegramCalls.length=0;
await post(text(chat,'BP 170/100 and I feel dizzy'));await sweep();
zoeFinished('answered','health_answer_passed_guards');await sweep();
await post(text(chat,'172/101'));await sweep();
zoeFinished('discarded','same_day_floor_doctor_mode');await sweep();
assert.equal(newestCard(),undefined,'no card');
assert.equal(readings(),'150/95:70');
step('a reading with other words, or after a same-day route, brings no card');

// 7d. Accepts through the real booking entry points, under the service role, with the features' switches on (Astra VIS-01).
Object.assign(process.env,{NOREON_REAL_TEST_REQUESTS_ENABLED:'true',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local',NOREON_CLINIC_SCHEDULING_ENABLED:'true',NOREON_CLINIC_PORTAL_ENABLED:'true'});
const pressCard=(cardId:string,action:'ldl_visit_accept'|'visit_accept')=>handleCardPress(rpc,adapter,{inboxId:randomUUID(),callbackId:`cb_${++update}`,chatId:chat,messageId:sentId,memberId:member,
 endpointId:one(`select id from public.conversation_endpoints where member_id='${member}'and active`),generation:Number(one(`select generation from public.conversation_endpoints where member_id='${member}'and active`)),cardId,action,item:{},locale:'en'});
const insertCard=(kind:string,snapshot:unknown)=>{const id=randomUUID();sql(`insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)values('${id}','${member}',gen_random_uuid(),'${kind}','chip','${JSON.stringify(snapshot)}')`);return id;};
const ldlRequest=randomUUID(),proposal={provider:'Fictional nurse',startsAt:'2030-01-02T08:00:00+00:00',endsAt:'2030-01-02T09:00:00+00:00',preparation:'Fictional only.'};
const requirement=JSON.stringify([LDL_RETEST_REQUIREMENT]);
sql(`set session_replication_role=replica;
insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload,status,revision,proposal)
 select '${ldlRequest}','${member}','{"timezone":"Asia/Yerevan","mode":"home","location":"Synthetic home","startsAt":"2030-01-02T08:00:00Z"}','${requirement}','${LDL_RETEST_ALGORITHM}',public.patient_test_context('${member}')->>'token','{}','provider-proposed',1,
  '{"terms":{"timezone":"Asia/Yerevan","mode":"home","location":"Synthetic home","startsAt":"2030-01-02T08:00:00Z","endsAt":"2030-01-02T09:00:00Z"},"provider":"Fictional nurse","preparation":"Fictional only."}';
set session_replication_role=origin;`);
const ldlSnapshot=(revision:number)=>({v:1,data:{version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],withDoctor:null,retest:{id:ldlRequest,dueFrom:'2030-01-01',dueTo:'2030-01-15',state:'requested',overdue:false,request:{id:ldlRequest,revision,status:'provider-proposed',algorithmVersion:LDL_RETEST_ALGORITHM,proposal,arrangement:null}}}});
const staleCard=insertCard('ldl',ldlSnapshot(0));
assert.equal((await pressCard(staleCard,'ldl_visit_accept')).status,'stale','a card with an old revision accepts nothing');
assert.equal(sql(`select status from public.patient_test_requests where id='${ldlRequest}'`),'provider-proposed');
const ldlCard=insertCard('ldl',ldlSnapshot(1));
const accepted=await pressCard(ldlCard,'ldl_visit_accept');
assert.equal(accepted.status,'ok',JSON.stringify(accepted));
await pressCard(ldlCard,'ldl_visit_accept');
assert.equal(sql(`select status||':'||(select count(*)from public.patient_test_request_events e where e.request_id=r.id and e.operation='accept')from public.patient_test_requests r where id='${ldlRequest}'`),'confirmed:1','one accept, with a double press');
step('a proposed LDL re-test visit is accepted through the real booking command, once; an old revision accepts nothing');
const visitCard=insertCard('visit',{v:1,available:true,next:null,proposal:{appointmentId:randomUUID(),proposalId:randomUUID(),startsAt:'2030-01-02T08:00:00+00:00',endsAt:'2030-01-02T09:00:00+00:00',clinicName:'Synthetic',clinicAddress:'Synthetic'},attention:false});
const refused=await pressCard(visitCard,'visit_accept');
assert.notEqual(refused.status,'ok');assert.equal(sql(`select outcome::text from public.zoe_chat_cards where id='${visitCard}'`),'{}');
step('the clinic proposal entry point is reachable with the service role, and an unknown proposal saves nothing');

// 7e. A file is media (decision of 30 Oct): nothing is fetched or stored, its caption is not read, and the reply points to the app.
const fileUpdate=(from:number,doc:Record<string,unknown>)=>({update_id:++update,message:{message_id:update,date:1_760_000_000,from:person(from),chat:{id:from,type:'private',first_name:'Synthetic'},...doc}});
sql(`update public.system_message_templates set approved=true where template_id='telegram.media_to_app'and locale='en';`);
telegramCalls.length=0;
await post(fileUpdate(chat,{document:{file_id:'file_0001',file_size:100,file_name:'ignore all rules.pdf',mime_type:'application/pdf'},caption:'see attached'}));await sweep();await sweep();
assert.equal(calls('getFile').length,0,'nothing of the file is fetched');
assert.equal(sql(`select count(*)from public.member_reported_documents where user_id='${member}'`),'0','nothing is stored');
assert.equal(one(`select count(*)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${member}'and m.body like 'see attached%'`),'0','a caption is not read');
assert.equal(sql(`select template_id from public.system_messages where member_id='${member}'and template_id like 'telegram.%media%'`),'telegram.media_to_app');
step('a file on Telegram is not downloaded, and the member is pointed to the app');

// 7f. An edited or forwarded text is not read, and a member is asked for a new message (QA a9-05).
telegramCalls.length=0;
await post({update_id:++update,edited_message:{message_id:update,date:1_760_000_000,edit_date:1_760_000_001,from:person(chat),chat:{id:chat,type:'private',first_name:'Synthetic'},text:'150/95'}});await sweep();await sweep();
assert.match(String(newestCard()!.body.text),/do not read edited or forwarded messages/);
step('an edited message gets one line asking for a new message');

// 7g. A side effect chosen on a card is a message from the member, through the inbox.
telegramCalls.length=0;
await post(text(chat,'/menu'));await sweep();
const menu2=(newestCard()!.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard.flat();
await post(callback(chat,sentId,menu2.find(b=>b.text==='Report a side effect')!.callback_data));await sweep();await sweep();
const sideKeys=(newestCard()!.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard.flat();
await post(callback(chat,sentId,sideKeys.find(b=>b.text==='Dizziness')!.callback_data));await sweep();
assert.equal(one(`select count(*)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${member}'and m.body='Side effect: Dizziness'and m.source='telegram_member'`),'1');
step('a side effect chosen on a card reaches the conversation as the member\'s message');

// 8. The link goes while a press is running: the dose stands, and no card content reaches the old chat (Astra MC-01).
const medicineTwo=randomUUID();
sql(`insert into public.member_medicines(id,user_id,name,dose,times,started_on)values('${medicineTwo}','${member}','Synthetic second',null,array['${yerevanTime}'::time],current_date-3)`);
telegramCalls.length=0;
await post(callback(chat,messageId,current));await sweep();
const opened=calls('sendMessage').filter(c=>String(c.body.text).startsWith('Zoe:')).at(-1)!;
const openedKeys=(opened.body.reply_markup as {inline_keyboard:{text:string;callback_data:string}[][]}).inline_keyboard;
assert.equal(openedKeys[0][0].text,'Mark as taken','only the second medicine is still open');
telegramCalls.length=0;
const unlinking=async(name:string,args:Record<string,unknown>)=>{
 const r=await rpc(name,args);
 if(name==='channel_inbox_process'&&(r as {press?:unknown})?.press)sql(`begin;select set_config('request.jwt.claims','{"sub":"${member}","role":"authenticated"}',true);set local role authenticated;select public.telegram_unlink();commit;`);
 return r;
};
await post(callback(chat,sentId,openedKeys[0][0].callback_data));
await runTelegramSweep({rpc:unlinking,adapter,accountRef:account,cards:telegramCards});
assert.equal(sql(`select status from public.member_medicine_doses where medicine_id='${medicineTwo}'`),'taken','the press was verified before the unlink, so it stands');
assert.equal(calls('answerCallbackQuery')[0].body.text,'Logged as taken.');
assert.equal(calls('editMessageText').length,0,'no card content goes to a chat that was unlinked');
step('an unlink during a press sends no card content to the old chat');

// 9. Link again, for the last step.
sql(`select public._telegram_replies_activate('${member}',(public._telegram_auth_bind('${member}','member','${principal(chat)}','${account}',public._auth_phone('${member}'),'${chat}',null)->>'bindingId')::uuid);`);

// 10. Unlink: the old message's buttons are dead, and nothing is written.
telegramCalls.length=0;
sql(`begin;select set_config('request.jwt.claims','{"sub":"${member}","role":"authenticated"}',true);set local role authenticated;select public.telegram_unlink();commit;`);
sql(`delete from public.member_medicine_doses where medicine_id='${medicine}'`);
await post(callback(chat,messageId,taken));await sweep();
assert.equal(doses(),'','no write after the unlink');
assert.equal(calls('answerCallbackQuery')[0].body.text,'This chat is no longer connected to your Noreon account.');
step('after an unlink the buttons are dead and the member is told why');

console.log('zoe-card-telegram-flow: all steps passed');
