'use server';
import {journeyCardsEnabled} from '@/lib/patient/zoe-app-v3';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {createClient} from '@/lib/supabase/server';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {readMemberPlanVersions,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import type {PlanVersion} from '@/lib/doctor-completion/version-schema';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import {readMemberRegimens} from '@/lib/patient-care/regimen-runtime';
import type {RegimenChange} from '@/lib/patient-care/regimen';
import {getCareData} from '@/lib/patient-care/repository';
import {dosesForDay} from '@/lib/patient-care/model';
import {addEarlierValue} from '@/app/patient/progress/earlier/actions';
import {markLessonDone} from '@/app/patient/learn/actions';
import {acknowledgePlan} from '@/app/patient/care/actions';
import {valueInputSchema} from '@/lib/member-history/measures';
import {findLesson, lessonsShowDrafts, LESSON_ID} from '@/lib/lessons/catalogue';
import {readLessonProgress} from '@/lib/lessons/server';
import {sessionActor,noActor} from './actor';
import {openCard} from './commands';
import {postCard,readZoeCard,readZoeCards,claimCard,recordCard} from './server';
import {readEveryday,type EverydayRead} from './everyday-read';
import {EVERYDAY_VIEWS} from './everyday-contract';
import {SNAPSHOTS,type CardActionResult} from './registry';
import {everydayToken,runEverydayWrite,type EverydayWriteResult} from './everyday';
import {bookingToken} from './booking';
import type {CarePlan,DueDose} from '@/lib/patient-care/types';

const openInput=z.strictObject({requestId:z.uuid(),view:z.enum(EVERYDAY_VIEWS)});
export const openEverydayCard=loggedAction('openEverydayCard',async function openEverydayCard(raw:unknown):Promise<CardActionResult> {
  if(!memberChatOnlyEnabled())return {status:'disabled'};
  const parsed=openInput.safeParse(raw);
  if(!parsed.success)return {status:'invalid'};
  const who=await sessionActor();
  if(!who)return noActor();
  return openCard(who,{post:postCard,readCards:readZoeCards,snapshot:async()=>{
    const data=await readEveryday(parsed.data.view);
    return SNAPSHOTS.menu.parse({v:1,view:parsed.data.view,token:data.token});
  }},{requestId:parsed.data.requestId,kind:'menu',sourceSeq:null,reuseCurrent:true});
});

export const readEverydayFromCard=loggedAction('readEverydayFromCard',async function readEverydayFromCard(id:unknown):Promise<{status:'ok';data:EverydayRead;completedLessonId?:string}|{status:Exclude<CardActionResult['status'],'ok'>}> {
  if(!memberChatOnlyEnabled())return {status:'disabled'};
  if(!z.uuid().safeParse(id).success)return {status:'invalid'};
  if(!await sessionActor())return noActor();
  const card=await readZoeCard(id as string);
  if(!card?.valid||card.kind!=='menu'||!card.snapshot.view)return {status:'invalid'};
  const saved=(card.outcome['everyday:result'] as {status?:string}|undefined)?.status==='saved';
  if(card.state==='done'&&!saved)return {status:'closed'};
  const data=await readEveryday(card.snapshot.view);
  // Completed cards show current member-owned content. No readings or lesson text are stored in the receipt.
  if(saved&&(data.view==='earlier'||data.view==='lessons')){
    const completedLessonId=data.view==='lessons'?data.lessons.find(lesson=>[true,false].some(done=>bookingToken({lessonId:lesson.id,done})===card.claims.everyday?.payload.digest))?.id:undefined;
    return {status:'ok',data,...(completedLessonId?{completedLessonId}:{})};
  }
  return data.token===card.snapshot.token?{status:'ok',data}:{status:'stale'};
});

/** The complete plan the page shows, never a shortened instruction acknowledged as if it were complete. */
export const readPlanFromCard=loggedAction('readPlanFromCard',async function readPlanFromCard(id:unknown):Promise<{status:'ok';plan:CarePlan;doses:DueDose[];pendingReview:boolean;version:PlanVersion|null;medicineChanges:RegimenChange[]|undefined}|{status:Exclude<CardActionResult['status'],'ok'>}> {
  if(!journeyCardsEnabled())return {status:'disabled'};
  if(!z.uuid().safeParse(id).success)return {status:'invalid'};
  if(!await sessionActor())return noActor();
  const card=await readZoeCard(id as string);
  if(!card?.valid||card.kind!=='plan'||!card.snapshot.plan)return {status:'invalid'};
  const care=await getCareData();
  const plan=care.plan;
  if(plan?.id!==card.snapshot.plan.id)return {status:'stale'};
  // Match the care page's gates and select only the publication this card can acknowledge.
  const [versions,regimens]=await Promise.all([
    doctorCompletionEnabled()?createClient().then(client=>readMemberPlanVersions(client as unknown as DocumentRpc)):null,
    multiMedicineEnabled()?createClient().then(client=>readMemberRegimens(client as never)).catch(()=>null):null,
  ]);
  return {status:'ok',plan,doses:dosesForDay(care,new Date()),pendingReview:!!care.pendingReview,
    version:versions?.find(v=>v.planId===plan.id)??null,
    medicineChanges:regimens?.find(v=>v.planId===plan.id)?.changes};
});

const writeInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),view:z.enum(['earlier','lessons','plan_ack']),input:z.unknown()});
const lessonInput=z.strictObject({lessonId:z.string().regex(LESSON_ID),done:z.boolean()});
export const saveEverydayFromCard=loggedAction('saveEverydayFromCard',async function saveEverydayFromCard(raw:unknown):Promise<EverydayWriteResult> {
  if(!memberChatOnlyEnabled()&&!(journeyCardsEnabled()&&typeof raw==='object'&&raw!==null&&'view' in raw&&raw.view==='plan_ack'))return {status:'disabled'};
  const parsed=writeInput.safeParse(raw);
  if(!parsed.success)return {status:'invalid'};
  const value=parsed.data;
  if(value.view==='earlier'&&!valueInputSchema.safeParse(value.input).success)return {status:'invalid',result:{status:'invalid',fields:[]}};
  const lesson=value.view==='lessons'?lessonInput.safeParse(value.input):null;
  if(lesson&&!lesson.success)return {status:'invalid'};
  if(value.view==='plan_ack'&&!z.strictObject({planId:z.uuid()}).safeParse(value.input).success)return {status:'invalid'};
  const who=await sessionActor();
  if(!who)return noActor();
  // Re-read the page's own current plan; a held or superseded publication cannot be acknowledged.
  const currentPlan=value.view==='plan_ack'?(await getCareData()).plan:null;
  if(value.view==='plan_ack'&&(!currentPlan||currentPlan.id!==(value.input as {planId:string}).planId))return {status:'stale'};
  if(lesson?.success&&(!findLesson(lesson.data.lessonId,lessonsShowDrafts())||!await readLessonProgress()))return {status:'unavailable'};
  return runEverydayWrite(who,{
    readCard:readZoeCard,claim:claimCard,record:recordCard,
    currentToken:async()=>value.view==='plan_ack'?currentPlan!.id:(await readEveryday(value.view)).token,
    execute:async input=>{
      if(value.view==='earlier')return addEarlierValue(input);
      if(lesson?.success)return {status:(await markLessonDone(lesson.data.lessonId,lesson.data.done)).ok?'saved':'refused'};
      const card=await readZoeCard(value.cardId);
      if(!card||everydayToken(card,'plan_ack')!==currentPlan?.id)return {status:'refused'};
      return {status:(await acknowledgePlan(currentPlan.id)).ok?'saved':'refused'};
    },
  },value);
});
