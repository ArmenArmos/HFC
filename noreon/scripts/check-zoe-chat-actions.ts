import {MEMBER_LANGUAGE} from '@/lib/patient/copy';
/**
 * Zoe chat action cards (founders 29 Oct 2026, chat-first). Pure checks; the database side is check-zoe-chat-actions.sql.
 * 1. Zoe's safety pipeline is untouched and in front: nothing in lib/zoe imports the cards; typed text reaches the
 *    intent words only through the database's cleared offer; side-effect and message cards send through the chat's
 *    own send (urgent words first), and no side-effect choice on its own opens the 103 screen (no new false 103s),
 *    while urgent words in the member's own detail still do.
 * 2. The registry, the migration's kind list, the copy and the pages agree; a new kind is one list away.
 * 3. Cards sit in the thread at their time; offers need the cleared newest message; polls never put back older cards.
 * 4. Copy: Armenian, English and Russian for every line; no exclamation mark, emoji or em dash.
 * 5. Rendering: snapshots, confirm steps, headings and labels (server render of the card component).
 */
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import * as zod from 'zod';
import * as registryModule from '@/lib/zoe-chat-actions/registry';
import * as copyModule from '@/lib/zoe-chat-actions/copy';
import * as bpModel from '@/lib/bp-week/model';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {zoeTextRoute,symptomRedFlagRoute} from '@/lib/zoe/member-screen';
import {textRedFlags} from '@/lib/zoe/symptoms/red-flags';
import {stagingMatches} from '@/lib/zoe/urgent-staging';
import {sameDayFloor} from '@/lib/zoe/health-answer';
import {cardIntent} from '@/lib/zoe-chat-actions/intent';
import {CARD_KINDS,CARD_PAGE,SNAPSHOTS,cardSchema,type ZoeCard,type ZoeCards} from '@/lib/zoe-chat-actions/registry';
import {CHIP,TITLE,SIDE_EFFECTS,allCopy,sideEffectMessage,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {cardOffer,mergeCards,upsertCard,withCards} from '@/lib/zoe-chat-actions/thread';
import type {ChatItem} from '@/lib/zoe/app-chat-contracts';
import {realtimeStubs} from './realtime-test-stubs';
const realtimeBoundaries=await realtimeStubs();

const LOCALES:CardLocale[]=['hy','en','ru'];
const read=(p:string)=>readFileSync(p,'utf8');
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);

// ---------------------------------------------------------------- 1. Safety stays in front
for(const f of files('lib/zoe'))assert.ok(!/zoe-chat-actions|zoe-cards/.test(read(f)),`${f} must not depend on the chat cards`);
for(const f of files('lib/zoe-chat-actions').concat('components/patient/zoe-cards.tsx')){
 const s=read(f);
 // The cards never decide urgency themselves: no lexicon, red-flag, floor or model import.
 assert.ok(!/from '[^']*(?:urgent-staging|urgent-test|red-flags|same-day-floors|health-answer|pipeline|provider|gateway)/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'')),`${f} imports no safety rule or model`);
}
// The intent words are reached only through cardOffer, which needs the database's clearedSeq.
for(const f of files('lib').concat(files('components'),files('app')))if(f!=='lib/zoe-chat-actions/intent.ts'&&f!=='lib/zoe-chat-actions/thread.ts'&&f!=='lib/telegram-runtime/cards.ts')assert.ok(!/from ['"][^'"]*zoe-chat-actions\/intent['"]/.test(read(f)),`${f} must not call cardIntent directly`);
const actions=read('lib/zoe-chat-actions/actions.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
assert.match(actions,/sendZoeChatMessage\(requestId,text,true\)/,'card sends go through the chat send (urgent words first)');
assert.ok(!/storeZoeMessage|conversation_receive/.test(actions),'no card bypasses the chat send');
// Every card write claims its item first (switches, ownership, one operation across tabs; Astra ZCA-01/02).
for(const fn of ['sendFromCard']){
 const body=actions.slice(actions.indexOf(`export const ${fn}`));
 const end=body.indexOf('\nexport const',10);
 const own=end>0?body.slice(0,end):body;
 assert.ok(own.indexOf('await claim(')>0&&own.indexOf('await claim(')<Math.min(...['tickMyMedicine(','recordBpWeekReading(','recordMeasurement(','answerMemberProposal(','sendZoeChatMessage('].map(w=>own.indexOf(w)).filter(i=>i>0)),`${fn} claims before it writes`);
}
{const commands=read('lib/zoe-chat-actions/commands.ts'),own=commands.slice(commands.indexOf('export async function logBp'));
 assert.ok(own.indexOf('await claim(')>0&&own.indexOf('await claim(')<Math.min(own.indexOf('ports.saveBpWeek('),own.indexOf('ports.saveBp(')),'logBp claims before it writes');
 const visit=commands.slice(commands.indexOf('export async function acceptVisit'));
 assert.ok(visit.indexOf('await claim(')>0&&visit.indexOf('await claim(')<visit.indexOf('ports.acceptProposal('),'acceptVisit claims before it writes');}
assert.match(read('supabase/migrations/20261029172131_zoe_chat_actions.sql'),/_zoe_chat_message_cleared\(p_member,p_source_seq\)/,'the database re-checks clearance on open');

// No side-effect choice, with no words of the member's own, opens the 103 screen or a same-day floor (prod-as-staging
// placeholder list on; the symptom red flags as when an intake is active). These are the exact texts the card sends.
const STAGING={NOREON_ZOE_URGENT_PLACEHOLDER:'true'};
let falseUrgent=0;
for(const l of LOCALES)for(const what of SIDE_EFFECTS){
 if(what==='other')continue;
 const text=sideEffectMessage(l,what,'');
 const hits={route:zoeTextRoute(text,STAGING),red:symptomRedFlagRoute(text,{enabled:true,active:true}),flags:textRedFlags([text],{intakeActive:true}).length,staging:stagingMatches(text).length,floor:sameDayFloor([text],null)};
 if(hits.route==='urgent'||hits.red||hits.flags||hits.staging||hits.floor){falseUrgent++;console.error(`side-effect choice escalates: ${l}/${what}`,hits);}
}
assert.equal(falseUrgent,0,'no side-effect choice on its own escalates');
// The member's own urgent words in the detail still open the 103 screen: the card adds nothing in front of the pipeline.
for(const [l,detail] of [['en','I have chest pain right now and cannot breathe'],['ru','сейчас сильная боль в груди и не могу дышать'],['hy','հիմա կրծքավանդակիս ուժեղ ցավ ունեմ, չեմ կարողանում շնչել']]as const){
 const text=sideEffectMessage(l,'dizziness',detail);
 const direct=zoeTextRoute(detail,STAGING)==='urgent'||symptomRedFlagRoute(detail,{enabled:true,active:true});
 const viaCard=zoeTextRoute(text,STAGING)==='urgent'||symptomRedFlagRoute(text,{enabled:true,active:true});
 assert.ok(direct,`${l}: the fixture is urgent on its own`);
 assert.equal(viaCard,direct,`${l}: the card's text escalates exactly when the member's words alone do`);
}
console.log(`side-effect texts: ${LOCALES.length*(SIDE_EFFECTS.length-1)} choices, ${falseUrgent} escalate on their own`);

// ---------------------------------------------------------------- 2. Registry, migration, copy, pages
const sqlKinds=read('supabase/migrations/20261104160300_zoe_v3_next_step.sql').match(/kind in\(([^)]*)\)/)![1]!.split(',').map(s=>s.trim().replace(/'/g,''));
// Later migrations widen the live check in place (WP F: widen_in_check(...,'zoe_chat_cards_kind_check','kind',array[...])).
for(const file of readdirSync('supabase/migrations').filter(f=>f>'20261104160300').sort()){
 for(const m of read(`supabase/migrations/${file}`).matchAll(/widen_in_check\('public\.zoe_chat_cards','zoe_chat_cards_kind_check','kind',array\[([^\]]*)\]\)/g))
  sqlKinds.push(...m[1]!.split(',').map(s=>s.trim().replace(/'/g,'')).filter(k=>!sqlKinds.includes(k)));
}
assert.deepEqual([...sqlKinds].sort(),[...CARD_KINDS].sort(),'the migration and the registry list the same kinds');
for(const k of CARD_KINDS){assert.ok(SNAPSHOTS[k]&&CHIP[k]&&TITLE[k]&&CARD_PAGE[k],`${k} is complete`);}
// Snapshots are strict: an unknown field makes a card unreadable instead of being shown.
assert.equal(SNAPSHOTS.plan.safeParse({v:1,available:true,plan:null,extra:1}).success,false);
const base={id:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',source:'chip',sourceSeq:null,state:'open',outcome:{},at:'2026-10-29T10:00:00.000Z'};
assert.equal(cardSchema.parse({...base,kind:'plan',snapshot:{v:1,available:true,plan:null}}).valid,true);
assert.equal(cardSchema.parse({...base,kind:'plan',snapshot:{v:2}}).valid,false,'a snapshot that does not parse is unreadable');
assert.equal(cardSchema.parse({...base,kind:'ldl_goal',snapshot:{v:1}}).valid,false,'an unknown kind is unreadable, not guessed');
// A parsed card round-trips through the GET route (its 'valid' mark is ignored and recomputed).
assert.equal(cardSchema.parse(cardSchema.parse({...base,kind:'message',snapshot:{v:1}})).valid,true);

// ---------------------------------------------------------------- 3. Thread placement, offers, polls
const card=(id:number,at:string,extra:Partial<ZoeCard>={}):ZoeCard=>cardSchema.parse({...base,id:`00000000-0000-4000-8000-0000000000${String(id).padStart(2,'0')}`,at,kind:'message',snapshot:{v:1},...extra});
const items:ChatItem[]=[
 {kind:'member',key:'m1',text:'hi',at:'2026-10-29T10:00:00Z',channel:'app',requestId:null},
 {kind:'answer',key:'z1',text:'hello',at:'2026-10-29T10:00:05Z'},
 {kind:'member',key:'m2',text:'more',at:'2026-10-29T10:05:00Z',channel:'app',requestId:null},
 {kind:'ack',key:'am2',text:null},
];
const placed=withCards(items,[card(2,'2026-10-29T10:06:00Z'),card(1,'2026-10-29T10:01:00Z')]).map(e=>e.type==='card'?`c${e.card.id.slice(-2)}`:e.item.key);
assert.deepEqual(placed,['m1','z1','c01','m2','am2','c02'],'cards at their time; a status line stays with its message');
const thread={messages:[{seq:1,text:'hi',at:'2026-10-29T10:00:00Z',channel:'app'as const,requestId:null},{seq:2,text:'Can you show my plan?',at:'2026-10-29T10:05:00Z',channel:'app'as const,requestId:null}]};
assert.deepEqual(cardOffer(thread,{enabled:true,clearedSeq:2}),{kind:'plan',seq:2});
assert.equal(cardOffer(thread,{enabled:true,clearedSeq:null}),null,'not cleared: no offer, whatever the words');
assert.equal(cardOffer(thread,{enabled:true,clearedSeq:1}),null,'only the newest message');
assert.equal(cardOffer(thread,{enabled:false,clearedSeq:2}),null,'switched off: no offer');
assert.equal(cardOffer({messages:[{...thread.messages[1]!,text:'thanks, all good'}]},{enabled:true,clearedSeq:2}),null,'no card words: no offer');
// A reading, or asking to log one, opens the BP card under the wider rule (a same-day answer, say); nothing else does.
{const say=(text:string)=>({messages:[{...thread.messages[1]!,text}]});
 assert.deepEqual(cardOffer(say('log my bp 128/82'),{enabled:true,clearedSeq:null,readingSeq:2}),{kind:'bp',seq:2});
 assert.deepEqual(cardOffer(say('128/82'),{enabled:true,clearedSeq:null,readingSeq:2}),{kind:'bp',seq:2});
 assert.deepEqual(cardOffer(say('du ches kara im chnshumy grances?'),{enabled:true,clearedSeq:null,readingSeq:2}),{kind:'bp',seq:2});
 assert.equal(cardOffer(say('show my plan'),{enabled:true,clearedSeq:null,readingSeq:2}),null,'Every other card keeps the plain rule');
 assert.equal(cardOffer(say('log my bp 128/82'),{enabled:true,clearedSeq:null,readingSeq:1}),null,'Only the newest message');
 const pair=(gapMs:number)=>({messages:[{...thread.messages[0]!,seq:1,text:'my bp is 127/81',at:'2026-10-30T10:00:00.000Z'},{...thread.messages[1]!,seq:2,text:'thanks',at:new Date(Date.parse('2026-10-30T10:00:00.000Z')+gapMs).toISOString()}]});
 assert.equal(cardOffer(pair(30_000),{enabled:true,clearedSeq:2,readingSeq:2}),null,'An acknowledgement cannot copy an older reading under a new sequence');
 assert.equal(cardOffer(pair(600_000),{enabled:true,clearedSeq:2,readingSeq:2}),null,'Not an older reading');
 // Astra ZCD-01: a correction never carries the reading over.
 const after=(text:string)=>cardOffer({messages:[pair(30_000).messages[0]!,{...pair(30_000).messages[1]!,text}]},{enabled:true,clearedSeq:2,readingSeq:2});
 for(const text of ["sorry, that was my dad's reading",'actually it was 138/88','that was yesterday','no wait','չէ, սխալ էր','log it, it was my dad','save it for my brother','please record it from Monday'])assert.equal(after(text),null,text);
 assert.deepEqual(after('log my pills'),{kind:'dose',seq:2},'Another task keeps its own card');
 for(const text of ['log it','please save it','grancir','գրանցիր','запиши','ok thanks'])assert.equal(after(text),null,`${text}: original reading clearance cannot be inferred from the latest run`);
}
const shown:ZoeCards={enabled:true,clearedSeq:2,cards:[card(1,'2026-10-29T10:01:00Z',{outcome:{sent:{}},state:'done'})]};
assert.equal(mergeCards(shown,{enabled:true,clearedSeq:2,cards:[card(1,'2026-10-29T10:01:00Z')]}).cards[0]!.state,'done','an older poll never reopens a card');
const opened=card(3,'2026-10-29T10:07:00Z',{source:'typed',sourceSeq:2});
assert.equal(upsertCard(shown,opened).clearedSeq,null,'the used offer goes');
assert.equal(upsertCard(shown,opened).cards.length,2);

// Intent words, only ever applied to cleared messages.
const INTENTS:[string,string|null][]=[
 ['I want to report a side effect','side_effect'],['Կողմնակի ազդեցություն ունեմ','side_effect'],['хочу сообщить о побочном эффекте','side_effect'],
 ['I took my pill, can you log it','dose'],['ընդունեցի դեղս, նշիր','dose'],['отметить таблетку, я выпил','dose'],
 ['I want to record my blood pressure','bp'],['ուզում եմ գրանցել ճնշումս','bp'],['хочу записать давление','bp'],
 ['record my blood pressure after I took my meds','bp'],['I want to message my doctor because I missed my atorvastatin','message'],['I took my meds','dose'],['I took my atorvastatin','dose'],['forgot my amlodipine this morning','dose'],['missed my losartan','dose'],['խմել եմ դեղս','dose'],['ընդունել եմ հաբերս','dose'],['մոռացել եմ դեղը','dose'],['չեմ խմել դեղս','dose'],['дозу пропустила','dose'],['show my latest results','results'],['ցույց տուր իմ արդյունքները','results'],['покажи мои результаты анализов','results'],
 ['can I see my plan','plan'],['ցույց տուր իմ պլանը','plan'],['покажи мой план','plan'],
 ['when is my next visit','visit'],['երբ է իմ հաջորդ այցը','visit'],['когда мой следующий визит','visit'],
 ['I want to message my doctor','message'],['ուզում եմ գրել բժշկին','message'],['хочу написать врачу','message'],
 ['thank you','✓'],['what is a normal blood pressure?',null],['hello Zoe',null],['спасибо',null],['շնորհակալություն',null],
];
for(const [t,want] of INTENTS)assert.equal(cardIntent(t),want==='✓'?null:want,`intent: ${t}`);

// ---------------------------------------------------------------- 4. Copy
const ARMENIAN=/[Ա-և]/u,CYRILLIC=/[Ѐ-ӿ]/u,EMOJI=/\p{Extended_Pictographic}/u;
for(const line of allCopy()){
 for(const l of LOCALES){
  const t=line[l];
  assert.ok(t&&t.trim(),`every locale has every line (${line.en})`);
  assert.ok(!/[!—]/.test(t)&&!EMOJI.test(t),`voice guide: ${t}`);
 }
 assert.ok(ARMENIAN.test(line.hy),`Armenian line is Armenian: ${line.hy}`);
 assert.ok(CYRILLIC.test(line.ru),`Russian line is Russian: ${line.ru}`);
}
assert.ok(!/\bpatient\b|\buser\b/i.test(allCopy().map(c=>c.en).join(' ')),'never "patient" or "user"');

// Direct saving keeps the time of the prefilled chat reading.
{
 const {act,create}=await import('react-test-renderer');
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const code=ts.transpileModule(read('components/patient/zoe-cards.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const names=[...new Set([...code.matchAll(/require\("([^"]+)"\)/gu)].map(m=>m[1]!))];
 const modules=Object.fromEntries(await Promise.all(names.map(async n=>[n,await import(n.startsWith('./')?`@/components/patient/${n.slice(2)}`:n)])));
 // Browser widgets are replaced with native controls; the card's state and save handlers stay real.
 modules['next/link']={default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 modules['@/components/ui/button']={Button:({children,...props}:{children:React.ReactNode})=>React.createElement('button',props,children)};
 modules['@/components/patient/bp-value-row']={BpValueRow:({value,onChange}:{value:string;onChange:(v:string)=>void})=>React.createElement('input',{value,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>onChange(e.target.value)})};
 const saved:Record<string,unknown>[]=[];
 modules['@/lib/zoe-chat-actions/actions']={...modules['@/lib/zoe-chat-actions/actions'],recordBpFromCard:async(v:Record<string,unknown>)=>{saved.push(v);return {status:'ok'};}};
 // The action now sits behind the shared hook. Supply the same isolated action boundary there.
 const bpHook:Record<string,unknown>={};
 const bpCode=ts.transpileModule(read('components/patient/use-bp-card.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(bpCode).runInNewContext({exports:bpHook,crypto,Intl,Date,require:(n:string)=>n in realtimeBoundaries?realtimeBoundaries[n]:n==='./bp-entry-values'?modules['@/components/patient/bp-entry-values']:n==='@/lib/zoe-chat-actions/thread-events'?{CARD_REPLY_LOST:'noreon:card-reply-lost'}:modules[n]});
 modules['./use-bp-card']=bpHook;
 const exports:Record<string,unknown>={};
 new vm.Script(code).runInNewContext({exports,crypto,Intl,Date,require:(n:string)=>n in realtimeBoundaries?realtimeBoundaries[n]:modules[n]});
 const View=exports.ZoeCardView as typeof import('@/components/patient/zoe-cards').ZoeCardView;
 const measuredAt='2026-10-30T04:00:00.000Z';
 const c=cardSchema.parse({...base,kind:'bp',snapshot:{v:1,week:null,typed:{systolic:128,diastolic:82,pulse:72,measuredAt}}});
 let ui!:import('react-test-renderer').ReactTestRenderer;
 await act(async()=>{ui=create(React.createElement(View,{card:c,locale:'en',focus:false,onCard:()=>{}}));});
 assert.deepEqual(ui.root.findAllByType('input').map(i=>i.props.value),['128','82','72'],'chat numbers prefill the actual form');
 await act(async()=>{ui.root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(saved[0]?.measuredAt,measuredAt,'direct saving keeps the original measurement time');
 await act(async()=>ui.unmount());
}

// ---------------------------------------------------------------- 5. Rendering
const {ZoeCardView}=await import('@/components/patient/zoe-cards');
const html=(c:ZoeCard,l:CardLocale='hy')=>renderToStaticMarkup(React.createElement(ZoeCardView,{card:c,locale:l,focus:false,onCard:()=>{}}));
const doseCard=cardSchema.parse({...base,kind:'dose',snapshot:{v:1,enabled:true,date:'2026-10-29',slots:[
 {medicineId:'00000000-0000-4000-8000-0000000000a1',name:'Amlodipine',dose:'5 mg',dueAt:'2026-10-29T04:00:00.000Z',time:'08:00',status:'due',revision:0},
 {medicineId:'00000000-0000-4000-8000-0000000000a2',name:'Atorvastatin',dose:'20 mg',dueAt:'2026-10-29T17:00:00.000Z',time:'21:00',status:'upcoming',revision:0}]}});
const doseHtml=html(doseCard);
assert.match(doseHtml,/aria-labelledby="[^"]+"/,'a card is a labelled section');
assert.match(doseHtml,/tabindex="-1"/,'its heading can take focus');
assert.match(doseHtml,/Նշել՝ ընդունված/,'a due dose offers its action');
assert.match(doseHtml,/data-zoe-show-current/,'Show current stays in the chat');
assert.ok(!/href="\/patient\/medicines"/.test(doseHtml),'the dose card sends nobody to a page');
assert.ok(!/data-zoe-confirm/.test(doseHtml),'direct dose buttons are available without another confirmation');
const loggedHtml=html(cardSchema.parse({...doseCard,outcome:{[`dose:00000000-0000-4000-8000-0000000000a1:${Date.parse('2026-10-29T04:00:00.000Z')}`]:{status:'taken'}}}),'en');
assert.match(loggedHtml,/Logged as taken/,'what the member did shows on the card');
const planHtml=html(cardSchema.parse({...base,kind:'plan',snapshot:{v:1,available:true,plan:{id:'00000000-0000-4000-8000-0000000000b1',version:2,clinician:'Dr Synthetic',publishedAt:'2026-10-20T08:00:00Z',instructions:'Walk daily.',medicines:[{name:'Amlodipine',dose:'5 mg',times:['08:00']}]}}}),'ru');
assert.match(planHtml,/Версия 2/);assert.ok(!planHtml.includes('Walk daily.'));assert.ok(planHtml.includes(MEMBER_LANGUAGE.pendingInstruction.ru));assert.equal(planHtml.match(/<button/g)?.length,1,'the plan card is read-only: its one button shows current in chat');assert.match(planHtml,/data-zoe-show-current/);
const bpHtml=html(cardSchema.parse({...base,kind:'bp',snapshot:{v:1,week:null}}),'en');
assert.match(bpHtml,/id="00000000-0000-4000-8000-000000000001-systolic"/,'BP inputs carry the card id (two cards never share ids)');
assert.match(bpHtml,/does not automatically notify a doctor|Save reading/);
const sideHtml=html(cardSchema.parse({...base,kind:'side_effect',snapshot:{v:1}}));
assert.match(sideHtml,/<fieldset/);assert.match(sideHtml,/<legend/);assert.match(sideHtml,/type="radio"/,'choices are a radio group');
for (const [locale, disclosure] of [['en', 'Zoe · AI assistant, not a doctor'], ['hy', 'Zoe · ԱԲ օգնական, ոչ բժիշկ'], ['ru', 'Zoe · ИИ-помощник, не врач']] as const) {
 const sideEffect = html(cardSchema.parse({...base,kind:'side_effect',snapshot:{v:1}}), locale);
 assert.ok(!sideEffect.includes(disclosure), `${locale}: action cards avoid repeating the chat disclosure`);
 assert.match(sideEffect, /<fieldset/, `${locale}: the reporting card offers its form`);
}

const unreadable=html(cardSchema.parse({...base,kind:'plan',snapshot:{v:9}}),'en');
assert.match(unreadable,/This card cannot be shown/);

// ---------------------------------------------------------------- 6. Card actions, with the database and features mocked
const urgentRedirect=()=>Object.assign(Error('NEXT_REDIRECT'),{digest:'NEXT_REDIRECT;replace;/patient/zoe/urgent;307;'});
const opensUrgent=(e:unknown)=>/^NEXT_REDIRECT;replace;\/patient\/zoe\/urgent[;?]/.test(String((e as {digest?:unknown}).digest));
const URGENT_TEXT='I have chest pain right now and cannot breathe';
// The claim store behaves like zoe_chat_card_claim/record: first claim per item wins, a done card takes no new claim,
// switched off nothing is claimed. Covers Astra ZCA-01 (one write across tabs/retries), ZCA-02 (switch), ZCA-04
// (an edited text after a failed send is what gets sent and screened), ZCA-POST-01 (one send in flight, retries too).
// A send result may be a function, so a test can hold that send in flight until it resolves.
function harness(kind:'message'|'side_effect'|'bp',sendResults:(string|(()=>Promise<string>))[]=[],o:{measure?:{ok:boolean}[];hangBookkeeping?:boolean;gateMisses?:boolean}={}){
 const cardId=randomUUID(),memberId=randomUUID();
 const db={on:true,signedIn:true,cardReadable:true,claims:{} as Record<string,{op:string;payload:Record<string,unknown>}>,outcome:{} as Record<string,unknown>,state:'open'as 'open'|'done',attempts:{} as Record<string,string>};
 const nurseTasks:{what:string;requestId:string}[]=[],sent:{requestId:string;text:string;toDoctor:boolean}[]=[],measurements:{submissionId:string;systolic:number}[]=[],urgent:{requestId:string;text:string;toDoctor:boolean}[]=[],later:(()=>Promise<unknown>)[]=[];
 const measure=o.measure??[];
 const stuck=()=>new Promise<never>(()=>{});
 const cardNow=()=>cardSchema.parse({...base,id:cardId,kind,snapshot:kind==='bp'?{v:1,week:null}:{v:1},state:db.state,outcome:{...db.outcome},claims:{...db.claims}});
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(read('lib/zoe-chat-actions/actions.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,FormData,process:{env:{NOREON_MEMBER_CHAT_V2:"false"}},require(name:string){if(name in realtimeBoundaries)return realtimeBoundaries[name];
  if(name==='node:crypto')return {createHash};
  if(name==='zod')return zod;
  if(name==='@/lib/observability/with-logging')return {loggedAction:(_n:string,fn:unknown)=>fn};
  if(name==='./actor')return {sessionActor:async()=>db.signedIn?{memberId,channel:'app'}:null,noActor:async()=>({status:'signed_out'})};
  if(name==='next/server')return {after:(fn:()=>Promise<unknown>)=>{later.push(fn);}};
  if(name==='./commands'){
   const shared:Record<string,unknown>={};
   new vm.Script(ts.transpileModule(read('lib/zoe-chat-actions/commands.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
    .runInNewContext({exports:shared,require(inner:string){if(inner==='server-only')return {};if(inner==='node:util')return {isDeepStrictEqual};if(inner==='./next-step-id')return {stableRequestId:(key:string)=>createHash('sha256').update(key).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5')};if(inner==='zod')return zod;if(inner==='./registry')return registryModule;if(inner==='@/lib/bp-week/model')return bpModel;throw Error(`Unexpected boundary in commands.ts: ${inner}`);}});
   return shared;
  }
  if(name==='@/lib/member-medicines/actions')return {tickMyMedicine:async()=>({status:'saved'}),answerMedicineAsk:async()=>({status:'answered'})};
  if(name==='@/lib/member-medicines/ask-copy')return {ASK_REASONS:['forgot','side_effect','cost_or_availability','ran_out','decided_to_stop']};
  if(name==='@/lib/member-medicines/server')return {readMemberMedicines:async()=>({enabled:false}),readMemberMedicineAsks:async()=>({enabled:false})};
  if(name==='@/app/patient/actions')return {recordMeasurement:async(i:{submissionId:string;systolic:number})=>{const r=measure.shift()??{ok:true};if(r.ok&&!measurements.some(m=>m.submissionId===i.submissionId))measurements.push(i);return r;}};
  if(name==='@/app/patient/care/actions')return {reportDose:async()=>({ok:true})};
  if(name==='@/lib/patient-care/repository')return {getCareData:async()=>({plan:null,events:[]})};
  if(name==='@/lib/patient-care/model')return {dosesForDay:()=>[]};
  if(name==='@/lib/bp-week/actions')return {recordBpWeekReading:async()=>({status:'saved'})};
  if(name==='@/lib/bp-week/server')return {readMemberBpWeek:async()=>({enabled:false})};
  if(name==='@/lib/bp-week/model')return bpModel;
  if(name==='@/lib/patient/measured-at')return {isFutureMeasurement:()=>false};
  if(name==='@/lib/real-booking/appointment-actions')return {answerMemberProposal:async()=>({ok:true})};
  if(name==='@/app/patient/zoe/chat-actions')return {
   sendZoeChatMessage:async(requestId:string,text:string,toDoctor:boolean)=>{sent.push({requestId,text,toDoctor});const r=sendResults.shift()??'sent';return {status:typeof r==='function'?await r():r,thread:null};},
   // The chat's red check alone (app/patient/zoe/chat-actions.ts; its own tests are in check-zoe-app-chat.ts).
   openUrgentIfRed:async(requestId:string,text:string,toDoctor:boolean)=>{if(!o.gateMisses&&zoeTextRoute(text,STAGING)==='urgent'){urgent.push({requestId,text,toDoctor});throw urgentRedirect();}},
  };
  if(name==='./server')return {
   routeSideEffectToNurse:async(what:string,requestId:string)=>{nurseTasks.push({what,requestId});},
   typedFromMessage:async()=>({}),buildSnapshot:async()=>({v:1}),postCard:async()=>({ok:false,code:'unavailable'}),readZoeCards:async()=>({enabled:true,cards:[],clearedSeq:null}),
   readZoeCard:async(id:string)=>id===cardId&&db.cardReadable?cardNow():null,
   claimCard:async(m:string,id:string,item:string,op:string,payload:Record<string,unknown>)=>{
    if(m!==memberId||id!==cardId)return {ok:false,code:'not_found'};
    if(!db.on)return {ok:false,code:'disabled'};
    const closed=db.state==='done'||item in db.outcome;
    if(!item.startsWith('sent:')){
     if(db.claims[item])return {ok:true,claim:db.claims[item]};
     if(closed)return {ok:false,code:'closed'};
     db.claims[item]={op,payload};return {ok:true,claim:db.claims[item]};
    }
    if(closed)return db.claims[item]?{ok:true,claim:db.claims[item]}:{ok:false,code:'closed'};
    if(Object.values(db.attempts).some(i=>i!==item)||Object.keys(db.claims).some(c=>c.startsWith('sent:')&&c!==item&&!(`fail:${c.slice(5)}` in db.outcome)))return {ok:false,code:'busy'};
    db.claims[item]??={op,payload};
    const attempt=randomUUID();db.attempts[attempt]=item;
    return {ok:true,claim:{...db.claims[item],attempt}};
   },
   releaseCard:async(_m:string,_id:string,attempt:string)=>{if(o.hangBookkeeping)await stuck();delete db.attempts[attempt];},
   recordCard:async(_m:string,_id:string,item:string,value:unknown,close:boolean)=>{
    if(o.hangBookkeeping)await stuck();
    if(!db.claims[item]&&!(item.startsWith('fail:')&&db.claims[`sent:${item.slice(5)}`]))return {ok:false,code:'invalid'};
    if(!(item in db.outcome))db.outcome[item]=value;
    if(close)db.state='done';
    return {ok:true,card:cardNow(),replayed:false};
   }};
  if(name==='./registry')return registryModule;
  if(name==='./copy')return copyModule;
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>true};
  if(name==='@/lib/patient/zoe-app-v3')return {medicinesCardEnabled:()=>true,zoeAppV3Enabled:()=>true};
  if(name==='./bp-flow')return {RED_FLAG_QUESTIONS:['chest_pain']};
  if(name==='./bp-flow-server')return {answerRedFlag:async()=>({status:'invalid'}),runBpFlow:async()=>null};
  throw Error(`Unexpected boundary in actions.ts: ${name}`);
 }});
 return {db,sent,nurseTasks,measurements,urgent,later,cardId,send:exports.sendFromCard as (i:unknown)=>Promise<{status:string}>,bp:exports.recordBpFromCard as (i:unknown)=>Promise<{status:string}>};
}
{// ZCA-04: a failed send, an edit, a new confirm: the new text is the one sent (and so screened); the old one is never substituted.
 const h=harness('message',['rate_limited'],{gateMisses:true});
 assert.equal((await h.send({kind:'message',cardId:h.cardId,requestId:randomUUID(),text:'Please contact me'})).status,'rate_limited');
 const r=await h.send({kind:'message',cardId:h.cardId,requestId:randomUUID(),text:'I have chest pain right now'});
 assert.equal(r.status,'ok');
 assert.deepEqual(h.sent.map(x=>x.text),['Please contact me','I have chest pain right now'],'the edited text is sent, not the claimed one');
 assert.ok(h.sent.every(x=>x.toDoctor),'card messages go to the care team');
}
{const h=harness('side_effect',['rate_limited'],{gateMisses:true});
 await h.send({kind:'side_effect',cardId:h.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail:''});
 await h.send({kind:'side_effect',cardId:h.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail:'and chest pain now'});
 assert.equal(h.sent.at(-1)!.text,'Side effect: Dizziness. and chest pain now','an edited side-effect detail is what is sent');
}
{// Monika, 2 Nov: a nurse task only after the message is really stored, and never on the urgent path.
 const h=harness('side_effect');
 const stored=await h.send({kind:'side_effect',cardId:h.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail:''});
 assert.equal(stored.status,'ok');assert.equal(h.sent.length,1,'the doctor still gets the message');assert.deepEqual(h.nurseTasks.map(x=>x.what),['dizziness']);
 const failed=harness('side_effect',['failed']);
 await failed.send({kind:'side_effect',cardId:failed.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail:''});
 assert.equal(failed.nurseTasks.length,0,'a send that may not have stored makes no task');
 const urgent=harness('side_effect');
 await urgent.send({kind:'side_effect',cardId:urgent.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail:'and chest pain now'}).catch(()=>null);
 assert.equal(urgent.urgent.length,1,'urgent words open the 103 screen');assert.equal(urgent.nurseTasks.length,0,'the urgent path makes no task');
 const message=harness('message');
 await message.send({kind:'message',cardId:message.cardId,requestId:randomUUID(),text:'Please contact me'});
 assert.equal(message.nurseTasks.length,0,'an ordinary message makes no task');
}
{// Review-3: a different text while an earlier one may still be sending (a transient failure) is not sent.
 const h=harness('message',['failed']);
 await h.send({kind:'message',cardId:h.cardId,requestId:randomUUID(),text:'First text'});
 assert.equal((await h.send({kind:'message',cardId:h.cardId,requestId:randomUUID(),text:'Second text'})).status,'busy');
 assert.deepEqual(h.sent.map(x=>x.text),['First text'],'one send in flight per card');
}
{// ZCA-01: the same text from two tabs (different request ids) and a retry send one request id.
 const h=harness('message',['failed']);
 const [a,b]=[randomUUID(),randomUUID()];
 await h.send({kind:'message',cardId:h.cardId,requestId:a,text:'Same text'});
 await h.send({kind:'message',cardId:h.cardId,requestId:b,text:'Same text'});
 assert.deepEqual([...new Set(h.sent.map(x=>x.requestId))],[a],'one request id for one text, so conversation_receive stores it once');
 assert.equal((await h.send({kind:'message',cardId:h.cardId,requestId:b,text:'Another text'})).status,'closed','a sent card takes no second message');
}
// ZCA-POST-01: after a refused send, a retry of that text and an edited text never both reach the chat send.
const gate=(status:string)=>{let open!:()=>void;const p=new Promise<void>(r=>{open=r;});return {open,run:async()=>{await p;return status;}};};
const msg=(h:ReturnType<typeof harness>,text:string,requestId:string=randomUUID())=>h.send({kind:'message',cardId:h.cardId,requestId,text});
{// Retry A in flight, then B: B is busy; only A is sent.
 const g=gate('sent'),h=harness('message',['rate_limited',g.run]);
 assert.equal((await msg(h,'Text A')).status,'rate_limited');
 const retry=msg(h,'Text A');
 assert.equal((await msg(h,'Text B')).status,'busy','an edited text waits while a retry of the refused one is in flight');
 g.open();assert.equal((await retry).status,'ok');
 assert.deepEqual([...new Set(h.sent.map(x=>x.text))],['Text A'],'one distinct message');
 assert.deepEqual(h.db.attempts,{},'the lease is released');
}
{// B in flight, then retry A: the retry is busy; only B is sent.
 const g=gate('sent'),h=harness('message',['rate_limited',g.run]);
 await msg(h,'Text A');
 const b=msg(h,'Text B');
 assert.equal((await msg(h,'Text A')).status,'busy','a retry of a refused text waits while another text is in flight');
 g.open();assert.equal((await b).status,'ok');
 assert.deepEqual(h.sent.map(x=>x.text),['Text A','Text B']);
 assert.equal((await msg(h,'Text A')).status,'closed','a sent card takes no second message');
}
{// Two retries of A overlap and one is refused while the other is still going: B still waits.
 const g1=gate('rate_limited'),g2=gate('sent'),h=harness('message',['rate_limited',g1.run,g2.run]);
 await msg(h,'Text A');
 const r1=msg(h,'Text A'),r2=msg(h,'Text A');
 g1.open();assert.equal((await r1).status,'rate_limited');
 assert.equal((await msg(h,'Text B')).status,'busy','a refusal releases only its own attempt');
 g2.open();assert.equal((await r2).status,'ok');
 assert.deepEqual([...new Set(h.sent.map(x=>x.text))],['Text A']);
 assert.equal(new Set(h.sent.map(x=>x.requestId)).size,1,'the retries replay one request id');
}
{// A send that throws (not the urgent redirect) still releases its lease.
 const h=harness('message',[async()=>{throw Error('network');}]);
 await assert.rejects(msg(h,'Text A'));
 assert.deepEqual(h.db.attempts,{});
}
{// ZCA-01: BP from two tabs with different numbers: one reading; the second tab is told it changed.
 const h=harness('bp');
 const at=new Date(Date.now()-60_000).toISOString();
 assert.equal((await h.bp({cardId:h.cardId,submissionId:randomUUID(),systolic:121,diastolic:79,pulse:null,measuredAt:at})).status,'ok');
 assert.equal((await h.bp({cardId:h.cardId,submissionId:randomUUID(),systolic:131,diastolic:85,pulse:null,measuredAt:at})).status,'stale');
 assert.deepEqual(h.measurements.map(m=>m.systolic),[121]);
}
{// ZCA-02: switched off, nothing is written or sent.
 const h=harness('message');h.db.on=false;
 assert.equal((await h.send({kind:'message',cardId:h.cardId,requestId:randomUUID(),text:'Hello'})).status,'disabled');
 assert.equal(h.sent.length,0);
 const b=harness('bp');b.db.on=false;
 assert.equal((await b.bp({cardId:b.cardId,submissionId:randomUUID(),systolic:121,diastolic:79,pulse:null,measuredAt:new Date().toISOString()})).status,'disabled');
 assert.equal(b.measurements.length,0);
}
// Test gap 1: red wins over the card. Urgent words open the 103 screen whatever state the card is in; the blocked text
// never takes the ordinary send. Text that is not urgent keeps the card's own answer.
{// A send that failed ambiguously holds its claim: an edited urgent text is blocked by the card, not by the chat.
 const h=harness('message',['failed']);
 assert.equal((await msg(h,'Please contact me')).status,'failed');
 assert.equal((await msg(h,'Please call tomorrow')).status,'busy','the claim is still held, so ordinary text waits');
 await assert.rejects(msg(h,URGENT_TEXT),opensUrgent,'urgent text opens the 103 screen while the claim is blocked');
 assert.deepEqual(h.urgent.map(u=>[u.text,u.toDoctor]),[[URGENT_TEXT,true]],'stored once through the urgent path, for the care team');
 assert.match(h.urgent[0]!.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,'a request id the chat accepts');
 // Astra TG-R2: the same urgent text from a second tab replays one request id, so the conversation stores it once.
 await assert.rejects(msg(h,URGENT_TEXT),opensUrgent,'both tabs reach the 103 screen');
 assert.equal(new Set(h.urgent.map(u=>u.requestId)).size,1,'one request id for one text on one card');
 assert.deepEqual(h.sent.map(x=>x.text),['Please contact me'],'no second ordinary message');
}
{// The same on a side-effect card, whose text is built from the member's detail.
 const h=harness('side_effect',['failed']);
 const se=(detail:string)=>h.send({kind:'side_effect',cardId:h.cardId,requestId:randomUUID(),locale:'en',what:'dizziness',detail});
 assert.equal((await se('')).status,'failed');
 await assert.rejects(se(URGENT_TEXT),opensUrgent,'urgent detail wins over a blocked side-effect card');
 assert.equal(h.sent.length,1);
}
{// A card already sent ("closed"), the card store down ("unavailable"), the feature off and a lost session: all still red.
 const closed=harness('message');
 assert.equal((await msg(closed,'Thanks')).status,'ok');
 assert.equal((await msg(closed,'One more thing')).status,'closed');
 await assert.rejects(msg(closed,URGENT_TEXT),opensUrgent,'a closed card');
 const off=harness('message');off.db.on=false;
 await assert.rejects(msg(off,URGENT_TEXT),opensUrgent,'the feature switched off');
 const unreadable=harness('message');unreadable.db.cardReadable=false;
 await assert.rejects(msg(unreadable,URGENT_TEXT),opensUrgent,'the card store unreadable');
 assert.equal((await msg(unreadable,'Please contact me')).status,'invalid','ordinary text keeps the card answer');
 const signedOut=harness('message');signedOut.db.signedIn=false;
 await assert.rejects(msg(signedOut,URGENT_TEXT),opensUrgent,'no card actor');
 assert.equal((await msg(signedOut,'Please contact me')).status,'signed_out','ordinary text says the sign-in ended (BC-05)');
 for(const h of [closed,off,unreadable,signedOut])assert.equal(h.sent.filter(x=>x.text===URGENT_TEXT).length,0,'urgent text never takes the ordinary send');
}
// Test gap 2: the redirect is never held by card bookkeeping. Budget: well under the chat's 3 s bounded store.
const within=async(p:Promise<unknown>,ms:number)=>{
 let timer!:NodeJS.Timeout;
 const clock=new Promise<'late'>(r=>{timer=setTimeout(()=>r('late'),ms);});
 try{return await Promise.race([p.then(()=>'returned',e=>e),clock]);}finally{clearTimeout(timer);}
};
{// The chat's send throws the redirect (red only at the send); recording and releasing hang.
 const h=harness('message',[async()=>{throw urgentRedirect();}],{gateMisses:true,hangBookkeeping:true});
 const r=await within(msg(h,'A text only the send finds urgent'),300);
 assert.ok(r!=='late','a hung card record or release does not hold the redirect');
 assert.ok(opensUrgent(r),'the original redirect goes on');
}
{// The card still notes the urgent text, and frees its lease, once the 103 screen is on its way.
 const h=harness('message',[async()=>{throw urgentRedirect();}],{gateMisses:true});
 await assert.rejects(msg(h,'A text only the send finds urgent'),opensUrgent);
 await Promise.all(h.later.map(f=>f()));
 assert.equal((Object.values(h.db.outcome)[0] as {urgent?:boolean}).urgent,true,'the card says it went to the urgent screen');
 assert.equal(h.db.state,'done');assert.deepEqual(h.db.attempts,{},'the lease is released');
}
{// The usual way: the red check in front, with card bookkeeping that hangs.
 const h=harness('message',[],{hangBookkeeping:true});
 const r=await within(msg(h,URGENT_TEXT),300);
 assert.ok(r!=='late'&&opensUrgent(r),'the red check does not wait for the card');
 assert.equal(h.sent.length,0);
}
{const h=harness('message');
 await assert.rejects(msg(h,URGENT_TEXT),opensUrgent);
 await Promise.all(h.later.map(f=>f()));
 assert.equal((Object.values(h.db.outcome)[0] as {urgent?:boolean}).urgent,true,'an open card notes it afterwards');
 assert.equal(h.db.state,'done');assert.deepEqual(h.db.attempts,{},'and holds no lease');
}
// Test gap 7: the card's submission id survives a failed save, so changed numbers come back with the same id.
{const h=harness('bp',[],{measure:[{ok:false}]});
 const submissionId=randomUUID(),at=new Date(Date.now()-60_000).toISOString();
 const first={cardId:h.cardId,submissionId,systolic:121,diastolic:79,pulse:null,measuredAt:at};
 assert.equal((await h.bp(first)).status,'failed');
 const changed=await h.bp({...first,systolic:131,diastolic:85,pulse:70,measuredAt:new Date().toISOString()});
 assert.equal(changed.status,'stale','changed numbers are an explicit conflict, never a silent save of the earlier ones');
 assert.equal(h.measurements.length,0,'nothing saved for numbers the member no longer confirms');
 assert.equal(Object.keys(h.db.outcome).length,0,'the card records nothing');
 // The same numbers again are a plain retry, which saves the claimed reading once.
 assert.equal((await h.bp(first)).status,'ok');
 assert.equal(h.measurements.length,1);assert.equal(h.measurements[0]!.systolic,121);
}
console.log('check-zoe-chat-actions: all checks passed');
