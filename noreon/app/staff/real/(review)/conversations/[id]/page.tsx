import Link from 'next/link';
import {notFound,unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {CareSection} from '@/components/patient-care/common';
import {ConversationReview} from '@/components/conversation/review';
import {ZoeRuns} from '@/components/conversation/zoe-runs';
import {SymptomSummaries} from '@/components/conversation/symptom-summaries';
import {DoctorMode} from '@/components/conversation/doctor-mode';
import {UrgentAlert} from '@/components/conversation/urgent-alert';
import {parseClearUrgentNotice,parseHandBackNotice} from '@/lib/zoe/doctor-mode';
import {zoePipelineEnabled} from '@/lib/zoe/server';
import {adminOnly} from '@/lib/staff/real-admin';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {readAdminConversation} from '@/lib/admin-conversations/server';
import {AdminConversationView} from '@/components/admin-conversations/view';
import {parseBeforeCursor} from '@/lib/admin-conversations/contracts';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {readHandoffs} from '@/lib/nurse-chat/handoff-read';
import {NurseHandoffs} from '@/components/staff/nurse-handoffs';
import {retryConversationDelivery,readZoeRuns,readZoeReplyDrafts,readSymptomIntakes,readDoctorMode,readTopicBreaks,readUrgentWindow,readConversation,conversationActions,commandConversation,composeConversationReply,editConversationSummary,recoverConversationCommand} from '@/app/staff/real/conversation/actions';
export default async function ConversationPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{before?:string|string[];zoe?:string|string[]}>}){
 const staff=await requireRealStaff();const {identity}=staff;
 const locale=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 // Admins read, never act: a separate recording read, and none of the doctor ports below.
 if(identity.role==='admin'){
  await adminOnly(staff);
  const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
  const before=parseBeforeCursor((await searchParams).before);
  let view;try{view=await readAdminConversation(id,before);}catch(error){unstable_rethrow(error);return <div className="mx-auto max-w-3xl"><CareSection title={t("Conversation unavailable","Զրույցն անհասանելի է","Разговор недоступен")}><p className="text-body2">{t("The conversation could not be loaded. Reload to try again.","Չհաջողվեց բեռնել զրույցը։ Կրկին փորձելու համար թարմացրեք էջը։","Не удалось загрузить разговор. Обновите страницу, чтобы повторить попытку.")}</p></CareSection></div>;}
  if(!view.ok&&view.code==='not_found')notFound();
  if(!view.ok)return <div className="mx-auto max-w-3xl"><CareSection title={t("Admin reading is off","Ադմինիստրատորի դիտումն անջատված է","Чтение администратором отключено")}><p className="text-body2">{t("Reading member conversations as an admin is switched off for this environment.","Այս միջավայրում ադմինիստրատորի համար անդամների զրույցների դիտումն անջատված է։","Чтение разговоров участников администратором отключено в этой среде.")}</p><p className="mt-3"><Link href="/staff/real/members" className="text-body2 font-semibold underline underline-offset-4">{t("Back to members","Վերադառնալ անդամների ցանկին","Вернуться к участникам")}</Link></p></CareSection></div>;
  return <AdminConversationView view={view} locale={locale}/>;
 }
 // CD11: other staff get a workspace-scoped explanation, not the public not-found page.
 if(identity.role!=='doctor')return <div className="mx-auto max-w-3xl"><CareSection title={t('Conversation for the assigned doctor','Զրույց կցված բժշկի համար','Разговор для назначенного врача')}><p className="text-body2">{t('Only the member’s assigned doctor can read and answer this conversation.','Միայն անդամին կցված բժիշկը կարող է կարդալ այս զրույցը և պատասխանել։','Только назначенный участнику врач может читать этот разговор и отвечать в нем.')}</p><p className="mt-3"><Link href="/staff/real/members" className="text-body2 font-semibold underline underline-offset-4">{t('Back to members','Վերադառնալ անդամներին','Вернуться к участникам')}</Link></p></CareSection></div>;
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 let initial;try{initial=await readConversation(id);}catch(error){unstable_rethrow(error);return <div className="mx-auto max-w-3xl"><CareSection title={t('Conversation unavailable','Զրույցն անհասանելի է','Разговор недоступен')}><p className="text-body2">{t('We could not confirm your access to this conversation. No reply was approved. Reload to try again.','Չհաջողվեց հաստատել այս զրույցի Ձեր հասանելիությունը։ Ոչ մի պատասխան չի հաստատվել։ Թարմացրեք էջը՝ կրկին փորձելու համար։','Не удалось подтвердить ваш доступ к этому разговору. Ни один ответ не был утвержден. Обновите страницу, чтобы повторить попытку.')}</p></CareSection></div>;}
 // Zoe is optional context: its failure never hides the conversation.
 const zoe=zoePipelineEnabled()?await readZoeRuns(id).catch(error=>{unstable_rethrow(error);return null;}):undefined;
 const replyDrafts=zoePipelineEnabled()?await readZoeReplyDrafts(id).catch(error=>{unstable_rethrow(error);return null;}):undefined;
 const intakes=zoePipelineEnabled()?await readSymptomIntakes(id).catch(error=>{unstable_rethrow(error);return null;}):undefined;
 // Doctor takeover: who answers this member (Zoe or the doctor), and the hand back.
 const mode=zoePipelineEnabled()?await readDoctorMode(id).catch(error=>{unstable_rethrow(error);return null;}):undefined;
 const notice=parseHandBackNotice((await searchParams).zoe);
 // The 103 alert (20261020182719): open, and the assigned doctor's clear.
 const urgentWindow=zoePipelineEnabled()?await readUrgentWindow(id).catch(error=>{unstable_rethrow(error);return null;}):undefined;
 const urgentNotice=parseClearUrgentNotice((await searchParams).zoe);
 // The member's "New question" dividers: optional context, never in the way of the conversation.
 const topicBreaks=zoePipelineEnabled()?await readTopicBreaks(id).catch(error=>{unstable_rethrow(error);return [];}):[];
 const handoffs=nurseChatEnabled()?await readHandoffs(staff.client,id):undefined;
 const review=<>{handoffs!==undefined&&<NurseHandoffs page={handoffs} actor={{id:identity.id,role:'doctor'}} locale={locale}/>}<ConversationReview key={`${identity.id}:${id}`} memberId={id} doctorName={identity.name} locale={locale} initial={initial} replyDrafts={replyDrafts} topicBreaks={topicBreaks} ports={{retry:retryConversationDelivery,replyDrafts:readZoeReplyDrafts.bind(null,id),read:readConversation.bind(null,id),actions:conversationActions.bind(null,id),command:commandConversation,compose:composeConversationReply,summary:editConversationSummary,recover:recoverConversationCommand.bind(null,id)}}/></>;
 return zoe===undefined?review:<div className="space-y-6"><div className="mx-auto max-w-3xl space-y-6 lg:max-w-none">{urgentWindow!==undefined&&<UrgentAlert memberId={id} window={urgentWindow} notice={urgentNotice} locale={locale}/>}{mode!==undefined&&<DoctorMode memberId={id} mode={mode} notice={notice} locale={locale}/>}{intakes!==undefined&&<SymptomSummaries intakes={intakes} paused={!!mode?.intakePaused} locale={locale}/>}<ZoeRuns runs={zoe} locale={locale}/></div>{review}</div>;
}
