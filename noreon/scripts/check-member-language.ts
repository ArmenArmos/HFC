/** Offline regression: stored clinic instructions must not cross member language boundaries. */
import assert from 'node:assert/strict';
import {buildOverview,type OverviewFacts} from '@/lib/patient/overview';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LabVisitCard,SavedLabTurn} from '@/components/chat-v2/lab-visit-card';
import {telegramCardView,telegramStaleView} from '@/lib/zoe-chat-actions/telegram';
import {cardSchema,type ValidCard} from '@/lib/zoe-chat-actions/registry';
import {isTextUsableInLocale,memberInstruction,textScripts} from '@/lib/text-language';
import {MEMBER_LANGUAGE} from '@/lib/patient/copy';
import type {Locale} from '@/lib/locale';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {runLabReply} from '@/lib/zoe-chat-actions/labs';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import type {LabReplyInput} from '@/lib/zoe-chat-actions/labs-contract';
import {LAB_VISIT} from '@/lib/zoe-chat-actions/lab-visit-copy';
import ts from 'typescript';
import {MemberOverview} from '@/components/chat-v2/overview';
import {BookingCoverage,BookingProgram} from '@/components/real-booking/appointment-status';
import {BookingTests} from '@/components/real-booking/booking-tests';
import {TestOrders} from '@/components/patient-care/test-orders';
import {NextStepCard} from '@/components/chat-v2/next-step-card';
import {memberJourneyStep,type JourneyInput} from '@/lib/patient/next-step';
import {appointmentSchema} from '@/lib/real-booking/appointment-schema';
import {LdlGoalCard} from '@/components/patient-care/ldl-goal-card';
import {AppRouterContext,type AppRouterInstance} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {CareHistory} from '@/components/patient-care/care-history';
import {ApprovedPlan,MedicationSchedule} from '@/components/patient-care/care-layout';
import {MemberMonitoring} from '@/components/patient-care/member-monitoring';
import {DailyRoutine} from '@/components/patient-care/daily-routine';
import {PublishedReviewCard} from '@/components/real-review/published-review-card';
import type {PublishedReview} from '@/lib/patient-care/published-review';
import type {CareData,Medication} from '@/lib/patient-care/types';
import {memberMonitoring,type MonitoringRequirement} from '@/lib/service-workflow/follow-up';
const english = 'STAGING. Come fasting. Bring your ID.';
const now = new Date('2026-11-06T08:00:00Z');
for (const locale of ['hy','ru'] as const) {
  const facts: OverviewFacts = {
    now,locale,name:'',doctor:null,consent:true,questionnaireComplete:true,
    care:{plan:null,events:[],appointments:[],tests:[{id:'test',title:'LDL-C',preparation:english,status:'booked',orderedBy:'Clinic',orderedAt:now.toISOString(),dueAt:null,location:null,source:'clinic',sourceLabel:'Clinic'}]},
    home:null,clinicBp:null,bpWeek:null,ldl:undefined,medicines:null,uploaded:null,released:null,
    labResultsReceived:false,visitDone:false,
    bookedVisit:{startsAt:'2026-11-07T08:00:00Z',clinic:'Noreon',location:null,preparation:english},
  };
  const output = buildOverview(facts);
  assert.ok(!JSON.stringify(output.upcoming).includes(english), `${locale}: overview leaks English preparation`);
  assert.equal(output.upcoming.labs[0].title,'LDL-C');
  assert.equal(output.upcoming.visit?.startsAt,facts.bookedVisit!.startsAt);
}

const uuid = '00000000-0000-4000-8000-000000000001';
const startsAt = '2026-11-07T08:00:00Z';
const makeCard = (kind:string,snapshot:unknown) => {
  const card=cardSchema.parse({id:uuid,requestId:uuid,kind,source:'chip',sourceSeq:null,state:'open',outcome:{},at:now.toISOString(),snapshot});
  assert.ok(card.valid, `${kind}: valid fixture`);
  return card;
};
const prepCard=makeCard('prep',{v:1,appointmentId:uuid,revision:1,startsAt,location:'Noreon',preparation:english}) as Extract<ValidCard,{kind:'prep'}>;
for(const locale of ['hy','ru'] as const){
  const html=renderToStaticMarkup(React.createElement(LabVisitCard,{card:prepCard,locale,onCard:()=>{},onAct:()=>{}}));
  assert.ok(!html.includes(english),`${locale}: lab card leaks English`);
  const saved={...prepCard,state:'done' as const,outcome:{prep:{answer:'read'}}};
  const receipt=renderToStaticMarkup(React.createElement(SavedLabTurn,{card:saved,locale,time:'12:00'}));
  assert.ok(!receipt.includes(english),`${locale}: saved lab turn leaks English`);
  for(const status of ['provider-proposed','confirmed','change-pending']){
    const terms={provider:'Noreon',startsAt,endsAt:'2026-11-07T09:00:00Z',preparation:english};
    const card=makeCard('ldl',{v:1,data:{version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],retest:{id:uuid,dueFrom:'2026-11-07',dueTo:'2026-11-10',state:'requested',overdue:false,request:{id:uuid,revision:1,status,algorithmVersion:'fixture',proposal:status==='provider-proposed'?terms:null,arrangement:status==='provider-proposed'?null:terms}}}});
    for(const view of [telegramCardView(card,locale),telegramStaleView(card,locale)]){
      assert.ok(view&&!view.text.includes(english),`${locale}: Telegram ${status} leaks English`);
      assert.ok(view.text.includes('07.11.2026'),'Visit date stays');
    }
  }
}

for(const [text,locale,expected] of [
  [english,'hy',false],[english,'ru',false],[english,'en',true],
  ['Պատրաստվեք այցին։','hy',true],['Պատրաստվեք այցին։','ru',false],['Պատրաստվեք այցին։','en',false],
  ['Прочитайте ваши рекомендации.','ru',true],['Прочитайте ваши рекомендации.','hy',false],['Прочитайте ваши рекомендации.','en',false],
  ['123 / 08:00 (12.5)','hy',true],['','ru',true],['ID PDF mg mmol/L','hy',false],
  ['Վերցրեք ձեր ID-ն, PDF-ը։ LDL-C՝ 2.5 mmol/L, 10 mg։','hy',true],
  ['Возьмите ваш ID и PDF. LDL-C: 2.5 mmol/L, 10 mg.','ru',true],
  ['Ձեր այցը Noreon կլինիկայում է։ John Smith կդիմավորի ձեզ։','hy',false],
  ['Вас встретит John Smith в Noreon.','ru',false],
  ['Ընդունեք atorvastatin 10 mg երեկոյան։','hy',true],
  ['Принимайте atorvastatin 10 mg вечером.','ru',true],
  ['Ընդունեք rosuvastatin 10 mg երեկոյան։ LDL-C՝ 2.5 mmol/L։','hy',true],
  ['Принимайте rosuvastatin 10 mg вечером. Ваш LDL-C: 2.5 mmol/L.','ru',true],
  ['Ձեր հետազոտությունը՝ Creatinine, eGFR։','hy',true],
  ['Ваш анализ: Creatinine, eGFR.','ru',true],
  ['Ձեր այցը՝ Come Fasting','hy',false],
  ['Ваш визит: Take Aspirin','ru',false],
  ['Ձեր այցը։ Come fasting. Bring your ID.','hy',false],
  ['Ваш визит. Come fasting. Bring your ID.','ru',false],
  ['Ձեր այցը։ Come fasting.','hy',false],['Ваш визит. Bring your ID.','ru',false],
  ['Ձեր այցը։ Не ешьте перед визитом.','hy',false],['Ваш визит։ Պատրաստվեք այցին։','ru',false],
  ['Your visit։ Պատրաստվեք այցին։','en',false],['Your visit. Не ешьте.','en',false],
  ['Ձեր այցը։ STAGING. Come fasting.','hy',false],['Վերցրեք 10 mg։','hy',true],
] satisfies [string,Locale,boolean][]){
  assert.equal(isTextUsableInLocale(text,locale),expected,`${locale}: ${text}`);
  assert.equal(memberInstruction(text,locale),expected?text:MEMBER_LANGUAGE.pendingInstruction[locale]);
}
assert.deepEqual(textScripts('08:00: Հայերեն, русский, Latin'),['armenian','cyrillic','latin']);

// Only known brands, analyte identifiers and units may join a run of Latin words.
const allowedLatin=new Set(['noreon','zoe','ldl','hdl','c','bp','bmi','id','pdf','mg','mmol','l','mmhg','ecg','hba','egfr']);
function hasLatinSentence(text:string):boolean{
  return (text.match(/[A-Za-z]+(?:[\s\d/.,:;()\-]+[A-Za-z]+)*/g)??[])
    .some(run=>(run.match(/[A-Za-z]+/g)??[]).filter(word=>!allowedLatin.has(word.toLowerCase())).length>=3);
}
/** Inspect literal locale properties and factory argument positions, including template chunks. */
function copyLeaks(source:string,file:string):string[]{
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const factories=new Map<string,string[]>();
  const collect=(node:ts.Node)=>{
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isArrowFunction(node.initializer)){
      const params=node.initializer.parameters.map(p=>p.name.getText(tree));
      if(['en','hy','ru'].every(l=>params.includes(l)))factories.set(node.name.text,params);
    }
    ts.forEachChild(node,collect);
  };
  collect(tree);
  const leaks:string[]=[];
  const check=(node:ts.Node,locale:string)=>{
    if(ts.isTemplateExpression(node)){
      const literal=[node.head.text,...node.templateSpans.map(span=>span.literal.text)].join(' ');
      if(hasLatinSentence(literal))leaks.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1} ${locale}`);
      return;
    }
    if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
      if(hasLatinSentence(node.text))leaks.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1} ${locale}`);
    }
    ts.forEachChild(node,n=>check(n,locale));
  };
  const visit=(node:ts.Node)=>{
    if(ts.isPropertyAssignment(node)&&['hy','ru'].includes(node.name.getText(tree).replace(/['"]/g,'')))check(node.initializer,node.name.getText(tree));
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)){
      const params=factories.get(node.expression.text);
      if(params)node.arguments.forEach((arg,i)=>{if(params[i]==='hy'||params[i]==='ru')check(arg,params[i]);});
    }
    ts.forEachChild(node,visit);
  };
  visit(tree);
  return leaks;
}
assert.ok(copyLeaks("const c=(en,hy,ru)=>({en,hy,ru}); const a=c('Fine','Come fasting bring ID','Можно прийти');",'fixture.ts').length);
assert.ok(copyLeaks("const a={ru:`Ваш визит. Come fasting bring ID ${date}`};",'fixture.ts').length);
assert.ok(copyLeaks("const a={ru:`Bring ${time} your ID now`};",'fixture.ts').length,'Template slots cannot hide a Latin sentence');
assert.deepEqual(copyLeaks("const a={hy:'Noreon Zoe LDL mmol/L',ru:'Ваш визит в Noreon'};",'fixture.ts'),[]);
const copyFiles=readdirSync('lib/zoe-chat-actions').filter(f=>f.endsWith('copy.ts'));
const leaks=copyFiles.flatMap(file=>copyLeaks(readFileSync(`lib/zoe-chat-actions/${file}`,'utf8'),file));
assert.deepEqual(leaks,[],'HY/RU copy contains a Latin sentence of 3+ words');

const program=[{id:'custom',title:'LDL-C',method:'lab' as const,preparation:english}];
const arrangement={coveredTestIds:['custom'],preparation:english,followUps:[{testId:'custom',owner:'Noreon',action:english,reference:'fixture'}]};
const router:AppRouterInstance={bfcacheId:'fixture',back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
const render=(node:React.ReactNode)=>renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},node));
const plain=(html:string)=>html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ');
function assertLocalized(output:string,locale:'hy'|'ru',surface:string){
  assert.ok(!output.includes(english),`${locale}: ${surface} leaked raw instructions`);
  assert.ok(!hasLatinSentence(plain(output)),`${locale}: ${surface} contains a Latin sentence`);
  assert.ok(output.includes(MEMBER_LANGUAGE.pendingInstruction[locale]),`${locale}: ${surface} says instructions are pending`);
}
for(const locale of ['hy','ru'] as const){
  const props={locale};
  assertLocalized(render(React.createElement(BookingCoverage,{...props,arrangement,program})),locale,'booking coverage');
  assertLocalized(render(React.createElement(BookingProgram,{...props,program})),locale,'booking program');
  assertLocalized(render(React.createElement(BookingTests,{...props,program,appointments:[]})),locale,'booking tests');
  const facts:OverviewFacts={now,locale,name:'',doctor:null,consent:true,questionnaireComplete:true,care:{plan:null,events:[],appointments:[],tests:[{id:'custom',title:'LDL-C',preparation:english,status:'booked',orderedBy:'Noreon',orderedAt:now.toISOString(),dueAt:startsAt,location:null,source:'clinic',sourceLabel:'Noreon'}]},home:null,clinicBp:null,bpWeek:null,ldl:undefined,medicines:null,uploaded:null,released:null,labResultsReceived:false,visitDone:false,bookedVisit:{startsAt,clinic:'Noreon',location:'123',preparation:english}};
  const overview=buildOverview(facts);
  const html=render(React.createElement(MemberOverview,{locale,data:overview}));
  assertLocalized(html,locale,'overview screen');
  assert.ok(html.includes('LDL-C'),'Test identity stays on screen');
  assert.ok(html.includes('123'),'Place stays on screen');
  assertLocalized(render(React.createElement(TestOrders,{locale,tests:facts.care!.tests})),locale,'test orders');
  const cardHtml=render(React.createElement(LabVisitCard,{card:prepCard,locale,onCard:()=>{},onAct:()=>{}}));
  assertLocalized(cardHtml,locale,'lab preparation');
  assert.ok(!cardHtml.includes('type="checkbox"'),'Missing language cannot be marked as read preparation');
  const local=locale==='hy'?'Ձեր այցից առաջ կարդացեք ցուցումները։':'Перед вашим визитом прочитайте рекомендации.';
  const localCard={...prepCard,snapshot:{...prepCard.snapshot,preparation:local}};
  const localHtml=render(React.createElement(LabVisitCard,{card:localCard,locale,onCard:()=>{},onAct:()=>{}}));
  assert.ok(localHtml.includes(local),'Usable instructions stay unchanged');
  assert.ok(localHtml.includes('type="checkbox"'),'Usable preparation remains actionable');
  // A historic next-step snapshot can predate the fix or the member's language change.
  const step=makeCard('next_step',{v:1,stage:'fixture',title:{en:'Your visit',hy:'Ձեր այցը',ru:'Ваш визит'},detail:{en:english,hy:english,ru:english},button:{en:'See visit',hy:'Տեսնել այցը',ru:'Посмотреть визит'},target:'visit',doctorInLoop:false}) as Extract<ValidCard,{kind:'next_step'}>;
  assertLocalized(render(React.createElement(NextStepCard,{card:step,locale,onCard:()=>{},onAct:()=>{},onMessage:()=>{}})),locale,'historic next step');
  const details={offerId:uuid,offerVersion:'fixture',startsAt,endsAt:'2026-11-07T09:00:00Z',mode:'clinic',clinicId:uuid,timezone:'Asia/Yerevan',location:'123',preparation:english,preparationVersion:'fixture',coveredTestIds:['custom'],followUps:[]};
  const appointment=appointmentSchema.parse({version:'email-pilot-v1',id:uuid,memberId:uuid,revision:1,status:'confirmed',noticeId:uuid,program,createdAt:now.toISOString(),current:details,proposed:details});
  const input:JourneyInput={questionnaireComplete:true,review:null,appointments:[appointment],clinics:{[uuid]:'Noreon'},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now};
  const journey=memberJourneyStep(input);
  assert.ok(journey);
  assertLocalized(journey.detail[locale],locale,'journey next action');
  assert.ok(journey.detail[locale].includes('Noreon'),'Named clinic stays');
  assert.ok(journey.title[locale].includes('7'),'Visit date stays');
  const ldl=makeCard('ldl',{v:1,data:{version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],retest:{id:uuid,dueFrom:'2026-11-07',dueTo:'2026-11-10',state:'requested',overdue:false,request:{id:uuid,revision:1,status:'confirmed',algorithmVersion:'fixture',proposal:null,arrangement:{provider:'Noreon',startsAt,endsAt:'2026-11-07T09:00:00Z',preparation:english}}}}});
  assertLocalized(telegramCardView(ldl,locale)!.text,locale,'Telegram preparation');
  const tgPlan=makeCard('plan',{v:1,available:true,plan:{id:uuid,version:1,clinician:'Noreon',publishedAt:now.toISOString(),instructions:english,medicines:[]}});
  assertLocalized(telegramCardView(tgPlan,locale)!.text,locale,'Telegram plan');
  const tgNotice=makeCard('menu',{v:1,line:english});
  assertLocalized(telegramCardView(tgNotice,locale)!.text,locale,'Telegram historic notice');
}
const staff=render(React.createElement(BookingCoverage,{arrangement,program,locale:'hy',audience:'staff'}));
assert.ok(staff.includes(english),'Staff instructions remain available unchanged');
const en=render(React.createElement(BookingCoverage,{arrangement,program,locale:'en'}));
assert.ok(en.includes(english),'English member instructions remain unchanged');


for(const locale of ['hy','ru'] as const){
  for(const status of ['provider-proposed','confirmed','change-pending']){
    const terms={provider:'Noreon',startsAt,endsAt:'2026-11-07T09:00:00Z',preparation:english};
    const card=makeCard('ldl',{v:1,data:{version:'ldl-member-v1',enabled:true,inPathway:true,goal:null,observations:[],retest:{id:uuid,dueFrom:'2026-11-07',dueTo:'2026-11-10',state:'requested',overdue:false,request:{id:uuid,revision:1,status,algorithmVersion:'fixture',proposal:status==='provider-proposed'?terms:null,arrangement:status==='provider-proposed'?null:terms}}}}) as Extract<ValidCard,{kind:'ldl'}>;
    assertLocalized(render(React.createElement(LdlGoalCard,{locale,data:card.snapshot.data??undefined})),locale,`web LDL ${status}`);
  }
  const native=locale==='hy'?'Ձեր այցը։':'Ваш визит.';
  for(const command of ['Bring ID.','Take Aspirin.','Come Fasting.']){
    assert.equal(isTextUsableInLocale(`${native} ${command}`,locale),false,`${locale}: standalone command is not a name`);
  }
}
// The shared history keeps staff wording; only the member caller opts into guarding.
for(const locale of ['hy','ru'] as const){
  const local=locale==='hy'?'Ընդունեք atorvastatin 10 mg երեկոյան։':'Принимайте atorvastatin 10 mg вечером.';
  const brand=locale==='hy'?'Ընդունեք lipitor 10 mg երեկոյան։':'Принимайте lipitor 10 mg вечером.';
  const named=locale==='hy'?'Ձեզ կդիմավորի John Smith։':'Вас встретит John Smith.';
  assert.equal(memberInstruction(named,locale,['John Smith']),named,'Names need explicit identifier context');
  assert.equal(memberInstruction(brand,locale,['lipitor']),brand,'Structured medicine names need no capitalization');
  const medicine:Medication={id:uuid,planId:uuid,name:'atorvastatin',dose:'10 mg',instructions:english,times:['20:00'],startDate:'2026-11-01',endDate:null,active:true};
  const plan={id:uuid,clinician:'Noreon',publishedAt:startsAt,instructions:english,explanation:english,acknowledgedAt:null,medications:[medicine],publishedReview:{instructions:english,explanation:english,followUp:english}};
  const care:CareData={plan:null,planHistory:[plan],medicationHistory:[medicine],events:[],tests:[],results:[],appointments:[]};
  assertLocalized(render(React.createElement(CareHistory,{care,locale,audience:'member'})),locale,'member history');
  assert.ok(render(React.createElement(CareHistory,{care,locale})).includes(english),'Staff history keeps original wording');
  const readAction=React.createElement('button',{'data-read-plan':true},'read');
  const unavailable=render(React.createElement(ApprovedPlan,{plan,locale,readAction}));
  assertLocalized(unavailable,locale,'approved plan');
  assert.ok(!unavailable.includes('data-read-plan'),'Withheld plan cannot be marked read');
  assert.ok(unavailable.includes('/patient/team?section=contact'),'Plan has care-team recovery');
  const requirement:MonitoringRequirement={id:uuid,case_id:uuid,created_at:now.toISOString(),starts_at:now.toISOString(),ends_at:startsAt,required_count:2,instructions:english,status:'active',actor_id:null,actor_label:'Noreon',acknowledged_at:null,revision:1,source_publication:1,current_publication:1};
  // Also exercise raw historical/projected records, rather than only new cards.
  const requirements=memberMonitoring([requirement],[],[]);
  const monitoring=render(React.createElement(MemberMonitoring,{requirements,locale,now:now.getTime()}));
  assertLocalized(monitoring,locale,'monitoring projection');
  assert.match(monitoring,/<button[^>]*disabled=""/,'Unavailable monitoring cannot be acknowledged');
  const routine=(m:Medication)=>render(React.createElement(DailyRoutine,{locale,hasPlan:true,occurrences:[{id:uuid,kind:'medication',dueAt:startsAt,reminderAt:startsAt,status:'upcoming',dose:{medication:m,dueAt:startsAt,status:'upcoming'}}]}));
  assertLocalized(routine(medicine),locale,'daily medicine reminder');
  for(const instruction of [local,brand]){
    const m={...medicine,name:instruction===brand?'lipitor':'atorvastatin',instructions:instruction};
    const p={...plan,instructions:instruction,explanation:instruction,medications:[m],publishedReview:{instructions:instruction,explanation:instruction,followUp:instruction}};
    const localCare={...care,planHistory:[p],medicationHistory:[m]};
    for(const html of [
      render(React.createElement(CareHistory,{care:localCare,locale,audience:'member'})),
      render(React.createElement(ApprovedPlan,{plan:p,locale,readAction})),
      render(React.createElement(MedicationSchedule,{plan:p,locale,doses:[],doseAction:()=>null})),
      routine(m),
      render(React.createElement(MemberMonitoring,{requirements:memberMonitoring([{...requirement,instructions:instruction}],[],[]),locale,now:now.getTime()})),
    ]){
      assert.ok(html.includes(instruction),`${locale}: usable medicine instruction stays visible`);
      assert.ok(!html.includes(MEMBER_LANGUAGE.pendingInstruction[locale]));
    }
    assert.ok(render(React.createElement(ApprovedPlan,{plan:p,locale,readAction})).includes('data-read-plan'),'Readable plan stays actionable');
  }
  for(const field of ['instructions','explanation','followUp'] as const){
    const publishedReview={instructions:local,explanation:local,followUp:local,[field]:english};
    assert.ok(!render(React.createElement(ApprovedPlan,{plan:{...plan,publishedReview},locale,readAction})).includes('data-read-plan'),`${field}: partial withholding blocks read acknowledgement`);
  }
  const custom=locale==='hy'?'Ընդունեք custombrand 10 mg երեկոյան։':'Принимайте custombrand 10 mg вечером.';
  const customMedicine={...medicine,name:'custombrand',instructions:custom};
  const customPlan={...plan,instructions:custom,explanation:custom,medications:[customMedicine],publishedReview:{instructions:custom,explanation:custom,followUp:custom}};
  const publication:PublishedReview={planId:uuid,publishedAt:startsAt,draft:{explanation:custom,instructions:custom,followUp:custom,medicationName:'custombrand',medicationDose:'10 mg',medicationInstructions:custom,medicationTimes:['20:00']},receipts:{},reports:[]};
  for(const html of [
    render(React.createElement(CareHistory,{care:{...care,planHistory:[customPlan],medicationHistory:[customMedicine]},locale,audience:'member'})),
    render(React.createElement(ApprovedPlan,{plan:customPlan,locale,readAction})),
    render(React.createElement(MedicationSchedule,{plan:customPlan,locale,doses:[],doseAction:()=>null})),
    routine(customMedicine),
    render(React.createElement(PublishedReviewCard,{publication,current:true,locale})),
  ])assert.ok(html.includes(custom)&&!html.includes(MEMBER_LANGUAGE.pendingInstruction[locale]),'Structured medicine identity preserves an unfamiliar brand');
  const tgCustom=makeCard('plan',{v:1,available:true,plan:{id:uuid,version:1,clinician:'Noreon',publishedAt:startsAt,instructions:custom,medicines:[{name:'custombrand',dose:'10 mg',times:['20:00']}]}});
  assert.ok(telegramCardView(tgCustom,locale)!.text.includes(custom),'Telegram uses structured medicine identity');
  for(const command of [locale==='hy'?'Ձեր այցը՝ Come Fasting':'Ваш визит: Take Aspirin']){
    const card={...prepCard,snapshot:{...prepCard.snapshot,preparation:command}};
    assert.ok(!render(React.createElement(LabVisitCard,{card,locale,onCard(){},onAct(){}})).includes(command));
    const notice=makeCard('menu',{v:1,line:command});
    assert.equal(telegramCardView(notice,locale)!.text.includes(command),false,'Telegram rejects commands after local headings');
  }
}

// Actual component handlers with isolated action ports. Never use a real service.
globalThis.fetch=(()=>{throw Error('Network forbidden in member language check');}) as typeof fetch;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
let activeLab=prepCard as Extract<ValidCard,{kind:'prep'|'fasting'}>;
const raised:unknown[]=[],planWrites:unknown[]=[],labWrites:unknown[]=[],monitoringWrites:unknown[]=[];
const actor=mintActor(uuid,'app');
const labPorts={
  readCard:async()=>activeLab,current:async()=>activeLab.snapshot,
  claim:async(_m:string,_c:string,_i:string,op:string,payload:Record<string,unknown>)=>({ok:true as const,claim:{op,payload}}),
  record:async(_m:string,_c:string,item:string,value:Record<string,unknown>)=>{labWrites.push(value);return {ok:true as const,replayed:false,card:{...activeLab,state:'done' as const,outcome:{[item]:value}}};},
  raise:async(input:unknown)=>{raised.push(input);return true;},
};
function load(file:string):Record<string,unknown>{
  file=resolve(file);if(cache.has(file))return cache.get(file)!;
  const exports:Record<string,unknown>={};cache.set(file,exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,crypto:globalThis.crypto,Date,Intl,setTimeout,clearTimeout,console,require(name:string):unknown{
    if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
    if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
    if(name==='@/lib/zoe-chat-actions/actions')return {};
    if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
    if(name==='@/lib/staff/monitoring-actions')return {acknowledgeMonitoring:async(id:string)=>{monitoringWrites.push(id);return {ok:true};}};
    if(name==='@/lib/zoe-chat-actions/labs-actions')return {answerLabCard:(input:LabReplyInput)=>runLabReply(actor,labPorts,input)};
    if(name==='@/lib/zoe-chat-actions/plan-actions')return {confirmPlanFromCard:async(input:unknown)=>{planWrites.push(input);return {status:'ok'};}};
    if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>null};
    if(name.startsWith('@/')||name.startsWith('.')){
      const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
      for(const ext of ['','.tsx','.ts'])if(existsSync(path+ext))return load(path+ext);
    }
    return native(name);
  }});return exports;
}
const {LabVisitCard:InteractiveLab}=load('components/chat-v2/lab-visit-card.tsx') as typeof import('../components/chat-v2/lab-visit-card');
const {PlanCard:InteractivePlan}=load('components/chat-v2/plan-card.tsx') as typeof import('../components/chat-v2/plan-card');
const {MemberMonitoring:InteractiveMonitoring}=load('components/patient-care/member-monitoring.tsx') as typeof import('../components/patient-care/member-monitoring');
for(const locale of ['hy','ru'] as const){
  let tree!:ReactTestRenderer;
  activeLab=makeCard('fasting',prepCard.snapshot) as typeof activeLab;
  await act(async()=>{tree=create(React.createElement(InteractiveLab,{card:activeLab,locale,onCard(){},onAct(){}}));});
  const ate=tree.root.findAllByType('button').find(button=>button.children.includes(LAB_VISIT.ate[locale]));
  assert.ok(ate,`${locale}: unavailable preparation retains I ate`);
  assert.notEqual(ate.props.disabled,true);
  assert.equal(tree.root.findByType('fieldset').props.disabled,false);
  const before=raised.length;
  await act(async()=>ate.props.onClick());
  assert.equal(raised.length,before+1,'I ate raises the fasting failure through the real command');
  assert.equal((raised.at(-1) as {reason:string}).reason,'fasting_failed');
  assert.equal((labWrites.at(-1) as {answer:string}).answer,'ate');
  await act(async()=>tree.unmount());
  await act(async()=>{tree=create(React.createElement(InteractiveLab,{card:prepCard,locale,onCard(){},onAct(){}}));});
  assert.equal(tree.root.findAllByType('button').length,0,'Unavailable preparation cannot be marked read');
  await act(async()=>tree.unmount());
  const local=locale==='hy'?'Ձեր այցից առաջ կարդացեք ցուցումները։':'Перед вашим визитом прочитайте рекомендации.';
  for(const [lifestyle,followUp,usable] of [[english,local,false],[local,english,false],[local,local,true]] as const){
    const card=makeCard('plan',{v:1,available:true,plan:{id:uuid,version:1,clinician:'Noreon',publishedAt:startsAt,instructions:local,medicines:[]},v3:{planId:uuid,version:1,teachBackConfirmedAt:null,clinician:'Noreon',publishedAt:startsAt,bp:null,ldl:null,lifestyle,followUp,calendar:[]}}) as Extract<ValidCard,{kind:'plan'}>;
    await act(async()=>{tree=create(React.createElement(InteractivePlan,{card,locale,onCard(){},onAct(){},onRefresh(){}}));});
    const button=tree.root.findByProps({'data-confirm-plan':true});
    assert.equal(button.props.disabled,!usable,'Teach-back requires readable lifestyle and follow-up');
    const before=planWrites.length;
    await act(async()=>button.props.onClick());
    assert.equal(planWrites.length,before+(usable?1:0),'Withheld content cannot submit comprehension metadata');
    await act(async()=>tree.unmount());
  }
  for(const instructions of [english,local]){
    const usable=instructions===local;
    const requirements=[{id:uuid,instructions,startsAt:now.toISOString(),endsAt:startsAt,requiredCount:2,status:'active' as const,doctor:'Noreon',createdAt:now.toISOString(),acknowledgedAt:null,received:0,missing:2,late:0}];
    await act(async()=>{tree=create(React.createElement(InteractiveMonitoring,{requirements,locale,now:now.getTime()}));});
    const button=tree.root.findByType('button');
    assert.equal(button.props.disabled,!usable);
    const before=monitoringWrites.length;
    await act(async()=>button.props.onClick());
    assert.equal(monitoringWrites.length,before+(usable?1:0),'Unavailable monitoring instructions cannot be recorded as read');
    await act(async()=>tree.unmount());
  }
}
console.log(`Member language: helper cases, ${copyFiles.length} copy files, HY/RU renders and isolated fasting/teach-back actions passed. No database or provider calls.`);
