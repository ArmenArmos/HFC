import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generatePlanDraft} from '@/lib/ai-plan/generate';
import {PLAN_SYSTEM,assembleDraft,guardProse} from '@/lib/ai-plan/compose';
import {buildSkeleton,type PlanInput} from '@/lib/ai-plan/skeleton';
import {createFakePlanProvider} from '@/lib/ai-plan/provider';

globalThis.fetch=(()=>{throw Error('Network forbidden in plan language regression');}) as typeof fetch;
const base:PlanInput={now:new Date('2026-11-07T10:00:00Z'),language:'en',profile:{birthDate:null,biologicalSex:null},assessment:{answers:{},completed_at:'2026-11-06T10:00:00Z',urgent_rule:null},measurements:[],visits:[],labValues:[],publications:[]};
const ctx={memberId:randomUUID(),doctorId:randomUUID(),revision:1,evidenceToken:'synthetic',labToken:'synthetic'};
async function run(memberLanguage:'en'|'hy'|'ru'|null,summaryLanguage:'en'|'hy'|'ru'){
 const stored:Record<string,unknown>[]=[];
 const outcome=await generatePlanDraft({...base,memberLanguage,summaryLanguage} as PlanInput,ctx,{route:null,providerFor:()=>null,rpc:async(name,args)=>{if(name==='ai_plan_reserve')return {ok:true,generationId:randomUUID()};stored.push(args.p_result as Record<string,unknown>);return {ok:true};}});
 assert.equal(outcome.ok,true);return stored.at(-1)! as {draft:ReturnType<typeof assembleDraft>;guard:string[]};
}
const hy=await run('hy','en'),en=await run('en','hy');
const sk=buildSkeleton(base);assert.notEqual(typeof sk,'string');if(typeof sk==='string')throw Error('fixture refused');
assert.deepEqual(hy.draft,assembleDraft(sk.items,'hy'),'Member Armenian draft follows member language even for English staff');
assert.deepEqual(en.draft,assembleDraft(sk.items,'en'),'Member English draft follows member language even for Armenian staff');
for(const member of [null,'ru'] as const){
 const result=await run(member,'ru');
 for(const field of ['explanation','instructions','followUp'] as const)assert.equal(result.draft[field],'','Unavailable member language never falls back to English');
 assert.ok(result.guard.includes(member===null?'member_language_unknown':'member_translation_missing:ru'));
}
const ru=buildSkeleton({...base,summaryLanguage:'ru'} as PlanInput);assert.notEqual(typeof ru,'string');if(typeof ru==='string')throw Error('fixture refused');
assert.equal(ru.facts.language,'ru','AI summary facts use staff UI language');
assert.match(PLAN_SYSTEM,/ru = Russian/,'Summary prompt explicitly supports Russian');
const fake=await createFakePlanProvider().write(ru.facts);assert.equal(fake.kind,'ok');if(fake.kind==='ok')assert.match((fake.object as {summary:string}).summary,/\p{Script=Cyrillic}/u);
console.log('Plan language: member/staff language separation, Armenian templates, unknown/RU withholding and Russian summary prompt passed. No network or database.');

// Invoke the real server action with isolated ports: assignment must be proven before profile read.
const {readFileSync}=await import('node:fs');
const {default:ts}=await import('typescript');
const {default:vm}=await import('node:vm');
const {planMemberLanguage,planLanguageWarning,missingPlanTranslations,planStaffLanguageLabel,planSummaryLanguage}=await import('@/lib/ai-plan/language');
for(const [profile,expected] of [[{locale:'hy'},'hy'],[{locale:'hy',ui_locale:'ru'},'ru'],[{locale:'en',ui_locale:'hy'},'hy'],[null,null],[{locale:'xx'},null]] as const)assert.equal(planMemberLanguage(profile),expected);
for(const locale of ['en','hy','ru'] as const){
 assert.ok(planLanguageWarning(['member_language_unknown'],locale));
 assert.equal(planStaffLanguageLabel(locale)===null,locale==='en','English items are labeled for other staff languages');
 assert.equal(planSummaryLanguage([`summary_language:${locale}`]),locale);
 assert.equal(planSummaryLanguage([]),null);
}
assert.ok(missingPlanTranslations(sk.items,'ru').includes('intro'));
assert.ok(missingPlanTranslations(sk.items,'ru').includes('protocol:annual-labs'));
assert.deepEqual(missingPlanTranslations(sk.items,'hy'),[],'Existing Armenian template text reused unchanged');
const actionCode=ts.transpileModule(readFileSync('lib/ai-plan/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
for(const profile of [{locale:'hy',ui_locale:null},{locale:'hy',ui_locale:'ru'},null]){
 const events:string[]=[],exports:Record<string,unknown>={};let captured:PlanInput|undefined;
 const snapshot={revision:1,evidenceToken:'synthetic',evidence:{profile:{birthDate:null,biologicalSex:null},assessment:base.assessment,measurements:[],visits:[]},publications:[]};
 const latest={id:ctx.memberId,evidenceToken:'synthetic',labToken:'synthetic',caseRevision:1};
 const service={from(table:string){assert.equal(table,'profiles');events.push('profile');return {select(columns:string){assert.equal(columns,'locale,ui_locale');return {eq(column:string,id:string){assert.equal(column,'id');assert.equal(id,ctx.memberId);return {maybeSingle:async()=>({data:profile,error:null})};}};}};}};
 const ports:Record<string,unknown>={
  '@/lib/locale':await import('@/lib/locale'),'./language':await import('@/lib/ai-plan/language'),
  'next/cache':{revalidatePath(){}},zod:await import('zod'),
  '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
  '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{id:ctx.doctorId,role:'doctor'},client:{rpc:async(name:string)=>{events.push(name);return {error:null,data:name==='patient_clinical_case_snapshot'?snapshot:{enabled:true,published:false,labValues:[],labToken:'synthetic'}};}}}),snapshotSchema:{safeParse:(data:unknown)=>({success:true,data})}},
  '@/lib/patient-care/clinical-publication-server':{clinicalWriteClient:()=>service},
  '@/lib/staff/staff-locale':{staffLocale:async()=>'ru'},'@/lib/staff/staff-locale-copy':await import('@/lib/staff/staff-locale-copy'),
  '@/lib/zoe/purpose-route':{},'@/lib/zoe/route-config':{},
  './contracts':{DRAFT_FIELDS:[],doctorPlanReadSchema:{safeParse:(data:unknown)=>({success:true,data})}},
  './generate':{generatePlanDraft:async(input:PlanInput)=>{captured=input;return {ok:true,generationId:ctx.memberId,mode:'protocol_only'};}},
  './provider':{planProviderMode:()=>'off'},'./server':{readDoctorAiPlan:async()=>({enabled:true,published:false,latest,labToken:'synthetic'})},
 };
 vm.runInNewContext(actionCode,{exports,Date,Error,require:(name:string)=>{assert.ok(name in ports,`Unexpected import ${name}`);return ports[name];}});
 const action=exports.prepareAiCarePlan as (id:string)=>Promise<{ok:boolean}>;
 assert.equal((await action(ctx.memberId)).ok,true);
 assert.ok(events.indexOf('patient_clinical_case_snapshot')<events.indexOf('profile'));
 assert.ok(events.indexOf('doctor_ai_plan_read')<events.indexOf('profile'));
 assert.equal(captured?.memberLanguage,profile?.ui_locale??profile?.locale??null);
 assert.equal(captured?.summaryLanguage,'ru');
 // Invalid/unauthorized reads must not reach member profile or generation.
 captured=undefined;events.length=0;
 assert.equal((await action('invalid')).ok,false);assert.equal(events.length,0);assert.equal(captured,undefined);
 const staff=ports['@/lib/patient-care/clinical-case-repository'] as {requireRealStaff:()=>Promise<unknown>};
 staff.requireRealStaff=async()=>({identity:{id:ctx.doctorId,role:'nurse'}});
 assert.equal((await action(ctx.memberId)).ok,false);assert.equal(events.length,0);assert.equal(captured,undefined);
 staff.requireRealStaff=async()=>({identity:{id:ctx.doctorId,role:'doctor'},client:{rpc:async()=>({error:{code:'42501'},data:null})}});
 assert.equal((await action(ctx.memberId)).ok,false);assert.equal(events.length,0);assert.equal(captured,undefined);
}
console.log('Real plan action: member profile locale source, Russian staff summary locale, assignment gates, invalid IDs and missing profile verified through isolated ports.');

// Run summary generation through the actual generator/provider/guard/record flow.
let recorded:Record<string,unknown>|undefined;
const modelOutcome=await generatePlanDraft({...base,language:'hy',memberLanguage:'hy',summaryLanguage:'ru'},ctx,{
 route:{tier:'medium',primary:{id:'synthetic',inputUsdPerMTok:0,outputUsdPerMTok:0},fallback:null},providerFor:()=>createFakePlanProvider(),
 rpc:async(name,args)=>{if(name==='ai_plan_reserve'){assert.equal(args.p_language,'hy','Legacy generation column keeps the member template language');return {ok:true,generationId:randomUUID()};}recorded=args.p_result as Record<string,unknown>;return {ok:true};},
});
assert.equal(modelOutcome.ok,true);const got=recorded as Record<string,unknown>|undefined;
 assert.equal(got?.mode,'model');
assert.match(recorded?.summary as string,/\p{Script=Cyrillic}/u);
assert.ok((got?.guard as string[]).includes('summary_language:ru'));
assert.deepEqual(recorded?.draft,assembleDraft(sk.items,'hy'),'Russian model summary never changes the Armenian member draft');
console.log('Russian summary: actual generator/fake provider/summary guard/record flow preserves Armenian member wording.');

// A writer can ignore the requested language. Keep the content and record the detected script.
for(const [summary,language] of [
 ['Several items need your judgement.','en'],
 ['Некоторые пункты требуют вашего решения.','ru'],
 ['Կետեր պետք է որոշում։','hy'],
 ['...','unknown'],
 ['Review Обзоры','unknown'],
 ['中文','unknown'],
 ['English explanation with Анна.','en'],
 ['Проверьте результат eGFR перед оценкой.','ru'],
] as const){
 recorded=undefined;
 const outcome=await generatePlanDraft({...base,memberLanguage:'en',summaryLanguage:'ru'},ctx,{
  route:{tier:'medium',primary:{id:'synthetic',inputUsdPerMTok:0,outputUsdPerMTok:0},fallback:null},
  providerFor:()=>createFakePlanProvider({fixture:{raw:{summary}}}),
  rpc:async(name,args)=>{if(name==='ai_plan_reserve')return {ok:true,generationId:randomUUID()};recorded=args.p_result as Record<string,unknown>;return {ok:true};},
 });
 assert.equal(outcome.ok,true);
 const got=recorded as Record<string,unknown>|undefined;
 assert.equal(got?.mode,'model','Language mismatch must not block a draft or drop content');
 assert.equal(got?.summary,summary);
 assert.ok((got?.guard as string[]).includes(`summary_language:${language}`),`Record actual script for ${language}, not the requested Russian`);
}

// Existing summary policy excludes medicines, treatment classes, doses and prescribing in every enabled language.
for(const summary of ['Назначьте амлодипин ежедневно.','Увеличьте дозировку.','Принимать по 5 мг.','Ингибиторы АПФ и блокаторы рецепторов.','Розувастатин и мочегонные.']){
 assert.equal(guardProse({summary},{language:'ru',value:5}).prose,null,`Russian medication/dose wording stays excluded: ${summary}`);
}
assert.ok(guardProse({summary:'Некоторые пункты требуют вашего решения.'},{language:'ru'}).prose);
