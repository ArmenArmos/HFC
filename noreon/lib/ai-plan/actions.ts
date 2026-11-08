'use server';
import {clinicalLocale} from '@/lib/locale';
import {planMemberLanguage} from './language';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff,snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {purposeRoute} from '@/lib/zoe/purpose-route';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {DRAFT_FIELDS,doctorPlanReadSchema} from './contracts';
import {generatePlanDraft,type PlanRoute} from './generate';
import {createFakePlanProvider,createPlanGatewayProvider,planProviderMode} from './provider';
import {readDoctorAiPlan} from './server';

export type PlanActionState={ok:boolean;message:string;mode?:'model'|'protocol_only';generationId?:string};
const MESSAGES:Record<string,string>={
 questionnaire_incomplete:'The questionnaire is not complete, so no plan draft was prepared.',
 urgent:'Urgent guidance is active. Urgent care comes first, so no routine plan draft was prepared.',
 disabled:'AI plan drafts are switched off.',not_assigned:'Only the assigned doctor can prepare this plan.',
 daily_attempt_limit:'The daily limit of plan drafts for this member is reached. Try again tomorrow.',
 stale:'Lab values or reviews changed while the draft was being prepared. Try again.',
 unavailable:'The plan draft could not be prepared. Try again.',
};

const MESSAGES_RU:Record<string,string>={
 questionnaire_incomplete:'Анкета не завершена, поэтому черновик плана лечения не подготовлен.',
 urgent:'Действуют срочные рекомендации. Экстренная помощь в приоритете, поэтому обычный черновик плана лечения не подготовлен.',
 disabled:'Черновики плана лечения с ИИ отключены.',not_assigned:'Подготовить этот план лечения может только назначенный врач.',
 daily_attempt_limit:'Достигнут дневной лимит черновиков плана лечения для этого участника. Попробуйте завтра.',
 stale:'Значения анализов или результаты рассмотрения изменились во время подготовки черновика. Попробуйте снова.',
 unavailable:'Не удалось подготовить черновик плана лечения. Попробуйте снова.',
};
const MESSAGES_HY:Record<string,string>={
 questionnaire_incomplete:'Հարցաշարը լրացված չէ, ուստի պլանի սևագիրը չի պատրաստվել։',
 urgent:'Գործում է շտապ ուղեցույց։ Շտապ օգնությունն առաջնային է, ուստի սովորական պլանի սևագիրը չի պատրաստվել։',
 disabled:'AI-ով պլանի սևագրերի պատրաստումն անջատված է։',not_assigned:'Այս պլանը կարող է պատրաստել միայն կցված բժիշկը։',
 daily_attempt_limit:'Այս անդամի համար պլանի սևագրերի օրական սահմանաչափը լրացել է։ Փորձեք վաղը։',
 stale:'Սևագիրը պատրաստելիս լաբորատոր ցուցանիշները կամ դրանց վերանայման տվյալները փոխվել են։ Փորձեք կրկին։',
 unavailable:'Չհաջողվեց պատրաստել պլանի սևագիրը։ Փորձեք կրկին։',
};

/**
 * Assigned doctor only. The doctor's own reads prove the assignment and the switch first; only then
 * does the server reserve, call the writer and record the draft with the service role (the database
 * re-checks the assignment). Nothing is saved into the doctor's draft and nothing is published.
 */
export const prepareAiCarePlan=loggedAction('prepareAiCarePlan',async function prepareAiCarePlan(memberId:string):Promise<PlanActionState>{
 const locale=await staffLocale('doctor'),messages=locale==='hy'?MESSAGES_HY:locale==='ru'?MESSAGES_RU:MESSAGES;
 if(!z.uuid().safeParse(memberId).success)return {ok:false,message:messages.unavailable!};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {ok:false,message:messages.not_assigned!};
 const [snap,read]=await Promise.all([client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId}),client.rpc('doctor_ai_plan_read',{p_user_id:memberId})]);
 if(snap.error||read.error)return {ok:false,message:snap.error?.code==='42501'||read.error?.code==='42501'?messages.not_assigned!:messages.unavailable!};
 const snapshot=snapshotSchema.safeParse(snap.data),plan=doctorPlanReadSchema.safeParse(read.data);
 if(!snapshot.success||!plan.success)return {ok:false,message:messages.unavailable!};
 if(!plan.data.enabled)return {ok:false,message:messages.disabled!};
 if(plan.data.published)return {ok:false,message:st(locale,'A plan is already published. Edit the treatment draft to prepare a new version.','Պլանն արդեն հրապարակված է։ Նոր տարբերակ պատրաստելու համար խմբագրեք բուժման սևագիրը։','План лечения уже опубликован. Измените черновик лечения, чтобы подготовить новую версию.')};
 const service=clinicalWriteClient();
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await service.rpc(name as never,args as never);if(r.error)throw Error(`Plan draft database unavailable (${r.error.code??'rpc'})`);return r.data;};
 const mode=planProviderMode();
 let route:PlanRoute|null=null;
 if(mode!=='off'){try{route=purposeRoute(parseRouteConfig(await rpc('zoe_route_config',{})),'plan_summary');}catch{route=null;}}
 const e=snapshot.data.evidence;
 // Same stored source used by member app and Telegram replies, read only after assignment is proven.
 const memberProfile=await service.from('profiles').select('locale,ui_locale').eq('id',memberId).maybeSingle();
 const memberLanguage=planMemberLanguage(memberProfile.error?null:memberProfile.data);
 const writerDeadline=Date.now()+45_000;
 try{
  const outcome=await generatePlanDraft({now:new Date(),language:clinicalLocale(memberLanguage??'hy'),memberLanguage,summaryLanguage:locale,profile:{birthDate:e.profile.birthDate,biologicalSex:e.profile.biologicalSex},
   assessment:e.assessment?{answers:e.assessment.answers,completed_at:e.assessment.completed_at,urgent_rule:e.assessment.urgent_rule}:null,
   measurements:e.measurements,visits:e.visits,labValues:plan.data.labValues,publications:(snapshot.data.publications??[]).map(p=>({publishedAt:p.publishedAt}))},
  {memberId,doctorId:identity.id,revision:snapshot.data.revision,evidenceToken:snapshot.data.evidenceToken,labToken:plan.data.labToken},
  {rpc,route,providerFor:m=>Date.now()>=writerDeadline?null:mode==='fake'?createFakePlanProvider():mode==='gateway'?createPlanGatewayProvider(m,{timeoutMs:writerDeadline-Date.now()}):null});
  revalidatePath(`/staff/real/members/${memberId}`);
  if(!outcome.ok)return {ok:false,message:messages[outcome.code]??messages.unavailable!};
  const confirmed=await readDoctorAiPlan(client,memberId);
  const current=await client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId});
  const currentCase=current.error?null:snapshotSchema.safeParse(current.data);
  if(!confirmed?.enabled||confirmed.published||confirmed.latest?.id!==outcome.generationId||!currentCase?.success||confirmed.latest.evidenceToken!==currentCase.data.evidenceToken||confirmed.latest.labToken!==confirmed.labToken||confirmed.latest.caseRevision>currentCase.data.revision)return {ok:false,message:messages.stale!};
  return {ok:true,generationId:outcome.generationId,mode:outcome.mode,message:outcome.mode==='model'
   ?st(locale,'Draft prepared. Check each marked field before saving.','Սևագիրը պատրաստ է։ Պահպանելուց առաջ ստուգեք յուրաքանչյուր նշված դաշտը։','Черновик подготовлен. Проверьте каждое отмеченное поле перед сохранением.')
   :st(locale,'Draft prepared from protocol rules only (AI wording unavailable). Check each marked field before saving.','Սևագիրը պատրաստ է միայն արձանագրության կանոնների հիման վրա (AI ձևակերպումներն անհասանելի են)։ Պահպանելուց առաջ ստուգեք յուրաքանչյուր նշված դաշտը։','Черновик подготовлен только по правилам протокола (текст ИИ недоступен). Проверьте каждое отмеченное поле перед сохранением.')};
 }catch{return {ok:false,message:messages.unavailable!};}
});

/** Records which AI-prepared fields the doctor accepted or edited when they saved. Best effort: the draft save stands either way. */
export const recordAiPlanAdoption=loggedAction('recordAiPlanAdoption',async function recordAiPlanAdoption(generationId:string,fields:string[]):Promise<boolean>{
 const parsed=z.object({id:z.uuid(),fields:z.array(z.enum(DRAFT_FIELDS)).max(3)}).safeParse({id:generationId,fields});
 if(!parsed.success)return false;
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return false;
 const r=await client.rpc('doctor_ai_plan_adopted',{p_generation:parsed.data.id,p_fields:parsed.data.fields});
 return !r.error&&(r.data as {status?:string}|null)?.status==='saved';
});
