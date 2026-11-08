/** Synthetic persistence/provider boundary for PR 13. Uses the production rule and schemas. */
import {chatNextStep} from '../../lib/zoe-chat-actions/next-step';
import {stepRequestId,stableRequestId} from '../../lib/zoe-chat-actions/next-step-id';
import {evaluate,buildPlan} from '../../lib/clinical/rules/engine';
import {cardSchema,type ZoeCard,type ZoeCards} from '../../lib/zoe-chat-actions/registry';
import type {AssessmentDraft} from '../../lib/patient/types';
import type {JourneyInput} from '../../lib/patient/next-step';

export function journeyFixture(getCards:()=>ZoeCards,setCards:(c:ZoeCards)=>void,getAssessment:()=>AssessmentDraft|undefined,makeCard:(kind:string,snapshot:unknown,request?:string)=>ZoeCard,plan:()=>ZoeCard){
 let phase='registration',unavailable=false,failFollow=false;
 const adminTasks:unknown[]=[];
 const input=():JourneyInput=>({questionnaireComplete:!!getAssessment()?.completedAt,review:{status:'review_pending'},appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:phase==='lab_done'?'at-lab':phase==='results_waiting'||phase==='results_released'?'results-received':null,planPublished:phase==='plan_published'||phase==='teach_back',now:new Date(),
  ...(phase==='booking_confirmed'?{nurseVisit:{startsAt:'2026-11-04T06:00:00Z',mode:'clinic' as const,steps:[{step:'confirmed' as const,at:new Date().toISOString()}],samplesTaken:null}}:{})});
 const current=()=>chatNextStep(input(),{episode:getAssessment()?.id??'registration',revision:phase==='tests_chosen'?'registration':phase,testsChosen:phase==='tests_chosen',planId:'00000000-0000-4000-8000-000000000008',teachBackConfirmed:phase==='teach_back',resultsReleased:phase==='results_released',resultsPublishedAt:phase==='results_released'?'2026-11-02T08:00:00Z':null});
 const sync=()=>{
  if(!getAssessment()?.completedAt)return;
  if(unavailable){setCards({...getCards(),nextStepStatus:'unavailable'});return;}
  const step=current(),request=stepRequestId('fixture-member',step),cards=getCards();
  const existing=cards.cards.find(c=>c.requestId===request);
  if(existing){let leaf=existing;for(let depth=0;depth<2;depth++){const next=(leaf.outcome[leaf.kind] as {requestId?:string}|undefined)?.requestId;if(!next)break;const target=cards.cards.find(c=>c.requestId===next);if(!target)break;leaf=target;}setCards({...cards,nextStepStatus:leaf.state==='done'?'waiting':undefined});return;}
  const next=makeCard('next_step',step,request);
  setCards({...cards,nextStepStatus:undefined,cards:[...cards.cards.map(c=>c.kind==='next_step'&&c.state==='open'?{...c,state:'done' as const,outcome:{replaced:{doneAt:new Date().toISOString()}}}:c),next]});
 };
 const required=()=>buildPlan(evaluate({answers:getAssessment()!.answers,observations:[]})).map(t=>({id:t.id,title:t.name.en??t.name.hy,method:t.method==='blood_draw'||t.method==='urine_sample'?'lab' as const:t.method==='home_log'?'home-log' as const:'clinic' as const}));
 const follow=(id:string)=>{
  if(failFollow){failFollow=false;return {status:'unavailable'};}
  const cards=getCards(),card=cards.cards.find(c=>c.id===id);
  if(!card?.valid||(card.kind!=='next_step'&&card.kind!=='tests_needed'))return {status:'invalid'};
  const originalTarget=card.kind==='next_step'?card.snapshot.target:'visit';
  const target=originalTarget==='tests_needed'?'visit':originalTarget;if(!target)return {status:'invalid'};
  const request=stableRequestId(`zoe-next-open:${card.id}:${originalTarget}`);
  const prior=cards.cards.find(c=>c.requestId===request);if(prior)return {status:'ok',card,next:prior};
  if(card.state==='done')return {status:'closed',card};
  const snapshot=target==='results'?{v:1,available:true,rows:phase==='results_released'?[{name:'LDL-C',value:'2.2',unit:'mmol/L',reference:null,at:'2026-11-04T08:00:00Z'}]:[],more:0,publishedAt:phase==='results_released'?'2026-11-04T09:00:00Z':null}:target==='visit'?{v:1,available:true,next:null,proposal:null,attention:false}:null;
  const at=new Date().toISOString();
  const saved=cardSchema.parse({...card,state:'done',outcome:{[card.kind]:{target,requestId:request,doneAt:at}}});
  const next=target==='plan'?{...plan(),requestId:request}:makeCard(target,snapshot??{v:1},request);
  if(originalTarget==='tests_needed'&&required().some(t=>t.method==='lab'))adminTasks.push({queue:'admin',reason:'missing_baseline_labs',summary:{}});
  if(card.kind==='tests_needed')phase='tests_chosen';
  setCards({...cards,cards:[...cards.cards.filter(c=>c.id!==id),saved,next]});
  return {status:'ok',card:saved,next};
 };
 return {sync,follow,stage:(value:string)=>{phase=value;unavailable=value==='read_failed';if(value==='fail_follow')failFollow=true;sync();},state:()=>({phase,adminTasks,cards:getCards()})};
}
