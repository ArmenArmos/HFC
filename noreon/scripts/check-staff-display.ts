/** Staff clocks must show Yerevan time, including midnight as 00, in every locale. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {stamp} from '@/components/patient-care/common';
import {createElement,type ContextType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {FirstNotePanel} from '@/components/staff/first-note-panel';
import {AiPlanPanel,AiPlanPrepare} from '@/components/staff/ai-plan-panel';
import {sections,type PlanGeneration} from '@/lib/ai-plan/contracts';
import {BookingProgram} from '@/components/real-booking/appointment-status';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';

import {staffDisplayText,staffReviewStep,staffRuleLabel,staffRecordedTrigger} from '@/lib/staff/display-text';
import {RecordCard,ZoeAnswer,QuoteLine} from '@/components/staff/zoe/answer';
import {toolResultSchema,answerContentSchema} from '@/lib/staff-zoe/contracts';
import {NurseTaskDetails} from '@/components/nurse-chat-v2/task-list';
import {NurseTaskTurns} from '@/components/nurse-chat-v2/task';
import {OverdueTaskCards} from '@/components/staff/doctor-workspace/day-cards';
import {taskTitle} from '@/lib/staff/real-coordination/task-copy';
import {taskSnapshotSchema} from '@/lib/staff/real-coordination/schema';
import {SymptomSummaries} from '@/components/conversation/symptom-summaries';
import {symptomIntakesSchema} from '@/lib/zoe/symptoms/contracts';
import {TEXT_RULES} from '@/lib/zoe/symptoms/red-flags';
import {SHEETS} from '@/lib/zoe/symptoms/sheets';
import {summaryLines} from '@/lib/zoe/symptoms/summary';
import {ZoeTrace} from '@/components/conversation/zoe-trace';
import {ZoeRuns} from '@/components/conversation/zoe-runs';
import {zoeRunsSchema} from '@/lib/zoe/contracts';
import type {ZoeRunDetail} from '@/lib/zoe/contracts';
import {ALL_RULES} from '@/lib/clinical/rules/rules';
import {ALARM_REASONS,alarmRuleReason} from '@/lib/zoe/alarm-reasons';
import {staffAlertReason} from '@/lib/staff/alert-label';
import {AdminConversationView} from '@/components/admin-conversations/view';
import type {TraceEvent} from '@/lib/conversation-trace/contracts';

const locales=['en','hy','ru'] as const;
// A registry family must never replace a recorded symptom with a different symptom.
for(const locale of locales){
 const expected={
  en:['Fainting','Breathlessness at rest','Weakness or numbness'],
  hy:['Ուշագնացություն','Հանգստի ժամանակ շնչարգելություն','Թուլություն կամ թմրածություն'],
  ru:['Обморок','Одышка в покое','Слабость или онемение'],
 }[locale];
 for(const [n,id,rf] of [[0,'fainting','RF-02'],[1,'breathless_at_rest','RF-02'],[2,'weakness_numbness','RF-04']] as const){
  const label=staffRuleLabel(id,locale,rf);
  assert.ok(label.startsWith(expected[n]),`${locale}: ${id} keeps its recorded meaning: ${label}`);
  assert.doesNotMatch(label,/palpitation|սրտխփ|сердцеби|speaking|խոսել|реч|говорить/i,`${locale}: ${id} adds no other symptom`);
  assert.match(label,/\n/,`${locale}: the suggested action is on a separate line`);
  assert.ok(label.includes('103'),'The existing mapped action is retained');
 }
 const references={
  en:['RF-01 was ruled out. No current chest pain.','RF-01 occurred last year. No symptoms now.'],
  hy:['RF-01-ը բացառվել է։ Հիմա կրծքավանդակի ցավ չկա։','RF-01-ը եղել է անցյալ տարի։ Հիմա ախտանիշներ չկան։'],
  ru:['RF-01 исключён. Сейчас боли в груди нет.','RF-01 был в прошлом году. Сейчас симптомов нет.'],
 }[locale];
 const neutral={en:'chest warning sign',hy:'կրծքավանդակի վտանգի նշան',ru:'тревожный признак в груди'}[locale];
 for(const source of references){
  const want=source.replace('RF-01',neutral);
  for(const quoted of [false,true])assert.equal(staffDisplayText(source,locale,quoted),want,'Code replacement preserves the entire negated or historical sentence');
  for(const attribution of [{},{zoe:true},{rationale:true},{nurseName:'Fixture'}]){
   const html=renderToStaticMarkup(createElement(QuoteLine,{text:source,date:null,flagged:false,locale,...attribution}));
   assert.ok(html.includes(want),'Every source attribution preserves negation and history');
   assert.doesNotMatch(html,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,'Quotes cannot manufacture an action');
  }
  const runs=zoeRunsSchema.parse({ok:true,runs:[{id:'11111111-1111-4111-8111-111111111111',messageSeq:1,outcome:'answered',reason:null,summary:source,answer:source,guardReasons:[],provider:null,model:null,draftId:null,finishedAt:'2026-11-04T08:00:00Z'}]}).runs;
  const html=renderToStaticMarkup(createElement(ZoeRuns,{runs,locale}));
  assert.ok(html.includes(want));
  assert.doesNotMatch(html,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,'Saved answers and summaries cannot add guidance');
 }
 // Even a standalone code in attributed text is a label, never a new instruction.
 const bare=renderToStaticMarkup(createElement(QuoteLine,{text:'RF-01',date:null,flagged:false,locale}));
 assert.ok(bare.includes(neutral));assert.doesNotMatch(bare,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/);
 const unknown=staffRuleLabel('future_symptom_trigger',locale,'RF-02');
 assert.ok(unknown.startsWith(staffRecordedTrigger(locale)),'A family cannot invent the symptom for an unknown hit');
 assert.ok(unknown.includes('103'),'A saved family still selects its existing action');
}
const symptomIntakes=symptomIntakesSchema.parse({ok:true,intakes:[{id:'11111111-1111-4111-8111-111111111111',sheetId:'chest_pain_mixed',sheetVersion:1,state:'escalated',ending:'red_flag',startedAt:'2026-11-04T08:00:00Z',updatedAt:'2026-11-04T08:00:00Z',finishedAt:null,summary:{version:'zoe-symptom-summary-1',sheet:{id:'chest_pain_mixed',version:1,status:'signed',label:{en:'Chest symptoms',hy:'Կրծքավանդակի ախտանիշներ'}},ending:'red_flag',language:'en',items:[],redFlags:{hits:[{id:'chest_pain_mixed',rf:'RF-01',source:'text'},{id:'future_rule_family',rf:null,source:'text'},{id:'one_leg_red_painful',rf:null,source:'answer'},{id:'bp_crisis_reading',rf:'RF-03',source:'reading'}],textRulesVersion:'fixture',textRulesChecked:3},latestReading:null}}]}).intakes;
for(const locale of locales)for(const [id,rf] of [['fainting','RF-02'],['breathless_at_rest','RF-02'],['weakness_numbness','RF-04']] as const){
 const intake=structuredClone(symptomIntakes[0]);
 intake.summary!.redFlags.hits=[{id,rf,source:'text'}];
 const html=renderToStaticMarkup(createElement(SymptomSummaries,{intakes:[intake],locale}));
 assert.doesNotMatch(html,/palpitation|սրտխփ|сердцеби|speaking|խոսել|реч|говорить/i,'Rendered symptom evidence must not add another symptom');
 assert.ok(html.includes('103'),'Structured hits retain the existing action');
 assert.match(html,/whitespace-pre-line/,'The suggested step renders on its own line');
}
const taskDisplayFixture=taskSnapshotSchema.parse({id:'22222222-2222-4222-8222-222222222222',caseId:'33333333-3333-4333-8333-333333333333',title:'Review RF-03 for john_doe@example.com and follow_up_notes',instructions:'Recorded chest_pain_mixed; contact john_doe@example.com about follow_up_notes',memberName:'Fixture',kind:'contact-followup',dueAt:'2026-11-01T09:00:00Z',creatorId:'33333333-3333-4333-8333-333333333333',ownerId:'33333333-3333-4333-8333-333333333333',ownerName:'Fixture nurse',status:'open',revision:1,createdAt:'2026-11-01T08:00:00Z',updatedAt:'2026-11-01T08:00:00Z',needsReassignment:false,eligibleOwners:[],events:[]});
// Legacy/seed/system titles without projected origin metadata stay as stored,
// just like staff-authored tasks with those exact titles and kinds.
const unmarkedTaskTitles=[
 ['Collect blood pressure log','evidence-collection'],
 ['Call about the results','contact-followup'],
 ['Nurse handoff','doctor-referral'],
 ['Mild side effect from Zoe','contact-followup'],
 ['Side effect reported: ankle swelling','contact-followup'],
 ['Side effect reported: dizziness','contact-followup'],
 ['Side effect reported: nausea','contact-followup'],
 ['Side effect reported: dry cough','contact-followup'],
 ['Side effect reported: headache','contact-followup'],
 ['Side effect reported: frequent urination','contact-followup'],
] as const;
for(const locale of locales){
 for(const [title,kind] of [['From the doctor','contact-followup'],...unmarkedTaskTitles] as const){
  const staffTask={...taskDisplayFixture,title,kind,sourceConversationId:null,origin:null};
  assert.equal(taskTitle(staffTask,locale),title,'An exact-match staff title stays as stored without system provenance');
  assert.equal(taskTitle({...staffTask,sourceConversationId:undefined},locale),title,'Legacy tasks without provenance stay as stored');
  if(title!=='From the doctor')assert.equal(taskTitle({...staffTask,sourceConversationId:taskDisplayFixture.caseId},locale),title,'A conversation alone does not establish another system title');
  for(const element of [
   createElement(NurseTaskDetails,{snapshot:staffTask,locale,disabled:false,onDetails(){},onOperation(){}}),
   createElement(OverdueTaskCards,{tasks:{items:[staffTask],hasMore:false},locale}),
  ])assert.ok(renderToStaticMarkup(element).includes(`${title}</`),`${title} stays as stored in ${locale}`);
 }
 for(const title of ['From the doctor','Բժշկի կողմից','От врача']){
  const task={...taskDisplayFixture,title,kind:'contact-followup' as const,sourceConversationId:taskDisplayFixture.caseId,origin:'doctor_handover' as const};
  for(const element of [
   createElement(NurseTaskDetails,{snapshot:task,locale,disabled:false,onDetails(){},onOperation(){}}),
   createElement(OverdueTaskCards,{tasks:{items:[task],hasMore:false},locale}),
  ])assert.ok(renderToStaticMarkup(element).includes({en:'From the doctor',hy:'Բժշկից',ru:'От врача'}[locale]),`A conversation-backed handover renders in ${locale}`);
  assert.equal(taskTitle({...task,origin:null},locale),title,'Localized staff titles also stay as stored');
  assert.equal(taskTitle({...task,kind:'evidence-collection'},locale),title,'A conversation alone cannot turn another task kind into a handover');
 }
}
const systemTitles=[
 ['nurse_handoff','doctor-referral','Nurse handoff','Փոխանցում բուժքրոջից','Передача от медсестры'],
 ['zoe_side_effect','contact-followup','Mild side effect from Zoe','Թեթև կողմնակի ազդեցություն՝ Զոյայից','Лёгкий побочный эффект от Зои'],
 ['zoe_side_effect','contact-followup','Side effect reported: ankle swelling','Հաղորդվել է կողմնակի ազդեցություն՝ կոճերի այտուց','Сообщён побочный эффект: отёк лодыжек'],
 ['zoe_side_effect','contact-followup','Side effect reported: dizziness','Հաղորդվել է կողմնակի ազդեցություն՝ գլխապտույտ','Сообщён побочный эффект: головокружение'],
 ['zoe_side_effect','contact-followup','Side effect reported: nausea','Հաղորդվել է կողմնակի ազդեցություն՝ սրտխառնոց','Сообщён побочный эффект: тошнота'],
 ['zoe_side_effect','contact-followup','Side effect reported: dry cough','Հաղորդվել է կողմնակի ազդեցություն՝ չոր հազ','Сообщён побочный эффект: сухой кашель'],
 ['zoe_side_effect','contact-followup','Side effect reported: headache','Հաղորդվել է կողմնակի ազդեցություն՝ գլխացավ','Сообщён побочный эффект: головная боль'],
 ['zoe_side_effect','contact-followup','Side effect reported: frequent urination','Հաղորդվել է կողմնակի ազդեցություն՝ հաճախամիզություն','Сообщён побочный эффект: частое мочеиспускание'],
] as const;
for(const [origin,kind,en,hy,ru] of systemTitles)for(const locale of locales){
 const task={...taskDisplayFixture,origin,kind,title:en};
 const expected={en,hy,ru}[locale];
 assert.equal(taskSnapshotSchema.parse(task).origin,origin,'The shared read schema retains provenance');
 assert.equal(taskSnapshotSchema.safeParse({...task,origin:'invented'}).success,false,'The read schema rejects unknown provenance');
 assert.equal(taskTitle(task,locale),expected);
 for(const element of [createElement(NurseTaskDetails,{snapshot:task,locale,disabled:false,onDetails(){},onOperation(){}}),createElement(OverdueTaskCards,{tasks:{items:[task],hasMore:false},locale})])
  assert.ok(renderToStaticMarkup(element).includes(expected),`Origin title renders in ${locale}`);
 assert.equal(taskTitle({...task,origin:null},locale),en,'Staff-typed exact matches stay as typed');
 assert.equal(taskTitle({...task,title:en+' edited'},locale),en+' edited','Edited system titles stay as typed');
 assert.equal(taskTitle({...task,origin:origin==='nurse_handoff'?'zoe_side_effect':'nurse_handoff'},locale),en,'Other origins cannot translate this title');
}
const reviewFindings:string[]=[];
const symptomAliases=[...TEXT_RULES,...SHEETS.flatMap(sheet=>sheet.questions.flatMap(question=>question.redFlagIfYes?[question.redFlagIfYes]:[]))].filter(rule=>rule.rf);
for(const locale of locales){
 for(const [surface,element] of [
  ['nurse task detail',createElement(NurseTaskDetails,{snapshot:taskDisplayFixture,locale,disabled:false,onDetails(){},onOperation(){}})],
  ['nurse task change',createElement(NurseTaskTurns,{entry:{id:'fixture',task:taskDisplayFixture,operation:'complete',state:'uncertain',changed:true},locale,sending:false,onCheck(){}})],
  ['overdue task',createElement(OverdueTaskCards,{tasks:{items:[taskDisplayFixture],hasMore:false},locale})],
 ] as const){
  const text=renderToStaticMarkup(element).replace(/<[^>]*>/g,'');
  if(/RF-03|chest_pain_mixed/.test(text))reviewFindings.push(`${locale}: ${surface} exposes clinical identifiers`);
  if(!text.includes('john_doe@example.com')||!text.includes('follow_up_notes'))reviewFindings.push(`${locale}: ${surface} changed ordinary task prose`);
 }
 for(const alias of symptomAliases){const label=staffRuleLabel(alias.id,locale,alias.rf);if(!label.includes('103')||label.includes(staffReviewStep(locale)))reviewFindings.push(`${locale}: known alias ${alias.id} lost its existing urgent step`);}
 for(const alias of symptomAliases.filter(alias=>symptomAliases.every(other=>other.id!==alias.id||other.rf===alias.rf))){const label=staffRuleLabel(alias.id,locale);if(!label.includes('103')||label.includes(staffReviewStep(locale)))reviewFindings.push(`${locale}: unambiguous alias ${alias.id} lacks its source mapping`);}
 const text=renderToStaticMarkup(createElement(SymptomSummaries,{intakes:symptomIntakes,locale})).replace(/<[^>]*>/g,'');
 if(/RF-|NRN-|chest_pain_mixed|future_rule_family|bp_crisis_reading/.test(text))reviewFindings.push(`${locale}: symptom summaries expose clinical codes`);
 const legLabel={en:'One leg swollen, red or painful',hy:'Մեկ ոտքն այտուցված, կարմիր կամ ցավոտ է',ru:'Отёк, покраснение или боль в одной ноге'}[locale];
 assert.ok(staffRuleLabel('future_rule_family',locale).includes(staffRecordedTrigger(locale)),'Unknown code keeps the generic localized trigger');
 if(!text.includes(legLabel))reviewFindings.push(`${locale}: known sheet trigger lost its recorded wording`);
 if(!staffRuleLabel('one_leg_red_painful',locale).includes(staffReviewStep(locale)))reviewFindings.push(`${locale}: known trigger without an action lost its neutral review step`);
 if(!text.includes(staffReviewStep(locale)))reviewFindings.push(`${locale}: unknown symptom trigger lacks localized review step`);
 const quote='Contact john_doe@example.com about my follow_up_notes. Recorded RF-03 and chest_pain_mixed.';
 const quoted=[false,true].map(rationale=>renderToStaticMarkup(createElement(QuoteLine,{text:quote,date:null,flagged:false,locale,rationale}))).join(' ');
 if(!quoted.includes('john_doe@example.com')||!quoted.includes('follow_up_notes'))reviewFindings.push(`${locale}: ordinary quoted text was changed`);
 if(/RF-03|chest_pain_mixed/.test(quoted))reviewFindings.push(`${locale}: known clinical IDs remain in quoted text`);
}
assert.deepEqual(reviewFindings,[],'Independent review regression findings');
assert.match(summaryLines(symptomIntakes[0].summary!,'en').join(' '),/RF-01/,'Shared summary evidence remains unchanged');
for(const locale of locales){
 for(const code of ['RF-01','RF-99','NRN-RULE-BP-002','bp_crisis_reading','problem_worsening','chest_pain_mixed','RF-03','S-CHEST-001','future_rule_family']){
  const displayed=staffDisplayText(`Recorded: ${code}`,locale);
  assert.doesNotMatch(displayed,/RF-|NRN-|[a-z]+_[a-z]+|S-CHEST/);
  assert.ok(displayed.length>10);
 }
 assert.doesNotMatch(staffAlertReason({reason:'future_rule_family',redFlags:['RF-99']},locale),/future|RF-/);
 assert.ok(staffReviewStep(locale));
 for(const rule of ALL_RULES){if(!rule.id.startsWith('RF-'))assert.ok(staffRuleLabel(rule.id,locale).startsWith(rule.reason[locale]!));if(rule.nextStep?.[locale])assert.ok(staffRuleLabel(rule.id,locale).includes(rule.nextStep[locale]!));else assert.ok(staffRuleLabel(rule.id,locale).includes(staffReviewStep(locale)));}
 for(const alias of ['bp_crisis_reading','chest_pain_mixed','RF-03']){assert.ok(staffRuleLabel(alias,locale).includes('103'));assert.ok(!staffRuleLabel(alias,locale).includes(staffReviewStep(locale)));assert.doesNotMatch(staffDisplayText(alias,locale),/103/,'Free text never infers a new action');}
 for(const code of Object.keys(ALARM_REASONS))assert.ok(alarmRuleReason(code,locale));
 const card=toolResultSchema.parse({tool:'open_items',state:'ok',href:'/staff/real/members/fixture',missing:['NRN-CLIN-ALG-001'],quotes:[],facts:[{
  id:'open_items.1',label:'RF-99',value:'bp_crisis_reading',date:null,mark:null,href:null,
  alertCard:{symptom:'RF-01',onset:'NRN-CLIN-ALG-001',severity:'urgent',source:'future_source_rule',next:'future_action_rule',count:1},
 }]});
 const content=answerContentSchema.parse({version:'staff-zoe-1',state:'answered',say:[{text:'NRN-RULE-BP-002 bp_crisis_reading',facts:[]}],quotes:[{id:'zoe_why.1',text:'RF-99 chest_pain_mixed',date:null,flagged:false}],notKnown:['NRN-CLIN-ALG-001'],declined:false,notice:'future_rule_family',cards:[card]});
 for(const element of [createElement(RecordCard,{card,locale,memberRef:'Fixture'}),createElement(ZoeAnswer,{content,locale,memberRef:'Fixture'})]){
  const text=renderToStaticMarkup(element).replace(/<[^>]*>/g,'');
  assert.doesNotMatch(text,/RF-|NRN-|[a-z]+_[a-z]+/,'Saved facts, alerts, rationale, notices and why text use display labels');
  assert.ok(text.includes(staffRecordedTrigger(locale)),'Unknown saved codes keep a neutral label');
 }
 assert.equal(card.facts[0].alertCard?.source,'future_source_rule','Display must not mutate stored evidence');
}
const traceDetail:ZoeRunDetail={id:'fixture',outcome:'recorded',reason:'bp_crisis_reading',provider:null,model:null,tier:null,tierReason:null,fallbackUsed:false,configVersion:null,costUsd:null,inputTokens:null,outputTokens:null,latencyMs:null,io:{memberBlock:'NRN-CLIN-ALG-001 RF-01',response:'problem_worsening',judgeMalformed:'future_rule_family'}};
for(const locale of locales){
const events:TraceEvent[]=[{id:1,at:'2026-11-04T08:00:00Z',step:'check',name:'zoe.guard.symptom_red_flags',outcome:'recorded',reason:'bp_crisis_reading',rule:'RF-01',ruleVersion:'NRN-CLIN-ALG-001',actorKind:'system',actorName:null,subjectKind:'member',subjectId:'fixture',attributes:{'noreon.zoe.run.id':'fixture','noreon.zoe.tier_rules':'future_rule_family'}}];
const trace=renderToStaticMarkup(createElement(ZoeTrace,{locale,memberId:'fixture',events,detail:traceDetail,why:null})).replace(/<[^>]*>/g,'');
assert.doesNotMatch(trace,/RF-|NRN-|[a-z]+_[a-z]+/,'Expanded trace metadata and redacted AI input/output hide clinical identifiers');
assert.doesNotMatch(trace,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,`${locale}: historical trace provenance never adds new guidance`);
if(locale!=='en')assert.doesNotMatch(trace,/Call 103 now/,'Trace action has no English fallback');
const admin=renderToStaticMarkup(createElement(AdminConversationView,{locale,view:{ok:true,memberId:'fixture',memberName:'Fixture',doctorName:null,conversationId:null,asOf:'2026-11-04T08:00:00Z',window:{before:null,from:null,olderBefore:null},messages:[],zoeAnswers:[],replies:[],drafts:[],zoeRuns:[],zoeRunsTotal:0,intakes:[],intakesTotal:0,trace:events,traceTotal:1}}));
assert.doesNotMatch(admin,/RF-|NRN-|103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,'Admin historical rule attribution cannot gain an action');
const runs=zoeRunsSchema.parse({ok:true,runs:[{id:'11111111-1111-4111-8111-111111111111',messageSeq:1,outcome:'answered',reason:null,summary:'RF-01',answer:'chest_pain_mixed',guardReasons:[],provider:null,model:null,draftId:null,finishedAt:'2026-11-04T08:00:00Z'}]}).runs;
const runText=renderToStaticMarkup(createElement(ZoeRuns,{runs,locale})).replace(/<[^>]*>/g,'');
assert.doesNotMatch(runText,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,`${locale}: saved Zoe text never acquires new guidance`);
if(locale!=='en')assert.doesNotMatch(runText,/Call 103 now/,'Zoe run action has no English fallback');
}
const router={refresh(){}} as NonNullable<ContextType<typeof AppRouterContext>>;
const generation:PlanGeneration={id:'fixture',createdAt:'2026-11-04T08:00:00Z',mode:'protocol_only',model:'fixture',local:true,provider:null,responseModel:null,language:'hy',evidenceToken:'fixture',labToken:'fixture',caseRevision:1,promptVersion:'fixture',builderVersion:'fixture',guard:[],
 draft:{explanation:'',instructions:'',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]},summary:null,adoptedAt:null,adoptedFields:null,byYou:true,
 items:sections.map(section=>({id:section,section,status:'needs_doctor_judgement',text:'135/85',rationale:'135/85',source:{kind:'rule',ref:'NRN-RULE-BP-002',label:'NRN-RULE-BP-002'},timing:'14',member:null})),
};
const escaped=(text:string)=>renderToStaticMarkup(createElement('span',null,text)).slice(6,-7);
for(const locale of locales){
 const note=renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(FirstNotePanel,{
  data:{version:'first-note-v1',enabled:true,completedAt:'2026-11-04T08:00:00Z',dueAt:null,urgent:false,planActive:false,note:null},
  draft:{text:{en:'Synthetic finding.',hy:'Սինթետիկ տվյալ։'},sources:['NRN-RULE-ANT-001','NRN-RULE-DIET-001','NRN-RULE-HTN-002','RF-06']},
  memberId:'fixture',submissionId:'fixture',assessmentRevision:1,locale,now:'2026-11-04T08:00:00Z',approve:async()=>({status:'approved' as const}),
 })));
 assert.doesNotMatch(note,/NRN-|RF-\d/,'First-note staff text must not expose source codes');
 const prepareLabel={en:'Prepare care plan',hy:'Պատրաստել խնամքի պլան',ru:'Подготовить план лечения'}[locale];
 for(const [reviewed,unreviewed,prepared] of [[0,0,false],[1,0,false],[0,1,false],[0,2,false],[1,0,true]] as const){
  const html=renderToStaticMarkup(createElement(AiPlanPrepare,{memberId:'fixture',reviewed,unreviewed,prepared,locale}));
  assert.ok(html.includes(prepareLabel),`${locale}: translated preparation heading`);
  if(locale!=='en')assert.doesNotMatch(html,/No lab results|next:|Prepare care plan|still to review|Results reviewed|A draft is ready|You edit and approve|Prepare a new draft|Open the draft|Values you have not reviewed/);
 }
 const panel=renderToStaticMarkup(createElement(AiPlanPanel,{memberId:'fixture',generation,stale:true,locale}));
 assert.doesNotMatch(panel,/NRN-|RF-\d/);
 assert.ok(panel.includes({en:'Regenerate',hy:'Պատրաստել նորից',ru:'Подготовить заново'}[locale]));
 if(locale!=='en')assert.doesNotMatch(panel,/Protocol flags|Assessment|Blood pressure target|Lifestyle goals|Tests|Follow-up|For your consideration|Missing or unreviewed|Needs your judgement|When:|Why:|Source:|The evidence changed|Sources for the member-facing text|Regenerate/);
 const program=TEST_CATALOGUE.map(test=>({id:test.id,title:test.name.en!,preparation:test.preparation.en!,method:'lab' as const}));
 const html=renderToStaticMarkup(createElement(BookingProgram,{program,locale,audience:'staff'}));
 for(const test of TEST_CATALOGUE){
  assert.ok(test.name[locale]&&test.preparation[locale],`${test.id}: catalogue copy in ${locale}`);
  assert.ok(html.includes(escaped(test.name[locale]!)),`${test.id}: staff test name in ${locale}`);
  assert.ok(html.includes(escaped(test.preparation[locale]!)),`${test.id}: staff preparation in ${locale}`);
 }
 for(const id of [program[0].id,'provider-test']){
  const custom=renderToStaticMarkup(createElement(BookingProgram,{program:[{...program[0],id,title:'Recorded provider procedure',preparation:'Recorded provider instructions'}],locale,audience:'staff'}));
  assert.match(custom,/Recorded provider procedure/);assert.match(custom,/Recorded provider instructions/);
 }
 const member=renderToStaticMarkup(createElement(BookingProgram,{program,locale,audience:'member'}));
 assert.match(member,/Weight and waist measurement/,'Member booking text is unchanged');
}
const examples=[['2026-11-03T20:08:00Z','00:08'],['2026-11-04T02:08:00Z','06:08'],['2026-11-04T10:08:00Z','14:08']] as const;
function check(format:(at:string,locale:typeof locales[number])=>string,label:string){
 for(const locale of locales)for(const [at,clock] of examples){
  const result=format(at,locale);
  assert.doesNotMatch(result,/\b(?:AM|PM)\b/i,`${label}, ${locale}: ${result}`);
  assert.ok(result.includes(clock),`${label}, ${locale}: expected ${clock} in ${result}`);
 }
}
check(yerevanStamp,'Staff stamp');
check(stamp,'Shared care stamp');

// Exercise the actual Intl options at staff call sites, even for embedded panels.
function walk(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):/\.tsx?$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
const files=['app/staff','components/doctor-chat-v2','components/nurse-chat-v2','components/staff','components/conversation','components/real-review','components/service-workflow','components/messaging','components/notifications','lib/staff','lib/staff-zoe','lib/clinic-admin'].flatMap(walk);
let clocks=0;
for(const file of files){
 const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(n:ts.Node){
  const label=`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1}`;
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&ts.isNewExpression(n.expression.expression)&&n.expression.expression.expression.getText(sf)==='Date'){
   assert.ok(!['toLocaleTimeString','toLocaleString'].includes(n.expression.name.text),`${label}: use the Yerevan staff stamp instead of a local clock`);
  }
  if(ts.isNewExpression(n)&&n.expression.getText(sf)==='Intl.DateTimeFormat'){
   const options=n.arguments?.[1];
   if(options&&ts.isObjectLiteralExpression(options)){
    const values=Object.fromEntries(options.properties.flatMap(p=>ts.isPropertyAssignment(p)&&ts.isStringLiteralLike(p.initializer)?[[p.name.getText(sf).replace(/['"]/g,''),p.initializer.text]]:[])) as Intl.DateTimeFormatOptions;
    if(values.minute||values.timeStyle){
     assert.equal(values.hourCycle,'h23',`${label}: explicitly use the 24-hour clock`);
     assert.equal(values.timeZone,'Asia/Yerevan',`${label}: explicitly use Yerevan time`);
     if(!values.timeStyle)assert.equal(values.hour,'2-digit',`${label}: pad the hour`);
     check((at,locale)=>new Intl.DateTimeFormat(locale,values).format(new Date(at)),label);
     clocks++;
    }
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(sf);
}
assert.ok(clocks>10,'Keep coverage of staff clock call sites');
console.log(`Staff display: rule labels, saved Zoe alerts/why, expanded trace and AI input/output hide codes; first-note codes hidden, care plan controls and catalogue preparation localized, provider/member text preserved; shared stamps and ${clocks} Intl clocks use 24-hour Yerevan time in en, hy and ru.`);
