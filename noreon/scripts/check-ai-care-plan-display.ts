import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AiPlanPanel} from '@/components/staff/ai-plan-panel';
import {generationSchema} from '@/lib/ai-plan/contracts';
import {readDoctorAiPlan} from '@/lib/ai-plan/server';
import {planDisplayText,planSourceLabel} from '@/lib/ai-plan/display';

for(const locale of ['en','hy','ru'] as const){
 const text=planDisplayText('NRN-RULE-BP-002: Home average 135/85. Open question Q1 for Armen. Rules after tests (C1–C16) are pending (Q2). RF-06: urgency orange.',locale);
 assert.doesNotMatch(text,/NRN-|RF-06|Q[12]|C1|C16|\(\s*\)/);
 assert.match(text,/Home average 135\/85/);
 assert.match(text,/urgency orange/);
 assert.equal(planDisplayText('Suggested by the rules engine (NRN-RULE-BP-002, RF-06, NRN-RULE-HTN-001).',locale),'Suggested by the rules engine.');
 assert.equal(planDisplayText('Repeat 7 to 14 days after a start or dose increase.',locale),'Repeat 7 to 14 days after a start or dose increase.');
 const source={kind:'lab' as const,ref:'audit-value-id',label:'LDL-C · 2026-11-02'};
 assert.match(planSourceLabel(source,locale),/LDL-C · 2026-11-02/);
 assert.doesNotMatch(planSourceLabel(source,locale),/audit-value-id/);
 assert.equal(source.ref,'audit-value-id','Display keeps the audit reference intact');
 assert.equal(planSourceLabel({kind:'rule',ref:'NRN-RULE-BP-002',label:'NRN-CLIN-ALG-001'},locale),locale==='en'?'Questionnaire answer':locale==='hy'?'Հարցաշարի պատասխան':'Ответ на вопрос анкеты');
}
console.log('Care plan display: codes hidden, clinical numbers and timing retained, source labels/dates and audit references preserved in three languages.');

// The real reader joins a source to its report date without changing the RPC data or audit id.
const valueId='d1a00000-0000-4000-8000-000000000001';
const source={kind:'lab',ref:valueId,label:'LDL-C'};
const item={id:'lab:1',section:'assessment',status:'protocol',text:'LDL-C 5.2 mmol/L.',rationale:'Reviewed value outside the lab reference range.',source,timing:null,member:null};
const raw={version:'ai-plan-read-v1',enabled:true,attemptsToday:1,published:false,labToken:'lab-token',labValues:[{valueId,catalogueRef:'ldl_c',testName:'LDL-C',value:5.2,unit:'mmol/L',labFlag:'high',collectedOn:'2026-11-02' as string|null,attention:null,status:'verified'}],latest:{id:valueId,createdAt:'2026-11-04T08:00:00Z',mode:'protocol_only',model:'noreon-protocol-1',local:true,provider:null,responseModel:null,language:'en',evidenceToken:'token',labToken:'lab-token',caseRevision:1,promptVersion:'v1',builderVersion:'v1',guard:[],draft:{explanation:'Explanation.',instructions:'Instructions.',followUp:'Follow-up.',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]},items:[item],summary:null,adoptedAt:null,adoptedFields:null,byYou:true}};
for(const date of ['2026-11-02',null]){
 raw.labValues[0].collectedOn=date;
 const read=await readDoctorAiPlan({rpc:async()=>({data:raw,error:null})},valueId);
 assert.ok(read?.enabled&&read.latest);
 assert.equal(read.latest.items[0].source.ref,valueId);
 assert.equal(read.latest.items[0].source.label,date?'LDL-C · 2026-11-02':'LDL-C');
 assert.equal(raw.latest.items[0].source.label,'LDL-C','Do not change the stored source label');
}
for(const locale of ['en','hy','ru'] as const){
 const automatic=structuredClone(raw);automatic.labValues[0].status='auto_accepted';
 const read=await readDoctorAiPlan({rpc:async()=>({data:automatic,error:null})},valueId);
 assert.ok(read?.enabled&&read.latest);
 assert.ok(planSourceLabel(read.latest.items[0].source,locale).includes(AI_READ_LABEL[locale]),'plan inputs retain AI provenance');
}
console.log('Care plan source dates: real reader joins known report dates, omits unknown dates and keeps the original source intact.');

for(const locale of ['en','hy','ru'] as const)for(const mode of ['model','protocol_only'] as const){
 const generation=generationSchema.parse({...raw.latest,mode,summary:mode==='model'?'Synthetic summary for review.':null,items:[{...item,text:'RF-06: urgency orange (Q1).',rationale:'NRN-LAB-CAT-001 rules after tests (C1–C16) are pending (Q2).'}]});
 const html=renderToStaticMarkup(createElement(AiPlanPanel,{memberId:valueId,generation,stale:false,locale}));
 assert.doesNotMatch(html,/AI-prepared|NRN-|RF-06|Q[12]|C1|C16/);
 assert.match(html,mode==='model'?(locale==='en'?/AI summary applied/:locale==='hy'?/AI ամփոփումն ավելացված է/:/Добавлено резюме ИИ/):(locale==='en'?/AI wording unavailable/:locale==='hy'?/AI ձևակերպումներն անհասանելի են/:/Текст ИИ недоступен/));
 assert.match(html,/urgency orange/);
}
console.log('Shared care plan panel: truthful wording states and hidden audit codes in three languages (rendered component).');

for(const locale of ['en','hy','ru'] as const)for(const guard of [[],['member_language_unknown','summary_language:en'],['member_language:hy','summary_language:hy'],['member_language:ru','member_translation_missing:ru','summary_language:unknown']]){
 const summary='Several items need your judgement.';
 const guidance='eGFR 52: a single low value is not chronic kidney disease; check persistence over at least 3 months.';
 const rationale="CKD needs an abnormality persisting at least 3 months. Repeat timing is the doctor's.";
 const timing='Repeat assessment after checking chronicity.';
 const generation=generationSchema.parse({...raw.latest,mode:'model',summary,guard,items:[{...item,text:guidance,rationale,timing}]});
 const html=renderToStaticMarkup(createElement(AiPlanPanel,{memberId:valueId,generation,stale:false,locale}));
 const text=html.replaceAll('&#x27;',"'");
 for(const clinical of [guidance,rationale,timing,summary])assert.ok(text.includes(clinical),`${locale}: classic panel preserves ${clinical}`);
 if(!guard.some(g=>g.startsWith('member_language:')))assert.ok(text.includes(({en:'Member language unknown',hy:'Անդամի լեզուն անհայտ է',ru:'Язык участника неизвестен'})[locale]));
 const summaryLanguage=guard.find(g=>g.startsWith('summary_language:'))?.slice('summary_language:'.length);
 assert.equal(text.includes(({en:'Summary is in a different language than your screen',hy:'Ամփոփման լեզուն տարբերվում է ձեր էկրանի լեզվից',ru:'Язык резюме отличается от языка вашего экрана'})[locale]),summaryLanguage!==locale);
 if(guard.includes('member_translation_missing:ru'))assert.ok(text.includes(({en:'Translation unavailable, check before publishing',hy:'Թարգմանությունը հասանելի չէ, ստուգեք հրապարակելուց առաջ',ru:'Перевод недоступен, проверьте перед публикацией'})[locale]));
 if(locale!=='en')assert.ok(text.includes(({hy:'Ցուցադրված է անգլերեն․ դեռ թարգմանված չէ',ru:'Показано на английском: ещё не переведено'})[locale]),'Original staff item wording is visibly labeled');
}
