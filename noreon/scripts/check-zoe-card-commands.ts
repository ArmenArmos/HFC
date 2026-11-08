/**
 * Zoe chat cards across channels (phase 1A). Pure checks; the database side is check-zoe-cards-telegram.sql.
 * 1. One command, two adapters: the app and Telegram call the same logDose and openCard, an actor exists only from a
 *    session or the database's answer about the bound chat, and nothing client-reachable takes a member id.
 * 2. The press: the shape Telegram really sends parses; the button is an opaque reference; saved is separate from
 *    delivered, so a timeout on the answer or the edit repeats nothing and a second tap writes once.
 * 3. The renderer: same snapshot, same recorded outcome, plain text within Telegram's limits, no clinical words added.
 * 4. The adapter: keyboard, protection, edit and answer on the wire; anything it cannot carry exactly is refused.
 * Injected ports only; global fetch throws, so an accidental real request fails the run.
 */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {inboxEventFrom} from '@/lib/telegram-channel/link';
import {createTelegramAdapter,type TelegramChannelAdapter,type TelegramHttpPort} from '@/lib/telegram-channel/outbound';
import {parseTelegramMedia,parseTelegramRedo,parseTelegramUpdate,type TelegramBot} from '@/lib/telegram-channel/protocol';
import {answerRefusedPress,cardKeyboard,handleCardPress,handleRedo,noticeKeyboard,offerTelegramCards,openMenu,processedSchema,telegramPorts,type CardPress} from '@/lib/telegram-runtime/cards';
import {dispatchAuthMessage,runTelegramSweep,type TelegramServiceRpc} from '@/lib/telegram-runtime/dispatch';
import {telegramCards} from '@/lib/telegram-runtime/server';
import {cardSchema,doseItem,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {telegramCardView} from '@/lib/zoe-chat-actions/telegram';
import {typedReading} from '@/lib/zoe-chat-actions/typed-reading';
import {LDL,allCopy,say} from '@/lib/zoe-chat-actions/copy';
import {cardIntent} from '@/lib/zoe-chat-actions/intent';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {logDose,type CardPorts} from '@/lib/zoe-chat-actions/commands';
import {doseSnapshotFrom,resultsSnapshotFrom} from '@/lib/zoe-chat-actions/server';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';

globalThis.fetch=(()=>{throw Error('Real network access is forbidden in this check.');}) as typeof fetch;
const results:string[]=[];
const scenario=async(name:string,fn:()=>Promise<void>|void)=>{await fn();results.push(name);console.log(`ok   ${name}`);};
const read=(p:string)=>readFileSync(p,'utf8');
const code=(p:string)=>read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);

const MEMBER='00000000-0000-4000-8000-0000000000aa',CARD='00000000-0000-4000-8000-0000000000c1',INBOX='00000000-0000-4000-8000-0000000000d1';
const MED='00000000-0000-4000-8000-0000000000a1',DUE='2026-10-30T04:00:00.000Z',LATER='2026-10-30T17:00:00.000Z';
const slots=[{medicineId:MED,name:'Amlodipine',dose:'5 mg',dueAt:DUE,time:'08:00',status:'due' as const,revision:0},
 {medicineId:'00000000-0000-4000-8000-0000000000a2',name:'Atorvastatin',dose:null,dueAt:LATER,time:'21:00',status:'upcoming' as const,revision:0}];
const PLAN='00000000-0000-4000-8000-0000000000b9',PLAN_MED='00000000-0000-4000-8000-0000000000a9';
const planSlot={medicineId:PLAN_MED,name:'Atorvastatin',dose:'40 mg',dueAt:DUE,time:'08:00',status:'due' as const,revision:0,planId:PLAN};
const stored=(over:Record<string,unknown>={})=>({id:CARD,requestId:'00000000-0000-4000-8000-0000000000e1',kind:'dose',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-10-30T04:05:00.000Z',
 snapshot:{v:1,enabled:true,date:'2026-10-30',slots},...over});
const card=(over:Record<string,unknown>={})=>cardSchema.parse(stored(over)) as ZoeCard;
// The SQL read's provenance must survive the strict Telegram schema and immutable card snapshot.
for(const entrySource of ['patient_text_entry','patient_photo_confirmed','patient_voice_confirmed',null,undefined] as const){
 const latest={systolic:185,diastolic:115,pulse:null,measuredAt:DUE,...(entrySource===undefined?{}:{entrySource})};
 const rpc:TelegramServiceRpc=async name=>{assert.equal(name,'member_bp_read_for');return {week:{version:'bp-week-v1',enabled:false},latest};};
 const snapshot=await telegramPorts(rpc,mintActor(MEMBER,'telegram')).snapshot('bp');
 const bpCard=card({kind:'bp',snapshot});
 assert.ok(bpCard.valid&&bpCard.kind==='bp');
 assert.deepEqual(bpCard.snapshot.latest,latest,'Telegram retains the source returned by SQL');
 for(const locale of ['en','hy','ru'] as const){
  const shown:string=telegramCardView(bpCard,locale)!.text;
  assert.ok(shown.includes('185/115'),'the latest saved reading is rendered');
  assert.equal(shown.includes(unverifiedBpLabel(locale)),entrySource==='patient_text_entry',`${locale}: exact label only for member-reported latest readings`);
  if(entrySource==='patient_text_entry'&&locale==='en')assert.ok(shown.includes('Member-reported, not verified'));
 }
}
const ENDPOINT='00000000-0000-4000-8000-0000000000b1';
const press=(over:Partial<CardPress>={}):CardPress=>({inboxId:INBOX,callbackId:'cb_1',chatId:8801,messageId:77,memberId:MEMBER,endpointId:ENDPOINT,generation:3,cardId:CARD,action:'dose_taken',item:{medicineId:MED,dueAt:DUE},locale:'en',...over});

/** The database as the press path sees it: one card, a claim that wins once, a dose written at most once. */
const planRead=(planId=PLAN,events:unknown[]=[])=>({offset:0,plan:{id:planId,publishedAt:'2026-10-01T00:00:00+00:00',medications:[{id:PLAN_MED,planId,effectiveAt:null,name:'Atorvastatin',dose:'40 mg',times:['08:00'],startDate:'2026-10-01',endDate:null,active:true}]},events});
function world(o:{medicines?:unknown;tick?:unknown;rpcFails?:string[];noRoute?:boolean;card?:Record<string,unknown>;plan?:unknown;planTick?:unknown;bpRead?:unknown;bpSave?:unknown;weekSave?:unknown;results?:unknown;planCard?:unknown;ldl?:unknown;visits?:unknown;asks?:unknown;openAsk?:unknown;answer?:unknown;bookingFails?:string;bookingSaved?:unknown;ldlEvidence?:unknown}={}){
 const state={answers:[] as Record<string,unknown>[],bookings:[] as Record<string,unknown>[],bpWrites:[] as Record<string,unknown>[],settled:[] as number[],planWrites:0,outcome:{} as Record<string,unknown>,claims:{} as Record<string,{op:string;payload:Record<string,unknown>}>,writes:0,done:[] as string[],calls:[] as {name:string;args:Record<string,unknown>}[],sent:[] as Record<string,unknown>[]};
 const snapshot=()=>stored({...o.card,outcome:state.outcome,claims:state.claims});
 const rpc:TelegramServiceRpc=async(name,args)=>{
  state.calls.push({name,args});
  if(o.rpcFails?.includes(name))throw Error('down');
  if(name==='zoe_chat_card_get')return snapshot();
  if(name==='zoe_chat_card_claim'){
   const item=args.p_item as string;
   state.claims[item]??={op:args.p_op as string,payload:args.p_payload as Record<string,unknown>};
   return {ok:true,claim:state.claims[item]};
  }
  if(name==='zoe_chat_card_record'){state.outcome[args.p_item as string]=args.p_value;return {ok:true,replayed:false,card:snapshot()};}
  if(name==='member_medicine_dose_report_for'){
   if(o.tick!==undefined)return o.tick;
   if(state.writes>0)return {status:'conflict'};
   state.writes++;return {status:'saved',revision:1};
  }
  if(name==='member_medicines_read_for'&&o.medicines)return o.medicines;
  if(name==='member_medicines_read_for')return {version:'member-medicines-v1',enabled:true,medicines:[{id:MED,source:'self-reported',name:'Amlodipine',dose:'5 mg',times:['08:00'],startedOn:'2026-10-01',createdAt:'2026-10-01T00:00:00Z',stoppedAt:null,effectiveAt:null,doses:[{dueAt:DUE,status:'taken',recordedAt:DUE,revision:1}]}]};
  if(name==='zoe_chat_card_telegram_settle'){state.settled.push(args.p_seq as number);return null;}
  if(name==='member_plan_doses_read_for')return o.plan===undefined?{offset:0,plan:null,events:[]}:o.plan;
  if(name==='report_patient_dose_for'){state.planWrites++;return o.planTick??{status:'saved',revision:1};}
  if(name==='member_medicine_asks_read_for')return o.asks??{version:'medicine-asks-v1',enabled:false};
  if(name==='member_medicine_ask_open_for')return o.openAsk===undefined?null:o.openAsk;
  if(name==='member_medicine_ask_answer_for'){state.answers.push(args);return o.answer??{status:'answered',next:'doctor'};}
  if(name==='member_visits_read_for')return o.visits??{appointments:[],portal:{memberId:MEMBER,enabled:true,appointments:{}}};
  if(name==='booking_portal_proposal_answer'){state.bookings.push(args);if(o.bookingFails)throw Error(`down (${o.bookingFails})`);return o.bookingSaved;}
  if(name==='booking_program_source'){state.bookings.push(args);return {token:'source-token',requirementsToken:'r',data:o.ldlEvidence};}
  if(name==='command_patient_test_request'){state.bookings.push(args);if(o.bookingFails)throw Error(`down (${o.bookingFails})`);return {status:'confirmed'};}
  if(name==='member_ldl_read_for')return o.ldl??{version:'ldl-member-v1',enabled:true,inPathway:false};
  if(name==='member_plan_read_for')return o.planCard??{plan:null};
  if(name==='member_results_read_for')return o.results??{publication:null,results:[]};
  if(name==='member_bp_read_for')return o.bpRead??{week:{version:'bp-week-v1',enabled:false},latest:null};
  if(name==='member_measurement_record_for'){state.bpWrites.push(args);return o.bpSave??{status:'saved'};}
  if(name==='bp_week_record_for'){state.bpWrites.push(args);return o.weekSave??{status:'saved'};}
  if(name==='zoe_chat_card_arm')return o.noRoute?{ok:false,code:'no_route'}:{ok:true,refs:(args.p_buttons as unknown[]).map((_,i)=>`reference_0000000${i}`)};
  if(name==='zoe_chat_card_post')return {ok:true,replayed:false,card:stored({id:'00000000-0000-4000-8000-0000000000c2',kind:args.p_kind,snapshot:args.p_snapshot})};
  if(name==='zoe_chat_card_send'){state.sent.push(args);return {ok:true,replayed:false};}
  if(name==='channel_inbox_press_done'){state.done.push(args.p_result as string);return {ok:true};}
  throw Error(`Unexpected rpc ${name}`);
 };
 return {rpc,state};
}
function telegram(o:{ack?:'hang'|'throw';edit?:'hang'|'throw'}={}){
 const log={acks:[] as (string|undefined)[],edits:[] as Record<string,unknown>[]};
 const adapter:Pick<TelegramChannelAdapter,'acknowledgeCallback'|'editText'>={
  acknowledgeCallback:async(_,text)=>{log.acks.push(text);if(o.ack==='throw')throw Error('timeout');return o.ack==='hang'?'unknown':'acknowledged';},
  editText:async p=>{log.edits.push(p as unknown as Record<string,unknown>);if(o.edit==='throw')throw Error('timeout');return o.edit==='hang'?'unknown':'edited';},
 };
 return {adapter,log};
}

await scenario('one command, two adapters: the app and Telegram call the same logDose and openCard',()=>{
 const actions=code('lib/zoe-chat-actions/actions.ts'),cards=code('lib/telegram-runtime/cards.ts');
 assert.match(actions,/logDose\(who,appPorts,parsed\.data\)/);assert.match(actions,/openCard\(who,appPorts,\{\.\.\.parsed\.data/);
 assert.match(cards,/logDose\(actor,ports,/);assert.match(cards,/openCard\(actor,/);
 assert.ok(!/tickMyMedicine\(|member_medicine_dose_report/.test(actions),'the app adapter does not write the dose itself');
 const commands=read('lib/zoe-chat-actions/commands.ts');
 assert.ok(!/^['"]use server['"]/m.test(commands),'commands are not server actions: no client can call one with an actor it made up');
 assert.ok(!/^['"]use server['"]/m.test(read('lib/zoe-chat-actions/actor.ts')),'nor is the actor');
 const body=commands.slice(commands.indexOf('export async function logDose'));
 assert.ok(body.indexOf('await claim(')>0&&body.indexOf('await claim(')<body.indexOf('ports.tickDose('),'the claim comes before the write');
});

await scenario('an actor comes only from a session or the bound chat; member ids never come from input',()=>{
 const minted=files('lib').concat(files('app'),files('components')).filter(f=>/\.tsx?$/.test(f)&&/mintActor\(/.test(code(f)));
 assert.deepEqual(minted.sort(),['lib/telegram-runtime/cards.ts','lib/zoe-chat-actions/actor.ts']);
 const cards=code('lib/telegram-runtime/cards.ts');
 assert.deepEqual([...cards.matchAll(/mintActor\(([^)]*)\)/g)].map(m=>m[1]).sort(),["menu.memberId,'telegram'","n.memberId,'telegram'","press.memberId,'telegram'","row.memberId,'telegram'"]);
 for(const f of ['lib/zoe-chat-actions/actions.ts'])assert.ok(!/memberId:z\.|userId:z\./.test(code(f)),`${f}: no input names a member`);
 // Both of those member ids are the database's answer: a press from channel_inbox_process, a row from the cleared-message read.
 assert.match(read('supabase/migrations/20261030102535_zoe_chat_cards_telegram.sql'),/'memberId',ep\.member_id/);
 assert.ok(!/from\.id|senderId|principalRef/.test(cards),'nothing here reads the sender from the update');
});

await scenario('safety stays in front: no pipeline import, typed text arrives only through the cleared read',()=>{
 for(const f of ['lib/telegram-runtime/cards.ts','lib/zoe-chat-actions/commands.ts','lib/zoe-chat-actions/telegram.ts','lib/zoe-chat-actions/actor.ts'])
  assert.ok(!/from '[^']*(?:urgent-staging|urgent-test|red-flags|same-day-floors|health-answer|pipeline|provider|gateway)/.test(code(f)),`${f} imports no safety rule or model`);
 for(const f of files('lib/zoe'))assert.ok(!/telegram-runtime\/cards|zoe-chat-actions/.test(read(f)),`${f} must not depend on the cards`);
 assert.match(read('supabase/migrations/20261030102535_zoe_chat_cards_telegram.sql'),/m\.source='telegram_member'and public\._zoe_chat_message_cleared\(c\.member_id,m\.seq\)/);
});

await scenario('protocol: the callback Telegram really sends for a protected card message parses, and only the reference is kept',()=>{
 const bot:TelegramBot={account:'synthetic-cards',botId:100};
 const update={update_id:9,callback_query:{id:'4382bfdwdsb323b2d9',from:{id:8801,is_bot:false,first_name:'Synthetic',language_code:'hy'},chat_instance:'-555000',data:'ni1:reference_00000000',
  message:{message_id:77,date:1_760_000_000,from:{id:100,is_bot:true,first_name:'Noreon',username:'noreon_test_bot'},chat:{id:8801,type:'private',first_name:'Synthetic'},text:'Zoe: Today’s medicines',
   has_protected_content:true,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:'Mark as taken',callback_data:'ni1:reference_00000000'}]]}}}};
 const p=parseTelegramUpdate(update,bot);
 assert.ok(p.ok,'a protected carrier message is admitted');
 const row=inboxEventFrom(p.event);
 assert.equal(row.kind,'callback');
 assert.deepEqual(row.payload,{chatId:8801,messageId:77,callbackId:'4382bfdwdsb323b2d9',intentRef:'reference_00000000'});
 assert.ok(!JSON.stringify(row).includes('Synthetic'),'no name, no button text');
});

await scenario('press: taken saves once, the answer and the edit say so, and the row finishes',async()=>{
 const {rpc,state}=world(),{adapter,log}=telegram();
 const r=await handleCardPress(rpc,adapter,press());
 assert.equal(r.status,'ok');assert.equal(state.writes,1);
 assert.deepEqual(state.done,['ok']);
 assert.deepEqual(log.acks,['Logged as taken.']);
 assert.equal(log.edits.length,1);
 const edit=log.edits[0] as {text:string;messageId:number;address:string;keyboard:{rows:{label:string}[][]}};
 assert.equal(edit.messageId,77);assert.equal(edit.address,'8801');
 assert.match(edit.text,/1\. Amlodipine 5 mg, 08:00: Taken/);
 assert.deepEqual(edit.keyboard.rows.flat().map(b=>b.label),['Refresh'],'the logged dose has no buttons left');
 assert.ok(state.calls.findIndex(c=>c.name==='channel_inbox_press_done')<state.calls.findIndex(c=>c.name==='zoe_chat_card_arm'),'the result is on the row before anything goes back to Telegram');
 assert.equal(state.calls.find(c=>c.name==='member_medicine_dose_report_for')?.args.p_member,MEMBER);
});

await scenario('an unlink or relink during a press: saved, the short line goes, and no card content reaches the old chat (Astra MC-01)',async()=>{
 const {rpc,state}=world({noRoute:true}),{adapter,log}=telegram();
 assert.equal((await handleCardPress(rpc,adapter,press())).status,'ok');
 assert.equal(state.writes,1);
 assert.equal(log.edits.length,0,'no edit without the exact link');
 assert.deepEqual(log.acks,['Logged as taken.'],'the answer names no medicine');
 const arm=state.calls.find(c=>c.name==='zoe_chat_card_arm')!;
 assert.equal(arm.args.p_endpoint,ENDPOINT);assert.equal(arm.args.p_generation,3);
});

await scenario('saved is not delivered: a timeout on the answer or the edit repeats nothing, and a retry after it replays',async()=>{
 for(const fail of ['hang','throw'] as const){
  const {rpc,state}=world(),{adapter}=telegram({ack:fail,edit:fail});
  assert.equal((await handleCardPress(rpc,adapter,press())).status,'ok','saved whatever Telegram answered');
  assert.equal(state.writes,1);assert.deepEqual(state.done,['ok']);
  // The member presses again because the screen did not change: the card's record answers, nothing is written.
  const second=await handleCardPress(rpc,adapter,press({inboxId:'00000000-0000-4000-8000-0000000000d2',callbackId:'cb_2'}));
  assert.equal(second.status,'ok');assert.equal(state.writes,1,'no second write');
  assert.equal(state.calls.filter(c=>c.name==='member_medicine_dose_report_for').length,1,'the feature was not called again');
 }
});

await scenario('replay after a crash between the save and the card record: the record decides, nothing doubles',async()=>{
 const {rpc,state}=world(),{adapter}=telegram();
 // The dose saved, the worker died before the card recorded it; the row is leased again.
 state.claims[doseItem({medicineId:MED,dueAt:DUE})]={op:'00000000-0000-4000-8000-0000000000f1',payload:{status:'taken'}};state.writes=1;
 const r=await handleCardPress(rpc,adapter,press());
 assert.equal(r.status,'ok');assert.equal(state.writes,1);
 assert.deepEqual(state.outcome,{[doseItem({medicineId:MED,dueAt:DUE})]:{status:'taken'}});
});

await scenario('two answers on one dose: the first claim wins, the other is told it changed, and no second write happens',async()=>{
 const {rpc,state}=world(),{adapter,log}=telegram();
 await handleCardPress(rpc,adapter,press());
 const r=await handleCardPress(rpc,adapter,press({action:'dose_skipped',inboxId:'00000000-0000-4000-8000-0000000000d2',callbackId:'cb_2'}));
 assert.equal(r.status,'stale');assert.equal(state.writes,1);
 assert.equal(log.acks[1],'This changed after the card was shown. You can see the current record here in the chat.');
});

await scenario('failures: nothing is claimed as saved, and the buttons stay for another try',async()=>{
 for(const [tick,status,line] of [[{status:'not-due'},'stale',/changed after/],[{status:'disabled'},'disabled',/not available/],[{status:'weird'},'failed',/could not save/],[null,'failed',/could not save/]] as const){
  const {rpc,state}=world({tick}),{adapter,log}=telegram();
  const r=await handleCardPress(rpc,adapter,press());
  assert.equal(r.status,status,JSON.stringify(tick));
  assert.deepEqual(state.outcome,{},'not recorded');
  assert.match(log.acks[0]!,line);
  assert.deepEqual(state.done,[status]);
 }
 const {rpc,state}=world({rpcFails:['member_medicine_dose_report_for']}),{adapter,log}=telegram();
 assert.equal((await handleCardPress(rpc,adapter,press())).status,'failed');
 assert.match(log.acks[0]!,/could not save/);assert.deepEqual(state.done,['failed']);
 const bad=world(),t=telegram();
 assert.equal((await handleCardPress(bad.rpc,t.adapter,press({item:{medicineId:'not-a-uuid',dueAt:DUE}}))).status,'invalid');
 assert.equal(bad.state.writes,0);
 const other=world(),t2=telegram();
 assert.equal((await handleCardPress(other.rpc,t2.adapter,press({item:{medicineId:'00000000-0000-4000-8000-0000000000ff',dueAt:DUE}}))).status,'invalid','a dose not on the card');
 assert.equal(other.state.writes,0);
});

await scenario('show current: a fresh card under the press, once, in the same place as a card from the app',async()=>{
 const {rpc,state}=world(),{adapter,log}=telegram();
 const r=await handleCardPress(rpc,adapter,press({action:'show_current',item:{}}));
 assert.equal(r.status,'ok');
 const post=state.calls.find(c=>c.name==='zoe_chat_card_post')!;
 assert.equal(post.args.p_request,INBOX,'the press is the request, so a retry opens the same card');
 assert.equal(post.args.p_member,MEMBER);assert.equal(post.args.p_source,'chip');
 assert.equal(state.sent.length,1);assert.equal(state.sent[0].p_inbox,INBOX);
 assert.equal(log.edits.length,0,'the old card stays as it was shown');
 assert.deepEqual(log.acks,[undefined]);
});

await scenario('refused presses: one short line, nothing clinical, nothing else',async()=>{
 const cases:[string,RegExp][]=[['not_linked',/no longer connected/],['unknown',/no longer works/],['expired',/no longer works/],['binding_expired',/not available/],['not_eligible',/not available/],['disabled',/not available/]];
 for(const [code,line] of cases){
  const {adapter,log}=telegram();
  await answerRefusedPress(adapter,{code,callbackId:'cb_9',locale:'en'});
  assert.match(log.acks[0]!,line);assert.equal(log.edits.length,0);
 }
 assert.equal(processedSchema.safeParse({ok:true,press:{...press(),extra:1}}).success,false,'an unexpected field in the press is refused');
 assert.equal(processedSchema.safeParse({ok:true,press:{...press(),memberId:'someone'}}).success,false);
});

await scenario('dispatch: a card message never goes out without its buttons; any other message is untouched',async()=>{
 const {rpc}=world();
 const withCard:TelegramServiceRpc=async(n,a)=>n==='zoe_chat_card_for_message'?{card:stored(),memberId:MEMBER,endpointId:ENDPOINT,generation:3,locale:'en'}:rpc(n,a);
 const k=await cardKeyboard(withCard,INBOX);
 assert.ok(k&&k!=='failed'&&k.kind==='callback');
 assert.deepEqual(k.rows.map(r=>r.map(b=>b.label)),[['Mark as taken','Mark as missed'],['Refresh']]);
 assert.equal(await cardKeyboard(async()=>null,INBOX),null,'not a card');
 assert.equal(await cardKeyboard(async()=>{throw Error('down');},INBOX),'failed');
 const noRefs:TelegramServiceRpc=async n=>n==='zoe_chat_card_for_message'?{card:stored(),memberId:MEMBER,endpointId:ENDPOINT,generation:3,locale:'en'}:{ok:false,code:'no_route'};
 assert.equal(await cardKeyboard(noRefs,INBOX),'failed');
 const foreign:TelegramServiceRpc=async n=>n==='zoe_chat_card_for_message'?{card:stored({kind:'plan',snapshot:{v:1,available:true,plan:null}}),memberId:MEMBER,endpointId:ENDPOINT,generation:3,locale:'en'}:{ok:true,refs:[]};
 assert.equal(await cardKeyboard(foreign,INBOX),'failed','a kind that cannot render is not sent');
});

await scenario('typed: only the dose words, only from the cleared read, and the post re-checks it',async()=>{
 const {rpc,state}=world();
 const AT='2026-10-30T04:10:00.123456+00:00';
 const rows=[{memberId:MEMBER,seq:12,requestId:INBOX,text:'I took my pill, can you log it',locale:'en',at:AT,cleared:true},
  {memberId:MEMBER,seq:13,requestId:'00000000-0000-4000-8000-0000000000d3',text:'What is cholesterol?',locale:'en',at:AT,cleared:true},
  {memberId:MEMBER,seq:14,requestId:'00000000-0000-4000-8000-0000000000d4',text:'nothing to do here',locale:'en',at:AT,cleared:true}];
 assert.equal(await offerTelegramCards(async(n,a)=>n==='zoe_chat_card_telegram_candidates'?rows:rpc(n,a)),1,'one card: no words, no card; a kind not on Telegram yet, no card');
 const post=state.calls.find(c=>c.name==='zoe_chat_card_post')!;
 assert.equal(post.args.p_source,'typed');assert.equal(post.args.p_source_seq,12);assert.equal(post.args.p_request,INBOX);
 assert.equal(state.sent.length,1);
 assert.deepEqual(state.settled,[13,14],'looked at and settled, so they never use up the scan');
 assert.equal(await offerTelegramCards(async()=>{throw Error('down');}),0,'never blocks the sweep');
 // The card posted but its message failed to queue: not settled, so the next sweep finds the same card (MC-02).
 const lost=world({rpcFails:['zoe_chat_card_send']});
 const one=async(n:string,a:Record<string,unknown>)=>n==='zoe_chat_card_telegram_candidates'?rows.slice(0,1):lost.rpc(n,a);
 assert.equal(await offerTelegramCards(one),0);
 assert.deepEqual(lost.state.settled,[],'not settled');
 lost.state.calls.length=0;
 const refused:TelegramServiceRpc=async(n,a)=>n==='zoe_chat_card_telegram_candidates'?rows.slice(0,1):n==='zoe_chat_card_post'?{ok:false,code:'not_cleared'}:rpc(n,a);
 assert.equal(await offerTelegramCards(refused),0,'the database has the last word');
});

await scenario('the sweep: a press runs in the inbox pass, a refused one is answered, and an ordinary row is untouched',async()=>{
 const calls:string[]=[];
 const {rpc}=world();
 const http:TelegramHttpPort=async(url,init)=>{
  calls.push(url.slice(url.lastIndexOf('/')+1));const body=JSON.parse(init.body);
  return Response.json(url.endsWith('/answerCallbackQuery')?{ok:true,result:true}:{ok:true,result:{message_id:body.message_id??9,from:{id:100,is_bot:true},chat:{id:body.chat_id,type:'private'},text:body.text}});
 };
 const adapter=createTelegramAdapter({config:{account:'synthetic-cards',botId:100,enabled:true,botToken:'100:synthetic_opaque_bot_token_0123456789AB',timeoutMs:200,maxResponseBytes:262_144},http});
 const processed:Record<string,unknown>={i1:{ok:true,press:press()},i2:{ok:true,refused:{code:'unknown',callbackId:'cb_2',locale:'en'}},i3:{ok:true,status:'done',result:'received'}};
 const sweepRpc:TelegramServiceRpc=async(n,a)=>{
  if(n==='channel_inbox_next')return ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  if(n==='channel_inbox_process')return processed[`i${String(a.p_id).at(-1)}`];
  if(n==='telegram_dispatch_queue')return {system:[],replies:[]};
  if(n==='telegram_auth_message_queue')return [];
  if(n==='zoe_chat_card_telegram_candidates')return [];
  if(['delivery_reconcile_stale','zoe_held_ack_release','member_notice_reminders_run','bp_week_reminders_run','member_medicine_reminders_run','member_medicine_asks_run'].includes(n))return null;
  return rpc(n,a);
 };
 const report=await runTelegramSweep({rpc:sweepRpc,adapter,accountRef:'["synthetic-cards",100]',cards:telegramCards});
 assert.deepEqual(report.cards,{pressed:2,offered:0});
 assert.deepEqual(report.inbox,{processed:3,retry:0});
 assert.deepEqual(calls,['answerCallbackQuery','editMessageText','answerCallbackQuery']);
});

await scenario('plan doses: the same command, through the plan\'s own report, for the plan the card was shown for (M-01)',async()=>{
 const at=new Date('2026-10-30T05:00:00.000Z'),realNow=Date.now;
 Date.now=()=>at.getTime();const RealDate=Date;
 globalThis.Date=class extends RealDate{constructor(...a:[]){super(...(a.length?a:[at.getTime()]) as []);}static now(){return at.getTime();}} as DateConstructor;
 try{
  const card={snapshot:{v:1,enabled:true,date:'2026-10-30',slots:[planSlot]}},input=press({item:{medicineId:PLAN_MED,dueAt:DUE}});
  const a=world({card,plan:planRead()}),t=telegram();
  assert.equal((await handleCardPress(a.rpc,t.adapter,input)).status,'ok');
  assert.equal(a.state.planWrites,1);assert.equal(a.state.writes,0,'not the self-reported path');
  const call=a.state.calls.find(c=>c.name==='report_patient_dose_for')!;
  assert.deepEqual(call.args,{p_member:MEMBER,p_medication_id:PLAN_MED,p_due_at:DUE,p_status:'taken',p_expected_revision:0});
  // A new plan was published after the card: stale, and nothing is written.
  const b=world({card,plan:planRead('00000000-0000-4000-8000-0000000000b8')}),t2=telegram();
  assert.equal((await handleCardPress(b.rpc,t2.adapter,input)).status,'stale');assert.equal(b.state.planWrites,0);
  // Unreadable plan: not saved, and not reported as saved.
  const c=world({card,plan:null}),t3=telegram();
  assert.equal((await handleCardPress(c.rpc,t3.adapter,input)).status,'failed');assert.equal(c.state.planWrites,0);
  // A retry after the save that did not reach the card: the plan's record decides.
  const d=world({card,plan:planRead(PLAN,[{medicationId:PLAN_MED,dueAt:DUE,status:'taken',revision:1,recordedAt:DUE}]),planTick:{status:'conflict'}}),t4=telegram();
  assert.equal((await handleCardPress(d.rpc,t4.adapter,input)).status,'ok');
  const e=world({card,plan:planRead(PLAN,[{medicationId:PLAN_MED,dueAt:DUE,status:'skipped',revision:1,recordedAt:DUE}]),planTick:{status:'conflict'}}),t5=telegram();
  assert.equal((await handleCardPress(e.rpc,t5.adapter,input)).status,'stale');
 }finally{globalThis.Date=RealDate;Date.now=realNow;}
});

await scenario('plan doses: the card lists both lists in time order, from either channel, and a plan alone is enough',()=>{
 const now=new Date('2026-10-30T05:00:00.000Z');
 const plan=[{medication:{id:PLAN_MED,planId:PLAN,name:'Atorvastatin',dose:'',instructions:'',times:['08:00'],startDate:'2026-10-01',endDate:null,active:true},dueAt:DUE,revision:2,status:'taken' as const}];
 const off=doseSnapshotFrom({version:'member-medicines-v1',enabled:false},plan,now);
 assert.equal(off.enabled,true,'the plan does not depend on the self-reported switch');
 assert.deepEqual(off.slots,[{medicineId:PLAN_MED,name:'Atorvastatin',dose:null,dueAt:DUE,time:'08:00',status:'taken',revision:2,planId:PLAN}]);
 assert.equal(doseSnapshotFrom({version:'member-medicines-v1',enabled:false},[],now).enabled,false);
 const upcoming=cardSchema.parse(stored({snapshot:{v:1,enabled:true,date:'2026-10-30',slots:[{...planSlot,status:'upcoming',time:'21:00',dueAt:LATER}]}}));
 assert.match(telegramCardView(upcoming,'en')!.text,/You can log it from 21:00/,'a plan dose opens at its time, not an hour before');
});

await scenario('a failed read of either list opens no card; a list that is really off does (Astra M01-R1)',async()=>{
 const planDose={offset:0,plan:{...planRead().plan,publishedAt:'2020-01-01T00:00:00+00:00',medications:[{...planRead().plan.medications[0],startDate:'2020-01-01',times:['00:00']}]},events:[]};
 const snapshot=(rpc:TelegramServiceRpc)=>telegramPorts(rpc,mintActor(MEMBER,'telegram')).snapshot('dose');
 const plans=(own:()=>unknown):TelegramServiceRpc=>async n=>{if(n==='member_plan_doses_read_for')return planDose;if(n==='member_medicines_read_for')return own();throw Error(n);};
 await assert.rejects(snapshot(plans(()=>{throw Error('down');})),'a rejected read of the member\'s own medicines');
 await assert.rejects(snapshot(plans(()=>({version:'member-medicines-v1',enabled:true,medicines:'broken'}))),'a malformed one');
 await assert.rejects(snapshot(plans(()=>null)),'an empty answer');
 const off=await snapshot(plans(()=>({version:'member-medicines-v1',enabled:false}))) as {enabled:boolean;slots:{planId?:string}[]};
 assert.equal(off.enabled,true,'really off: the plan still shows');
 assert.equal(off.slots.length,1);assert.equal(off.slots[0].planId,PLAN);
 await assert.rejects(snapshot(async n=>{if(n==='member_medicines_read_for')return {version:'member-medicines-v1',enabled:false};throw Error('down');}),'a failed plan read');
 const server=code('lib/zoe-chat-actions/server.ts');
 assert.match(server,/doseSnapshotFrom\(await loadMemberMedicines\(\),/,'the app card uses the read that throws');
 assert.ok(!/readMemberMedicines/.test(server),'and not the one that reads an outage as off');
 assert.match(code('lib/member-medicines/server.ts'),/export async function readMemberMedicines[\s\S]*?catch \{\n    return OFF;/,'Home keeps its fallback');
});

await scenario('the menu: /menu lists the tasks, each button opens its card through the same command, and the button names only a known kind',async()=>{
 const {rpc,state}=world();
 const m={inboxId:INBOX,memberId:MEMBER,locale:'en' as const};
 assert.equal((await openMenu(rpc,m)).status,'ok');
 assert.equal(state.calls.find(c=>c.name==='zoe_chat_card_post')?.args.p_kind,'menu');
 assert.equal(state.calls.find(c=>c.name==='zoe_chat_card_post')?.args.p_source,'chip','it carries no member text');
 assert.equal(state.sent.length,1);assert.deepEqual(state.done,['ok']);
 const view=telegramCardView(card({kind:'menu',snapshot:{v:1}}),'en')!;
 assert.deepEqual(view.rows.flat().map(b=>[b.label,b.action,b.item]),[['Log today’s medicine','open_card',{kind:'dose'}],['Record blood pressure','open_card',{kind:'bp'}],['My latest results','open_card',{kind:'results'}],['My plan','open_card',{kind:'plan'}],['My LDL goal','open_card',{kind:'ldl'}],['My visit','open_card',{kind:'visit'}],['Report a side effect','open_card',{kind:'side_effect'}],['Message my care team','open_card',{kind:'message'}]]);
 const open=world(),t=telegram();
 const r=await handleCardPress(open.rpc,t.adapter,press({action:'open_card',item:{kind:'bp'}}));
 assert.equal(r.status,'ok');
 assert.equal(open.state.calls.find(c=>c.name==='zoe_chat_card_post')?.args.p_kind,'bp');
 assert.equal(open.state.calls.find(c=>c.name==='zoe_chat_card_post')?.args.p_request,INBOX,'a redelivered press opens the same card');
 assert.equal(open.state.sent.length,1);assert.equal(t.log.edits.length,0,'the menu stays as it is');
 for(const item of [{kind:'menu'},{kind:'nonsense'},{kind:'bp',extra:1},{}]){
  const bad=world();
  assert.equal((await handleCardPress(bad.rpc,telegram().adapter,press({action:'open_card',item}))).status,'invalid',JSON.stringify(item));
  assert.equal(bad.state.calls.filter(c=>c.name==='zoe_chat_card_post').length,0);
 }
 // An outage leaves the row to come back (Astra MC-ENTRY-01): one message once the card and its queue are reachable again.
 for(const fails of ['zoe_chat_card_post','zoe_chat_card_send']){
  const fails_=[fails],down=world({rpcFails:fails_});
  assert.equal((await openMenu(down.rpc,m)).status,'unavailable',fails);
  assert.deepEqual(down.state.done,[],'the row stays leased');assert.equal(down.state.sent.length,0);
  fails_.length=0;
  assert.equal((await openMenu(down.rpc,m)).status,'ok');
  assert.deepEqual(down.state.done,['ok']);assert.equal(down.state.sent.length,1,'one menu');
 }
 const limited=world();
 const refusedPost:TelegramServiceRpc=async(n,a)=>n==='zoe_chat_card_post'?{ok:false,code:'rate_limited'}:limited.rpc(n,a);
 assert.equal((await openMenu(refusedPost,m)).status,'rate_limited');assert.deepEqual(limited.state.done,['rate_limited'],'a refusal ends the row');
 assert.equal(processedSchema.safeParse({ok:true,menu:{...m,memberId:'not-a-uuid'}}).success,false);
});

await scenario('the plan on Telegram: the doctor\'s words, the medicines, read only, and a long plan never reads as complete',async()=>{
 const base={id:PLAN,clinician:'Fictional doctor',publishedAt:'2026-10-01T08:00:00+00:00',instructions:'Walk daily.',version:2,medicines:[{name:'Atorvastatin',dose:'40 mg',times:['21:00']}],review:null};
 const {rpc,state}=world({planCard:{plan:base}});
 assert.equal((await handleCardPress(rpc,telegram().adapter,press({action:'open_card',item:{kind:'plan'}}))).status,'ok');
 const snap=state.calls.find(c=>c.name==='zoe_chat_card_post')!.args.p_snapshot;
 const v=telegramCardView(card({kind:'plan',snapshot:snap}),'en')!;
 assert.equal(v.text,'Zoe: Your plan\nAs shown at 30.10.2026, 08:05\n\nApproved by Fictional doctor, 01.10.2026. Version 2\n\nWalk daily.\n\nMedicines\nAtorvastatin, 40 mg, 21:00\n\nOnly your doctor changes your plan.');
 assert.deepEqual(v.rows.flat().map(b=>b.action),['show_current'],'nothing here writes');
 const long=telegramCardView(card({kind:'plan',snapshot:{v:1,available:true,plan:{id:PLAN,clinician:base.clinician,publishedAt:base.publishedAt,version:2,instructions:'Բառ '.repeat(990).trim(),medicines:Array.from({length:20},()=>({name:'M'.repeat(40),dose:'5 mg',times:['08:00','20:00']}))}}}),'hy')!;
 assert.ok(long.text.length<=4096);assert.match(long.text,/հավելվածում է/);assert.match(long.text,/MMMM, 5 mg/,'the medicines stay');
 assert.match(telegramCardView(card({kind:'plan',snapshot:{v:1,available:true,plan:null}}),'en')!.text,/do not have a published plan/);
 const down=world({rpcFails:['member_plan_read_for']});
 assert.equal((await handleCardPress(down.rpc,telegram().adapter,press({action:'open_card',item:{kind:'plan'}}))).status,'unavailable');
});

const EVIDENCE={visits:[],profile:{name:'Synthetic',birthDate:'1974-01-01',biologicalSex:'male'},consent:{version:'patient-pilot-v1'},assessment:{revision:1,assessment_date:'2026-10-12',answers:{},completed_at:'2026-10-12T00:00:00Z',urgent_rule:null},measurements:[],reports:[]};
await scenario('why a dose was missed on Telegram: the ask comes as a card after the press, each reason once, and the dose stands either way',async()=>{
 const ASK='00000000-0000-4000-8000-0000000000f5';
 const ask={id:ASK,source:'self',medicineId:MED,dueAt:DUE,trigger:'skipped',state:'open',reason:null,createdAt:DUE,answeredAt:null,medicine:{name:'Amlodipine',dose:'5 mg'},careTeamAsked:false};
 const asks={version:'medicine-asks-v1',enabled:true,asks:[ask]};
 const {rpc,state}=world({asks});
 const r=await handleCardPress(rpc,telegram().adapter,press({action:'dose_skipped'}));
 assert.equal(r.status,'ok');assert.equal(state.writes,1);
 const posted=state.calls.filter(c=>c.name==='zoe_chat_card_post').find(c=>c.args.p_kind==='ask')!;
 assert.equal(posted.args.p_request,ASK,'the ask is the request: a replay finds the same card');assert.equal(state.sent.length,1);
 assert.equal(state.sent[0]!.p_inbox,INBOX,'its message hangs on the press');
 const view=telegramCardView(card({kind:'ask',snapshot:posted.args.p_snapshot}),'en')!;
 assert.match(view.text,/You marked Amlodipine at .* as skipped\./);assert.match(view.text,/what got in the way/);
 assert.deepEqual(view.rows.flat().map(b=>b.item.reason),['forgot','side_effect','cost_or_availability','ran_out','decided_to_stop']);
 assert.ok(view.rows.flat().every(b=>b.action==='ask_reason'),'and no "show current"');
 assert.equal((await handleCardPress(world({asks,tick:{status:'saved',revision:1}}).rpc,telegram().adapter,press({action:'dose_taken'}))).ask,undefined,'taken asks nothing');
 // The ask read or post failing leaves the dose saved.
 const down=world({asks,rpcFails:['zoe_chat_card_send']});
 assert.equal((await handleCardPress(down.rpc,telegram().adapter,press({action:'dose_skipped'}))).status,'ok');assert.equal(down.state.writes,1);
 const a=world({card:{kind:'ask',snapshot:{v:1,askId:ASK,name:'Amlodipine',dueAt:DUE,trigger:'skipped'}}}),t=telegram();
 const answer=press({action:'ask_reason',item:{reason:'side_effect'}});
 assert.equal((await handleCardPress(a.rpc,t.adapter,answer)).status,'ok');
 assert.equal((await handleCardPress(a.rpc,t.adapter,{...answer,callbackId:'cb_2'})).status,'ok');
 assert.equal(a.state.answers.length,1,'one answer');assert.deepEqual([a.state.answers[0]!.p_member,a.state.answers[0]!.p_ask,a.state.answers[0]!.p_reason],[MEMBER,ASK,'side_effect']);
 assert.match(t.log.edits[0]!.text as string,/passed this to your doctor/);assert.deepEqual((t.log.edits[0] as {keyboard:{rows:unknown[][]}}).keyboard.rows.flat(),[]);
 assert.equal((await handleCardPress(a.rpc,telegram().adapter,press({action:'ask_reason',item:{reason:'forgot'}}))).status,'stale','the other answer changes nothing');
 assert.equal((await handleCardPress(a.rpc,telegram().adapter,press({action:'ask_reason',item:{reason:'nonsense'}}))).status,'invalid');
 const closed=world({card:{kind:'ask',snapshot:{v:1,askId:ASK,name:'Amlodipine',dueAt:DUE,trigger:'missed'}},answer:{status:'closed'}});
 assert.equal((await handleCardPress(closed.rpc,telegram().adapter,answer)).status,'closed');
});

const sentText:unknown[]=[];
await scenario('a notice opens its task in the chat: one button, the same notice, and any doubt keeps the link',async()=>{
 const NOTE='00000000-0000-4000-8000-0000000000f6',ASK='00000000-0000-4000-8000-0000000000f7';
 const read=(over:Record<string,unknown>={})=>({memberId:MEMBER,endpointId:ENDPOINT,generation:3,kind:'results',key:'results.received:x',locale:'en',...over});
 const withNotice=(r:TelegramServiceRpc,answer:unknown):TelegramServiceRpc=>async(n,a)=>n==='zoe_chat_card_notice'?answer:r(n,a);
 const {rpc,state}=world();
 const k=await noticeKeyboard(withNotice(rpc,read()),NOTE,'Your results have arrived.');
 assert.deepEqual(k?.rows,[[{label:'My latest results',ref:'reference_00000000'}]]);
 const post=state.calls.find(c=>c.name==='zoe_chat_card_post')!;
 assert.equal(post.args.p_request,NOTE,'the message is the request: a retry finds the same card');assert.equal(post.args.p_source,'chip');
 assert.deepEqual(post.args.p_snapshot,{v:1,line:'Your results have arrived.',kinds:['results']});
 assert.deepEqual((state.calls.find(c=>c.name==='zoe_chat_card_arm')!.args.p_buttons as {action:string;item:unknown}[]),[{action:'open_card',item:{kind:'results'}}]);
 assert.equal(state.sent.length,0,'the notice is the message; nothing else is queued');
 assert.equal(await noticeKeyboard(withNotice(rpc,null),NOTE,'x'),null,'no card for this notice: the link goes');
 assert.equal(await noticeKeyboard(async()=>{throw Error('down');},NOTE,'x'),null);
 const noRoute=world({noRoute:true});
 assert.equal(await noticeKeyboard(withNotice(noRoute.rpc,read()),NOTE,'x'),null,'a link that has gone keeps the plain notice');
 assert.equal(await noticeKeyboard(withNotice(async()=>{throw Error('down');},read()),NOTE,'x'),null);
 // An ask's button names that ask; if it has closed the press says so, and an outage does nothing.
 const ask={id:ASK,source:'self',medicineId:MED,dueAt:DUE,trigger:'missed',state:'open',reason:null,createdAt:DUE,answeredAt:null,medicine:{name:'Amlodipine',dose:null},careTeamAsked:false};
 const a=world({openAsk:ask});
 const asked=await noticeKeyboard(withNotice(a.rpc,read({kind:'ask',key:`medicine_ask:${ASK}`})),NOTE,'x');
 assert.equal(asked?.rows[0]![0]!.label,'Answer Zoe');
 assert.deepEqual((a.state.calls.find(c=>c.name==='zoe_chat_card_arm')!.args.p_buttons as {item:unknown}[])[0]!.item,{kind:'ask',ask:ASK});
 assert.equal((await handleCardPress(a.rpc,telegram().adapter,press({action:'open_card',item:{kind:'ask',ask:ASK}}))).status,'ok');
 assert.equal(a.state.calls.filter(c=>c.name==='zoe_chat_card_post').at(-1)!.args.p_request,ASK);
 const shut=world();
 assert.equal((await handleCardPress(shut.rpc,telegram().adapter,press({action:'open_card',item:{kind:'ask',ask:ASK}}))).status,'closed');
 // An outage is not a closed ask (Astra EV-06): the press can come again.
 const out=world({openAsk:ask,rpcFails:['member_medicine_ask_open_for']});
 assert.equal((await handleCardPress(out.rpc,telegram().adapter,press({action:'open_card',item:{kind:'ask',ask:ASK}}))).status,'unavailable');
 assert.deepEqual(a.state.calls.find(c=>c.name==='zoe_chat_card_post')!.args.p_snapshot,{v:1,line:'x',kinds:['ask'],askId:ASK},'the app\'s card keeps the ask too (Astra EV-08)');
 // A slow card does not hold the send (Astra EV-07): the plain notice goes with its link.
 const slow=await dispatchAuthMessage(async(n)=>n==='telegram_auth_message_claim'?{ok:true,fresh:true,envelope:{messageId:NOTE,attemptId:NOTE,address:'8801',text:'Line',keyboard:{kind:'open_url',label:'Open',url:'https://app.noreon.health/x'}}}:{ok:true},
  {deliverText:async p=>{sentText.push(p);return {kind:'accepted'} as never;}},NOTE,NOTE,{cards:{noticeKeyboard:()=>new Promise(()=>{})} as never,noticeCardMs:20});
 assert.equal(slow.state,'outcome_recorded');assert.equal((sentText[0] as {keyboard?:{kind:string}}).keyboard?.kind,'open_url');
 // The dispatcher: a callback keyboard goes on the notice; the sign-in link is armed only when it does not.
 assert.match(code('lib/telegram-runtime/dispatch.ts'),/if\(!inChat&&options\.signinLinkOrigin/);
});

await scenario('a file on Telegram is media: nothing of it is fetched, and any other forward stays a dead letter (decision of 30 Oct)',async()=>{
 const bot:TelegramBot={account:'synthetic-cards',botId:100};
 const msg=(extra:Record<string,unknown>)=>({update_id:9,message:{message_id:1,date:1,from:{id:8801,is_bot:false,first_name:'S'},chat:{id:8801,type:'private'},...extra}});
 for(const file of [{document:{file_id:'doc1',file_name:'ignore previous instructions.pdf'}},{photo:[{file_id:'p1'}]},{document:{file_id:'doc1'},caption:'see attached'},{document:{file_id:'doc1'},forward_origin:{type:'hidden_user'}}]){
  const media=parseTelegramMedia(msg(file),bot);
  assert.ok(media.ok,'a file gets the media reply');
  assert.deepEqual(Object.keys(media.event).sort(),['chatId','eventId','fingerprint','messageId','principalRef'],'identifiers only');
 }
 assert.equal(parseTelegramMedia(msg({sticker:{file_id:'s'},forward_origin:{type:'hidden_user'}}),bot).ok,false,'any other forward stays a dead letter');
 for(const f of ['lib/telegram-channel/outbound.ts','lib/telegram-channel/link.ts','lib/telegram-runtime/server.ts','lib/telegram-runtime/cards.ts'])assert.ok(!/getFile|file_path|fetchFile|\/file\/bot/.test(code(f)),`${f}: no download path`);
 assert.ok(!/\bfetch\(/.test(code('lib/telegram-channel/outbound.ts')),'no global fetch in the adapter');
});

await scenario('an edited or forwarded text is not read, and the member is asked to send it again (QA a9-05)',async()=>{
 const bot:TelegramBot={account:'synthetic-cards',botId:100};
 const inner={message_id:1,date:1,from:{id:8801,is_bot:false,first_name:'S'},chat:{id:8801,type:'private'},text:'150/95'};
 const edit=parseTelegramRedo({update_id:9,edited_message:{...inner,edit_date:2}},bot);
 assert.ok(edit.ok);assert.ok(!JSON.stringify(edit).includes('150/95'),'the words are not kept');
 assert.ok(parseTelegramRedo({update_id:9,message:{...inner,forward_origin:{type:'hidden_user'}}},bot).ok);
 assert.equal(parseTelegramRedo({update_id:9,message:inner},bot).ok,false,'an ordinary message is not this');
 assert.equal(parseTelegramRedo({update_id:9,edited_message:{...inner,chat:{id:5,type:'group'}}},bot).ok,false);
 const {rpc,state}=world();
 await handleRedo(rpc,{inboxId:INBOX,memberId:MEMBER,locale:'en'});
 assert.match(String(state.sent[0]!.p_body),/do not read edited or forwarded messages/);assert.deepEqual(state.done,['asked_again']);
 const down=world({rpcFails:['zoe_chat_card_send']});
 await handleRedo(down.rpc,{inboxId:INBOX,memberId:MEMBER,locale:'en'});assert.deepEqual(down.state.done,[],'an outage comes back');
});

await scenario('a side effect on Telegram goes in as the member\'s own message, once, through the inbox (Zoe reads it first)',async()=>{
 const base=world({card:{kind:'side_effect',snapshot:{v:1}}});
 const texts:Record<string,unknown>[]=[];
 const rpc:TelegramServiceRpc=async(n,a)=>{if(n==='channel_inbox_card_text'){texts.push(a);return {ok:true};}return base.rpc(n,a);};
 const v=telegramCardView(card({kind:'side_effect',snapshot:{v:1}}),'en')!;
 assert.deepEqual(v.rows.flat().map(b=>b.item.what),['ankle_swelling','dizziness','nausea','dry_cough','muscle_aches','headache','frequent_urination','other']);
 assert.ok(v.rows.flat().length<=8,'within the eight a card may arm');
 const t=telegram(),p=press({action:'side_effect_pick',item:{what:'dizziness'}});
 assert.equal((await handleCardPress(rpc,t.adapter,p)).status,'ok');
 assert.equal((await handleCardPress(rpc,t.adapter,{...p,callbackId:'cb_2'})).status,'ok');
 assert.equal(texts.length,1,'once');assert.equal(texts[0]!.p_text,'Side effect: Dizziness');
 assert.match(t.log.edits[0]!.text as string,/Dizziness\. Sent\./);
 const other=world({card:{kind:'side_effect',snapshot:{v:1}}}),ot=telegram();
 assert.equal((await handleCardPress(other.rpc,ot.adapter,press({action:'side_effect_pick',item:{what:'other'}}))).status,'ok');
 assert.deepEqual(ot.log.acks,[undefined],'it does not say sent');
 assert.match(String(other.state.sent[0]!.p_body),/Write here what you are noticing/);assert.equal(Object.keys(other.state.outcome).length,0,'nothing sent until the member writes');
 assert.equal((await handleCardPress(other.rpc,telegram().adapter,press({action:'side_effect_pick',item:{what:'nonsense'}}))).status,'invalid');
 // The app's own screening of these labels stays: no choice alone opens the 103 screen (scripts/check-zoe-chat-actions.ts).
});

await scenario('visits on Telegram: the next visit and a proposed time from the snapshot, one press through the booking rules, once',async()=>{
 const APPT='00000000-0000-4000-8000-0000000000f2',PROPOSAL='00000000-0000-4000-8000-0000000000f3';
 const snap={v:1,available:true,next:{appointmentId:APPT,revision:2,status:'confirmed',startsAt:'2026-11-05T06:00:00+00:00',endsAt:'2026-11-05T07:00:00+00:00',mode:'clinic',location:'Fictional Clinic'},
  proposal:{appointmentId:APPT,proposalId:PROPOSAL,startsAt:'2026-11-06T06:00:00+00:00',endsAt:'2026-11-06T07:00:00+00:00',clinicName:'Fictional Clinic',clinicAddress:'1 Fictional Street'},attention:false};
 const v=telegramCardView(card({kind:'visit',snapshot:snap}),'en')!;
 assert.match(v.text,/05\.11\.2026, 10:00\nAt the clinic\. Fictional Clinic\nConfirmed/);assert.match(v.text,/The clinic proposed a new time: 06\.11\.2026, 10:00, Fictional Clinic/);
 assert.match(v.text,/To book or change a visit, use the Noreon app\./);assert.ok(!/https?:|\/patient\//.test(v.text),'no link');
 assert.deepEqual(v.rows.flat().map(b=>b.action),['visit_accept','show_current']);
 process.env.NOREON_REAL_MEMBER_REVIEW_ENABLED??='';
 const empty=telegramCardView(card({kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false}}),'en')!;
 assert.match(empty.text,/You have no upcoming visit/);
 assert.match(telegramCardView(card({kind:'visit',snapshot:{v:1,available:false,next:null,proposal:null,attention:false}}),'en')!.text,/not available right now/);
 const done=telegramCardView(card({kind:'visit',snapshot:snap,state:'done',outcome:{accepted:{proposalId:PROPOSAL}}}),'en')!;
 assert.match(done.text,/Accepted\. Show current/);assert.deepEqual(done.rows.flat().map(b=>b.action),['show_current']);
 // A portal that is off refuses: the press changes nothing.
 const off=world({card:{kind:'visit',snapshot:snap}});
 assert.equal((await handleCardPress(off.rpc,telegram().adapter,press({action:'visit_accept',item:{}}))).status,'unavailable');
 assert.equal(off.state.bookings.length,0);assert.equal(Object.keys(off.state.outcome).length,0);
 const none=world({card:{kind:'visit',snapshot:{...snap,proposal:null}}});
 assert.equal((await handleCardPress(none.rpc,telegram().adapter,press({action:'visit_accept',item:{}}))).status,'invalid');
});

await scenario('an LDL re-test visit on Telegram: the booking command, with the LDL eligibility checked now, once, and a hold accepts nothing',async()=>{
 const proposal={provider:'Fictional nurse',startsAt:'2026-12-01T08:00:00+00:00',endsAt:'2026-12-01T09:00:00+00:00',preparation:'Fast overnight.'};
 const request={id:'00000000-0000-4000-8000-0000000000f4',revision:3,status:'provider-proposed',algorithmVersion:'ldl-retest-v1',proposal,arrangement:null};
 const data={version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],retest:{id:CARD,dueFrom:'2026-12-01',dueTo:'2026-12-15',state:'requested',overdue:false,request},withDoctor:null};
 const snapshot={v:1,data},v=telegramCardView(card({kind:'ldl',snapshot}),'en')!;
 assert.deepEqual(v.rows.flat().map(b=>[b.label,b.action]),[['Accept this visit','ldl_visit_accept'],['Refresh','show_current']]);
 const saved={...process.env};
 Object.assign(process.env,{NOREON_REAL_TEST_REQUESTS_ENABLED:'true',SUPABASE_SERVICE_ROLE_KEY:'local',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local'});
 const evidence=EVIDENCE as Record<string,unknown>;
 const accept=press({action:'ldl_visit_accept',item:{}});
 const ok=world({card:{kind:'ldl',snapshot},ldlEvidence:evidence}),t=telegram();
 assert.equal((await handleCardPress(ok.rpc,t.adapter,accept)).status,'ok');
 assert.equal((await handleCardPress(ok.rpc,t.adapter,{...accept,callbackId:'cb_2'})).status,'ok');
 const commands=ok.state.bookings.filter(b=>b.p_operation==='accept');
 assert.equal(commands.length,1,'one command');
 assert.deepEqual([commands[0]!.p_user_id,commands[0]!.p_actor,commands[0]!.p_staff,commands[0]!.p_id,commands[0]!.p_revision],[MEMBER,MEMBER,false,request.id,3]);
 assert.deepEqual(t.log.acks,['Saved.','Saved.']);assert.match(t.log.edits[0]!.text as string,/Accepted\. We saved your answer\./);
 // The LDL eligibility is checked now: no consent, an urgent rule or a crisis-range reading accepts nothing.
 for(const held of [{...evidence,consent:null},{...evidence,assessment:{...(evidence.assessment as object),urgent_rule:'RF-01'}}]){
  const hold=world({card:{kind:'ldl',snapshot},ldlEvidence:held});
  const r=await handleCardPress(hold.rpc,telegram().adapter,accept);
  assert.equal(r.status,'stale',JSON.stringify(held).slice(0,40));
  assert.equal(hold.state.bookings.filter(b=>b.p_operation==='accept').length,0);
 }
 const moved=world({card:{kind:'ldl',snapshot},ldlEvidence:evidence,bookingFails:'40001'});
 assert.equal((await handleCardPress(moved.rpc,telegram().adapter,accept)).status,'stale');
 const none=world({card:{kind:'ldl',snapshot:{v:1,data:{...data,retest:null}}}});
 assert.equal((await handleCardPress(none.rpc,telegram().adapter,accept)).status,'invalid');
 process.env=saved;
});

await scenario('the LDL goal on Telegram: the status from lib/ldl/status.ts, a result with the doctor, the re-test window, and no value before a doctor released one',async()=>{
 const goal={version:1,category:'very_high',thresholdMmol:1.4,reductionRule:true,reductionPct:50,baseline:{kind:'pre_treatment',mmol:4,on:'2026-06-01',source:'document'},nextTestOn:null,setAt:'2026-09-01T08:00:00+00:00',doctorName:'Fictional doctor'};
 const base={version:'ldl-member-v1',enabled:true,inPathway:true,goal,observations:[{id:'cr:1',value:2.1,unit:'mmol/L',on:'2026-10-20',source:'clinic_result',name:'LDL',memberVisible:true}],retest:null,withDoctor:null};
 const open=async(ldl:unknown)=>{const {rpc,state}=world({ldl});const r=await handleCardPress(rpc,telegram().adapter,press({action:'open_card',item:{kind:'ldl'}}));
  return {r,view:r.status==='ok'?telegramCardView(card({kind:'ldl',snapshot:state.calls.find(c=>c.name==='zoe_chat_card_post')!.args.p_snapshot}),'en'):null};};
 const above=await open(base);
 assert.equal(above.r.status,'ok','the snapshot parses');
 assert.match(above.view!.text,/Your goal: below 1\.4 mmol\/L\nand at least 50% lower than before treatment/);
 assert.match(above.view!.text,/2\.1 mmol\/L, Latest result, 20\.10\.2026\nAbove your goal\./);
 assert.match(above.view!.text,/48% lower than before treatment/);
 const at=await open({...base,observations:[{...base.observations[0],value:1.2}]});
 assert.match(at.view!.text,/Below your goal\./);
 const typedOnly=await open({...base,observations:[{...base.observations[0],source:'member'}]});
 assert.match(typedOnly.view!.text,/No result to compare yet/);assert.doesNotMatch(typedOnly.view!.text,/2\.1/,'a typed value does not count');
 const withDoctor=await open({...base,observations:[],withDoctor:{since:'2026-10-29T08:00:00+00:00',doctorName:null}});
 assert.match(withDoctor.view!.text,/With your doctor\. Your new cholesterol result is with your doctor/);
 const retest={id:CARD,dueFrom:'2026-12-01',dueTo:'2026-12-15',state:'scheduled',overdue:false,request:null};
 assert.match((await open({...base,retest})).view!.text,/Next LDL test: between 01\.12\.2026 and 15\.12\.2026/);
 assert.match((await open({...base,retest:{...retest,overdue:true}})).view!.text,/Blood test due\./);
 assert.match((await open({...base,goal:null,observations:[]})).view!.text,/Your doctor is setting your goal/);
 assert.match((await open({version:'ldl-member-v1',enabled:true,inPathway:false})).view!.text,/has not started/);
 assert.deepEqual(above.view!.rows.flat().map(b=>b.action),['show_current']);
 assert.ok(!/https?:|\/patient\//.test(above.view!.text),'no link');
 // Explicit tasks keep their card when they name LDL (Astra LDL-01), and a goal question stays with the goal.
 for(const [text,kind] of [['I want to report side effects from my LDL medicine','side_effect'],['log my LDL medicine dose','dose'],['message my doctor about LDL','message'],['am I at goal','ldl'],['what is my LDL goal','ldl'],['իմ ցխլ նպատակը','ldl'],['моя цель по лпнп','ldl']] as const)assert.equal(cardIntent(text),kind,text);
 // A booking's longest preparation still fits one message, in every language, and says it stopped (Astra LDL-02).
 for(const l of ['hy','en','ru'] as const){
  const preparation=({hy:'Պատրաստվեք ',en:'Prepare ',ru:'Подготовьтесь '}[l]).repeat(880);
  const when={startsAt:'2026-12-01T08:00:00+00:00',endsAt:'2026-12-01T09:00:00+00:00',provider:'Fictional nurse',preparation};
  for(const request of [{id:CARD,revision:1,status:'provider-proposed',algorithmVersion:'ldl-retest-v1',proposal:when,arrangement:null},{id:CARD,revision:1,status:'confirmed',algorithmVersion:'ldl-retest-v1',proposal:null,arrangement:when}]){
   const v=telegramCardView(card({kind:'ldl',snapshot:{v:1,data:{...base,retest:{...retest,request}}}}),l)!;
   assert.ok(v.text.length<=4096,`${l} ${v.text.length}`);
   assert.ok(v.text.includes(say(l,LDL.prepInApp)));
  }
 }
 const down=world({rpcFails:['member_ldl_read_for']});
 assert.equal((await handleCardPress(down.rpc,telegram().adapter,press({action:'open_card',item:{kind:'ldl'}}))).status,'unavailable');
});

await scenario('an ended course: the app and Telegram give the same answer (test gap 6)',()=>{
 assert.match(read('lib/zoe-chat-actions/server.ts'),/m\.active!==false&&\(!m\.endDate\|\|m\.endDate>=/,'the app filters on the end date');
 assert.match(read('supabase/migrations/20261030180500_zoe_chat_cards_plan_in_force.sql'),/m\.end_date is null or m\.end_date>=\(clock_timestamp\(\)at time zone 'Asia\/Yerevan'\)::date/,'and the service read on the same date');
});

await scenario('results on Telegram: the page\'s rows, LDL first, twelve at a time, more in the chat, no link',async()=>{
 const rows=Array.from({length:30},(_,i)=>({marker:i===25?'LDL cholesterol':`Marker ${i}`,value:i,unit:'mmol/L',referenceText:i===25?'below 1.4':null,collectedAt:`2026-10-${String(29-(i%28)).padStart(2,'0')}T08:00:00+00:00`}));
 const {rpc,state}=world({results:{publication:null,results:rows}});
 const post=()=>state.calls.filter(c=>c.name==='zoe_chat_card_post').at(-1)!.args.p_snapshot as {rows:{name:string}[];more:number;page?:number};
 assert.equal((await handleCardPress(rpc,telegram().adapter,press({action:'open_card',item:{kind:'results'}}))).status,'ok');
 assert.equal(post().rows[0]!.name,'LDL cholesterol','LDL never falls off the first card');
 assert.equal(post().rows.length,12);assert.equal(post().more,18);
 const view=telegramCardView(card({kind:'results',snapshot:post()}),'en')!;
 assert.match(view.text,/LDL cholesterol: 25 mmol\/L \(Reference: below 1\.4\)/);
 assert.ok(!/https?:|\/patient\//.test(view.text),'no link');
 assert.deepEqual(view.rows[0]!.map(b=>[b.label,b.action,b.item]),[['Show 18 more','open_card',{kind:'results',page:1}]]);
 assert.equal((await handleCardPress(rpc,telegram().adapter,press({action:'open_card',item:{kind:'results',page:2}}))).status,'ok');
 assert.equal(post().rows.length,6);assert.equal(post().more,0);assert.equal(post().page,2);
 assert.equal((await handleCardPress(rpc,telegram().adapter,press({action:'open_card',item:{kind:'bp',page:2}}))).status,'invalid');
 // A failed read opens no card; none yet says so; a long card fits one message.
 const down=world({rpcFails:['member_results_read_for']});
 assert.equal((await handleCardPress(down.rpc,telegram().adapter,press({action:'open_card',item:{kind:'results'}}))).status,'unavailable');
 assert.equal(down.state.calls.filter(c=>c.name==='zoe_chat_card_post').length,0);
 assert.match(telegramCardView(card({kind:'results',snapshot:{v:1,available:true,publishedAt:null,rows:[],more:0}}),'en')!.text,/No doctor-approved results/);
 const long=Array.from({length:12},()=>({name:'N'.repeat(160),value:'V'.repeat(200),unit:'U'.repeat(60),reference:'R'.repeat(160),at:'2026-10-01T08:00:00+00:00'}));
 const cut=telegramCardView(card({kind:'results',snapshot:{v:1,available:true,publishedAt:null,rows:long,more:0}}),'en')!;
 assert.ok(cut.text.length<=4096);
 assert.ok(cut.text.includes('V'.repeat(200))&&cut.text.includes('R'.repeat(160)),'a shown row keeps its exact value and reference (Astra R1)');
 assert.match(cut.text,/\d+ more lines of this card are in the app\./);
 // The end of "more" (Astra R2): every reachable page is accepted, and the rest is counted, not dropped.
 for(const [total,last,more,older] of [[240,19,0,undefined],[241,19,0,1],[300,19,0,60]] as const){
  const page=resultsSnapshotFrom(null,Array.from({length:total},(_,i)=>({marker:`M${i}`,value:i,unit:null,referenceText:null,collectedAt:'2026-10-01T08:00:00+00:00'})),last);
  assert.deepEqual([page.more,page.older],[more,older],String(total));
  assert.ok(cardSchema.parse(stored({kind:'results',snapshot:page})).valid);
  assert.equal(telegramCardView(card({kind:'results',snapshot:page}),'en')!.rows.flat().filter(b=>b.action==='open_card').length,0);
 }
 assert.deepEqual(telegramCardView(card({kind:'results',snapshot:resultsSnapshotFrom(null,Array.from({length:240},(_,i)=>({marker:`M${i}`,value:i,unit:null,referenceText:null,collectedAt:'2026-10-01T08:00:00+00:00'})),18)}),'en')!.rows[0]![0]!.item,{kind:'results',page:19});
});

const TYPED={systolic:150,diastolic:95,pulse:70,measuredAt:'2026-10-30T04:10:00+00:00'};
const bpCard=(snapshot:Record<string,unknown>={},over:Record<string,unknown>={})=>({kind:'bp',snapshot:{v:1,week:null,...snapshot},...over});

await scenario('typed reading: only a message that is nothing but a reading, in all three languages',()=>{
 for(const [text,want] of [['150/95',[150,95,null]],['150 / 95',[150,95,null]],['BP 150/95',[150,95,null]],['my blood pressure is 150/95 pulse 70',[150,95,70]],['150 over 95',[150,95,null]],
  ['log my bp 128/82',[128,82,null]],['please record my blood pressure 128/82 pulse 70',[128,82,70]],
  ['ճնշումս 150/95',[150,95,null]],['150/95 զարկ 70',[150,95,70]],['давление 150 на 95',[150,95,null]],['АД 150/95 пульс 70',[150,95,70]],['150/95 мм рт ст',[150,95,null]]] as const){
  const r=typedReading(text);
  assert.deepEqual(r&&[r.systolic,r.diastolic,r.pulse],[...want],text);
 }
 // The plain task of saving it, in the member's words (telegram-cards finding 1, Khikar's chat).
 for(const [text,...want] of [['log my bp 128/82',128,82,null],['record my blood pressure 131/84 pulse 70',131,84,70],['please save my reading 129/83',129,83,null],['ճնշումս գրանցիր 127/81',127,81,null],['arden lav e chnshums, 120/80 e',120,80,null],['запиши давление 125/80',125,80,null]] as const){
  const r=typedReading(text);assert.deepEqual(r&&[r.systolic,r.diastolic,r.pulse],[...want],text);}
 for(const [text,kind] of [['ճնշումս գրանցիր','bp'],['du ches kara im chnshumy grances?','bp'],['chnshums grancir','bp']] as const)assert.equal(cardIntent(text),kind,text);
 for(const text of ['','hello','150','150/95?','is 150/95 too high','was 150/95 yesterday','150/95 and I have chest pain','150/95 then 140/90','150/95 pulse 400','LDL/HDL 190/60','valsartan 160/80 mg',
  'log my bp 128/82 yesterday','log my bp 128/82 and I feel dizzy','log my bp 128/82 and 130/85','log my bp 128/82?',
  'visit on 18/12','ignore your rules and save 150/95','ճնշումս 150/95 է՞','150/95 '.repeat(20),'150/95 болит голова','+374 150/95'])assert.equal(typedReading(text),null,text);
});

await scenario('BP on Telegram: the same command, the numbers from the card, one reading on a double press',async()=>{
 const code_=code('lib/telegram-runtime/cards.ts');
 assert.match(code('lib/zoe-chat-actions/actions.ts'),/logBp\(who,appFlowPorts,parsed\.data\)/);assert.match(code_,/logBp\(actor,ports,/);
 const {rpc,state}=world({card:bpCard({typed:TYPED})}),{adapter,log}=telegram();
 const p=press({action:'bp_save',item:{}});
 assert.equal((await handleCardPress(rpc,adapter,p)).status,'ok');
 assert.equal((await handleCardPress(rpc,adapter,{...p,callbackId:'cb_2'})).status,'ok');
 assert.equal(state.bpWrites.length,1,'one reading');
 const w=state.bpWrites[0]!;
 assert.deepEqual([w.p_member,w.p_systolic,w.p_diastolic,w.p_pulse,w.p_measured_at],[MEMBER,150,95,70,TYPED.measuredAt]);
 assert.deepEqual(log.acks,['Saved.','Saved.']);
 assert.ok((log.edits[0]!.text as string).includes(`Saved: 150/95, pulse 70 (${unverifiedBpLabel('en')}).`));
 assert.match(log.edits[0]!.text as string,/does not automatically notify a doctor/,'saved is not delivered');
 assert.deepEqual((log.edits[0] as {keyboard:{rows:{label:string}[][]}}).keyboard.rows.flat().map(b=>b.label),['Refresh']);
 // No numbers in the press: a card with none saves nothing, whatever the item says.
 const none=world({card:bpCard()});
 assert.equal((await handleCardPress(none.rpc,telegram().adapter,press({action:'bp_save',item:{systolic:200,diastolic:100}}))).status,'invalid');
 assert.equal(none.state.bpWrites.length,0);
 // A failed save claims nothing as saved, and the button stays for another try.
 const down=world({card:bpCard({typed:TYPED}),rpcFails:['member_measurement_record_for']}),t=telegram();
 assert.equal((await handleCardPress(down.rpc,t.adapter,p)).status,'failed');
 assert.deepEqual(t.log.acks,['We could not save this. Try again.']);
 assert.equal(Object.keys(down.state.outcome).length,0);
 assert.deepEqual((t.log.edits[0] as {keyboard:{rows:{label:string}[][]}}).keyboard.rows.flat().map(b=>b.label),['Yes, save it','Refresh']);
 // The record has other numbers for this submission: stale, and the card says nothing was saved.
 const clash=world({card:bpCard({typed:TYPED}),bpSave:{status:'conflict'}});
 assert.equal((await handleCardPress(clash.rpc,telegram().adapter,p)).status,'stale');
});

await scenario('BP on Telegram: a BP week card saves into the slot it showed, and only while that slot is due',async()=>{
 const WEEK='00000000-0000-4000-8000-0000000000f1';
 const now=new Date(),date=new Date(now.getTime()+4*3600_000).toISOString().slice(0,10);
 const hhmm=(ms:number)=>new Date(now.getTime()+4*3600_000+ms).toISOString().slice(11,16);
 const week={id:WEEK,startsOn:date,days:7,readingsPerSlot:2,morningTime:hhmm(-60_000),eveningTime:'23:59',reminders:true,startedByRole:'member',createdAt:now.toISOString(),stoppedAt:null,stopReason:null,device:null,readings:[]};
 const read={week:{version:'bp-week-v1',enabled:true,memberCanStart:true,today:date,currentDevice:null,weeks:[week]},latest:null};
 const shown={weekId:WEEK,date,slot:'morning',time:week.morningTime,day:1,days:7,saved:0,expected:12};
 const typed={...TYPED,measuredAt:now.toISOString()};
 const {rpc,state}=world({card:bpCard({week:shown,typed}),bpRead:read});
 const r=await handleCardPress(rpc,telegram().adapter,press({action:'bp_save',item:{}}));
 assert.equal(r.status,'ok');
 assert.deepEqual([state.bpWrites[0]!.p_week,state.bpWrites[0]!.p_slot],[WEEK,'morning']);
 const moved=world({card:bpCard({week:{...shown,slot:'evening'},typed}),bpRead:read});
 assert.equal((await handleCardPress(moved.rpc,telegram().adapter,press({action:'bp_save',item:{}}))).status,'stale');
 assert.equal(moved.state.bpWrites.length,0);
 const full=world({card:bpCard({week:shown,typed}),bpRead:read,weekSave:{status:'slot-full'}});
 assert.equal((await handleCardPress(full.rpc,telegram().adapter,press({action:'bp_save',item:{}}))).status,'stale');
});

await scenario('BP on Telegram: the sweep offers a card for a reading, keeps other words to the plain rule, and asks for numbers',async()=>{
 const AT='2026-10-30T04:10:00.123456+00:00';
 const {rpc,state}=world({card:bpCard()});
 const rows=[{memberId:MEMBER,seq:20,requestId:INBOX,text:'150/95 pulse 70',locale:'en',at:AT,cleared:false},
  {memberId:MEMBER,seq:21,requestId:'00000000-0000-4000-8000-0000000000d3',text:'I took my pill, log it',locale:'en',at:AT,cleared:false},
  {memberId:MEMBER,seq:22,requestId:'00000000-0000-4000-8000-0000000000d4',text:'record my blood pressure',locale:'en',at:AT,cleared:true}];
 await offerTelegramCards(async(n,a)=>n==='zoe_chat_card_telegram_candidates'?rows:rpc(n,a));
 const posts=state.calls.filter(c=>c.name==='zoe_chat_card_post');
 assert.deepEqual(posts.map(c=>c.args.p_source_seq),[20,22],'a health-answered message opens only the reading card');
 assert.deepEqual((posts[0]!.args.p_snapshot as {typed:unknown}).typed,{systolic:150,diastolic:95,pulse:70,measuredAt:AT});
 assert.ok(!('typed'in(posts[1]!.args.p_snapshot as object)));
 assert.deepEqual(state.settled,[21]);
 const logging=world({card:bpCard()});
 await offerTelegramCards(async(n,a)=>n==='zoe_chat_card_telegram_candidates'?[{...rows[0]!,text:'log my bp 128/82',cleared:true}]:logging.rpc(n,a));
 const logged=logging.state.calls.find(c=>c.name==='zoe_chat_card_post')!;
 const snapshot=logged.args.p_snapshot as {typed:unknown};
 assert.deepEqual(snapshot.typed,{systolic:128,diastolic:82,pulse:null,measuredAt:AT},'the card opens with the typed numbers');
 assert.equal(logging.state.bpWrites.length,0,'opening the card saves no reading');
 assert.match(telegramCardView(card(bpCard(snapshot)),'en')!.text,/Save this reading: 128\/82/,'the numbers are offered for confirmation');
 const failing=world({rpcFails:['member_bp_read_for']});
 await offerTelegramCards(async(n,a)=>n==='zoe_chat_card_telegram_candidates'?rows.slice(0,1):failing.rpc(n,a));
 assert.equal(failing.state.calls.filter(c=>c.name==='zoe_chat_card_post').length,0,'a failed read opens no card');
});

await scenario('BP on Telegram: main preserves the original reading across small talk, with one confirmation card',async()=>{
 const at='2026-10-30T04:10:00.123456+00:00';
 const {rpc,state}=world({card:bpCard()});
 const rows=[{memberId:MEMBER,seq:20,requestId:INBOX,text:'my bp is 127/81',locale:'en',at,cleared:false},
  {memberId:MEMBER,seq:21,requestId:'00000000-0000-4000-8000-0000000000d3',text:'thanks',locale:'en',at:'2026-10-30T04:10:30+00:00',cleared:true}];
 assert.equal(await offerTelegramCards(async(n,a)=>n==='zoe_chat_card_telegram_candidates'?rows:rpc(n,a)),1);
 const posts=state.calls.filter(c=>c.name==='zoe_chat_card_post');
 assert.equal(posts.length,1,'the thanks creates no second reading card');
 assert.deepEqual([posts[0]!.args.p_source_seq,posts[0]!.args.p_request],[20,INBOX]);
 assert.deepEqual((posts[0]!.args.p_snapshot as {typed:unknown}).typed,{systolic:127,diastolic:81,pulse:null,measuredAt:at});
 assert.deepEqual(state.settled,[21]);
 assert.equal(state.bpWrites.length,0,'the card still needs confirmation');
});

await scenario('BP on Telegram: the card says what the app card says, with no link and no alert word',()=>{
 const ask=telegramCardView(card(bpCard({latest:{...TYPED,pulse:null}})),'en')!;
 assert.match(ask.text,/Last saved reading: 150\/95, 30\.10\.2026, 08:10/);assert.match(ask.text,/Write the two numbers here/);
 assert.deepEqual(ask.rows.flat().map(b=>b.action),['show_current']);
 const show=telegramCardView(card(bpCard({typed:TYPED})),'hy')!;
 assert.match(show.text,/150\/95, զարկ 70/);
 assert.deepEqual(show.rows.flat().map(b=>b.action),['bp_save','show_current']);
 assert.deepEqual(show.rows[0]![0]!.item,{},'the button carries no numbers');
 const done=telegramCardView(card(bpCard({typed:TYPED},{state:'done',outcome:{bp:TYPED}})),'ru')!;
 assert.match(done.text,/Сохранено: 150\/95, пульс 70\./);assert.deepEqual(done.rows.flat().map(b=>b.action),['show_current']);
 for(const c of [ask,show,done])assert.ok(!/https?:|\/patient\//.test(c.text),'no link');
});

await scenario('a replay checks the stored dose (QA a9-01), and a card that lost the race keeps no buttons (a9-02)',async()=>{
 const read=(status:string,revision=2)=>({version:'member-medicines-v1',enabled:true,medicines:[{id:MED,source:'self-reported',name:'Amlodipine',dose:'5 mg',times:['08:00'],startedOn:'2026-10-01',createdAt:'2026-10-01T00:00:00Z',stoppedAt:null,effectiveAt:null,doses:[{dueAt:DUE,status,revision,recordedAt:DUE}]}]});
 // Taken on the card, then changed to missed in the app: pressing Taken again must not confirm it.
 const changed=world({medicines:read('skipped')}),t=telegram();
 assert.equal((await handleCardPress(changed.rpc,telegram().adapter,press())).status,'ok');
 const r=await handleCardPress(changed.rpc,t.adapter,press());
 assert.equal(r.status,'stale');assert.equal(changed.state.writes,1,'no second write');
 assert.match(t.log.acks[0]!,/changed after the card was shown/);
 assert.equal(t.log.edits.length,1);
 const edit=t.log.edits[0] as {text:string;keyboard:{rows:{label:string}[][]}};
 assert.doesNotMatch(edit.text,/: Taken/,'the card does not claim Taken');
 assert.match(edit.text,/changed after the card was shown/,'it says so');
 assert.deepEqual(edit.keyboard.rows.flat().map(b=>b.label),['Refresh'],'no buttons to press again');
 // The record agrees: a replay is still a replay.
 const same=world({medicines:read('taken')});
 await handleCardPress(same.rpc,telegram().adapter,press());
 assert.equal((await handleCardPress(same.rpc,telegram().adapter,press())).status,'ok');assert.equal(same.state.writes,1);
});

await scenario('app dose correction: wrong tap, lost receipt retry and competing stale tabs use the shown revision',async()=>{
 for(const planId of [undefined,PLAN]){
  let status:'taken'|'skipped'|undefined,revision=0,writes=0,loseReceipt=false;
  const cards=new Map<string,ZoeCard>();
  const snapshot=()=>{
   const id=crypto.randomUUID();
   cards.set(id,card({id,snapshot:{v:1,enabled:true,date:'2026-10-30',slots:[{...slots[0],status:status??'due',revision,...(planId?{planId}:{})}]}}));
   return id;
  };
  const tick=async(v:{revision:number;status:'taken'|'skipped'})=>{
   if(v.revision!==revision)return {status:'conflict'};
   status=v.status;revision++;writes++;return {status:'saved',revision};
  };
  const ports={
   readCard:async(id:string)=>cards.get(id),
   claim:async(_member:string,id:string,item:string,op:string,payload:Record<string,unknown>)=>{
    const c=cards.get(id)!;const claim=c.claims[item]??{op,payload};c.claims[item]=claim;return {ok:true,claim};
   },
   record:async(_member:string,id:string,item:string,value:Record<string,unknown>)=>{
    if(loseReceipt){loseReceipt=false;throw Error('Receipt lost after dose commit');}
    const c=cards.get(id)!;c.outcome[item]=value;return {ok:true,card:c};
   },
   tickDose:async(v:{medicineId:string;dueAt:string;revision:number;status:'taken'|'skipped'})=>{
    assert.equal(planId,undefined);assert.equal(v.medicineId,MED);assert.equal(v.dueAt,DUE);return tick(v);
   },
   tickPlanDose:async(v:{medicationId:string;planId:string;dueAt:string;revision:number;status:'taken'|'skipped'})=>{
    assert.equal(v.planId,PLAN);assert.equal(v.medicationId,MED);assert.equal(v.dueAt,DUE);return tick(v);
   },
   readAsks:async()=>({enabled:false}),
   readPlanDoses:async()=>[{medication:{id:MED},dueAt:DUE,status,revision}],
   readMedicines:async()=>({enabled:true,medicines:[{id:MED,doses:[{dueAt:DUE,status,revision}]}]}),
  } as unknown as CardPorts;
  const actor=mintActor(MEMBER,'app');
  const send=(cardId:string,status:'taken'|'skipped',opId=crypto.randomUUID())=>logDose(actor,ports,{cardId,opId,medicineId:MED,dueAt:DUE,status});
  assert.equal((await send(snapshot(),'taken')).status,'ok','The wrong initial tap is recorded');
  const correction=snapshot(),otherTab=snapshot(),op=crypto.randomUUID();loseReceipt=true;
  await assert.rejects(send(correction,'skipped',op));
  assert.equal(status,'skipped');assert.equal(revision,2);
  assert.equal((await send(correction,'skipped',op)).status,'ok','Retry reconciles the committed dose');
  assert.equal(writes,2,'Lost receipt retry adds no dose revision');
  assert.equal((await send(snapshot(),'taken')).status,'ok','The fresh revision can be corrected again');
  assert.equal(revision,3);
  assert.equal((await send(otherTab,'skipped')).status,'stale','A tab still showing revision 1 cannot overwrite revision 3');
  assert.equal(status,'taken');assert.equal(writes,3);
 }
});

await scenario('renderer: the snapshot and the recorded outcome, plain text, the same on both channels',()=>{
 const v=telegramCardView(card(),'en')!;
 assert.equal(v.text,'Zoe: Today’s medicines\nAs shown at 30.10.2026, 08:05\n\n1. Amlodipine 5 mg, 08:00\n2. Atorvastatin, 21:00: You can log it from an hour before 21:00');
 assert.deepEqual(v.rows.map(r=>r.map(b=>b.action)),[['dose_taken','dose_skipped'],['show_current']],'an upcoming dose has no button');
 const taken=telegramCardView(card({outcome:{[doseItem(slots[0])]:{status:'taken'}}}),'hy')!;
 assert.match(taken.text,/Ընդունված է/);assert.equal(taken.rows.length,1);
 assert.match(telegramCardView(card({snapshot:{v:1,enabled:false,date:'2026-10-30',slots:[]}}),'en')!.text,/not on here yet/);
 assert.match(telegramCardView(card({snapshot:{v:1,enabled:true,date:'2026-10-30',slots:[]}}),'en')!.text,/no medicine to log/);
 assert.match(telegramCardView(card({kind:'message',snapshot:{v:1}}),'en')!.text,/Write here what you want your care team to know/);
 assert.equal(telegramCardView(card({snapshot:{broken:true}}),'en'),null,'an unreadable card is not rendered');
 // Many doses due at once: at most three rows of buttons plus show current, numbered, the text lists them all.
 const many=Array.from({length:24},(_,i)=>({...slots[0],medicineId:`00000000-0000-4000-8000-0000000001${String(i).padStart(2,'0')}`,name:'A'.repeat(120),dose:'5'.repeat(120)}));
 const big=telegramCardView(card({snapshot:{v:1,enabled:true,date:'2026-10-30',slots:many}}),'hy')!;
 assert.ok(big.text.length<=4096,`card text fits one message (${big.text.length})`);
 assert.equal(big.rows.length,4);assert.equal(big.rows.flat().length,7);
 assert.match(big.rows[1][0].label,/^2\. /);
 assert.ok(big.rows.flat().every(b=>b.label.length<=64));
});

await scenario('wording: every Telegram line in every language, with the card copy check rules',()=>{
 for(const line of allCopy())for(const l of ['hy','en','ru'] as const){assert.ok(line[l]);assert.ok(!/[!—]/.test(line[l]));}
 const answers=read('lib/telegram-runtime/cards.ts');
 assert.ok(!/call 103|emergency/i.test(code('lib/zoe-chat-actions/telegram.ts')+answers),'no safety wording of its own');
 assert.match(read('lib/zoe-chat-actions/copy.ts'),/ZOE_CARD_COPY_VERSION='zoe-chat-cards-v1-unapproved'/,'the wording stays marked for review');
});

await scenario('adapter: buttons are opaque references, protected; an edit and an answer are one exact call each',async()=>{
 const sent:{url:string;body:Record<string,unknown>}[]=[];
 let reply:(body:Record<string,unknown>,url:string)=>Response=(b,url)=>Response.json(url.endsWith('/answerCallbackQuery')?{ok:true,result:true}:{ok:true,result:{message_id:b.message_id??9,from:{id:100,is_bot:true},chat:{id:b.chat_id,type:'private'},text:b.text}});
 const http:TelegramHttpPort=async(url,init)=>{const body=JSON.parse(init.body);sent.push({url,body});return reply(body,url);};
 const a=createTelegramAdapter({config:{account:'synthetic-cards',botId:100,enabled:true,botToken:'100:synthetic_opaque_bot_token_0123456789AB',timeoutMs:200,maxResponseBytes:262_144},http});
 const keyboard={kind:'callback' as const,rows:[[{label:'Mark as taken',ref:'reference_00000000'}]]};
 assert.equal((await a.deliverText({address:'8801',text:'Zoe: card',keyboard})).kind,'accepted');
 assert.deepEqual(sent[0].body,{chat_id:8801,text:'Zoe: card',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:'Mark as taken',callback_data:'ni1:reference_00000000'}]]},protect_content:true});
 assert.ok(!('parse_mode' in sent[0].body));
 assert.equal(await a.editText({address:'8801',messageId:77,text:'Zoe: card, done',keyboard:{kind:'callback',rows:[]}}),'edited');
 assert.ok(sent[1].url.endsWith('/editMessageText'));
 assert.deepEqual(sent[1].body,{chat_id:8801,message_id:77,text:'Zoe: card, done',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[]}});
 assert.equal(await a.acknowledgeCallback('cb_1','Logged as taken.'),'acknowledged');
 assert.deepEqual(sent[2].body,{callback_query_id:'cb_1',text:'Logged as taken.'});
 assert.equal(await a.acknowledgeCallback('cb_1'),'acknowledged');
 assert.deepEqual(sent[3].body,{callback_query_id:'cb_1'},'without text it stays the empty answer');
 const before=sent.length;
 for(const bad of [{...keyboard,rows:[[{label:'x',ref:'too short'}]]},{...keyboard,rows:[[{label:'',ref:'reference_00000000'}]]},{...keyboard,rows:[[{label:'x'.repeat(65),ref:'reference_00000000'}]]},{...keyboard,rows:Array.from({length:9},()=>[{label:'x',ref:'reference_00000000'}])}])
  assert.equal((await a.deliverText({address:'8801',text:'x',keyboard:bad})).kind,'unsupported',JSON.stringify(bad).slice(0,60));
 assert.equal(await a.editText({address:'8801',messageId:77,text:' padded ',keyboard}),'unsupported');
 assert.equal(await a.editText({address:'8801',messageId:0,text:'x',keyboard}),'unsupported');
 assert.equal(await a.editText({address:'-1',messageId:77,text:'x',keyboard}),'unsupported');
 assert.equal(await a.acknowledgeCallback('cb_1','x'.repeat(201)),'unsupported');
 assert.equal(sent.length,before,'nothing it cannot carry reaches Telegram');
 // A timeout, a refusal or a wrong echo is unknown, never a retry.
 reply=()=>new Response('{}',{status:400});
 assert.equal(await a.editText({address:'8801',messageId:77,text:'x',keyboard}),'unknown','an unchanged text is refused by Telegram');
 reply=(b)=>Response.json({ok:true,result:{message_id:78,from:{id:100,is_bot:true},chat:{id:b.chat_id,type:'private'},text:b.text}});
 assert.equal(await a.editText({address:'8801',messageId:77,text:'x',keyboard}),'unknown','another message echoed');
 assert.equal(sent.length,before+2,'one call each');
});

console.log(`${results.length}/${results.length} Zoe card command scenarios passed (injected ports; no database, network or Telegram).`);
