import Link from 'next/link';
import {unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {readNurseVisits,readNurseVisit,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import {nurseVisitSources,type NurseVisitList,type NurseVisitDetail} from '@/lib/nurse-visit/schema';
import {recordNurseVisitMark,recordNurseVisitStep,recordNurseVisitComplete} from '@/lib/nurse-visit/actions';
import {readVisitEvidence,type VisitRpc} from '@/lib/staff/visit-evidence-runtime';
import {recordRealVisitEvidence,refreshRealVisitEvidence} from '@/lib/staff/visit-evidence-actions';
import {NurseVisitActions} from './nurse-visit-actions';
import {RealVisitEvidence} from './real-visit-evidence';
import {NurseChatVisitList,nurseVisitChatHref} from './nurse-chat-visit-list';

export type NurseVisitSelection={source?:string|string[];visit?:string|string[];evidence?:string|string[];memberEvidence?:string|string[]};
/** Uses the same session-scoped RPCs and actions as the fallback pages. No chat-specific clinical logic. */
export async function NurseChatVisits({memberId,selection={},locale}:{memberId?:string;selection?:NurseVisitSelection;locale:StaffLocale}){
 if(!nurseChatEnabled())return null;
 const {client,identity,actorScope}=await requireRealStaffForRender();
 if(identity.role!=='nurse')return null;
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const unavailable=<p role="alert" className="rounded-xl border bg-card p-4 text-body2">{t('This visit is unavailable. It may have changed, been cancelled, or your access may have changed. Reload your visits.','Այս այցն անհասանելի է։ Այն կարող է փոխված կամ չեղարկված լինել, կամ ձեր հասանելիությունը փոխված լինի։ Թարմացրեք ձեր այցերը։','Этот визит недоступен. Возможно, он изменён или отменён либо изменился ваш доступ. Обновите список визитов.')} <Link href="/staff/real/nurse-chat?view=visits" className="underline">{t('Your visits','Ձեր այցերը','Ваши визиты')}</Link></p>;
 // This is the existing member-record evidence workspace, deliberately separate
 // from a scheduled visit. Its action keeps the member page's booking rules.
 if(selection.visit===undefined&&selection.source===undefined&&selection.memberEvidence==='true'){
  if(!z.uuid().safeParse(memberId).success)return unavailable;
  let record:Awaited<ReturnType<typeof readVisitEvidence>>|null=null;
  try{record=await readVisitEvidence({memberId:memberId!,client:client as unknown as VisitRpc});}catch(error){unstable_rethrow(error);}
  return <section className="space-y-4" aria-label={t('Member visit evidence','Անդամի այցերի տվյալներ','Данные визитов участника')}>
   <header className="space-y-2 rounded-xl bg-card p-4">
    <h2 className="text-h3">{t('Member visit evidence','Անդամի այցերի տվյալներ','Данные визитов участника')}</h2>
    <p className="text-body2">{t('These entries belong to the member record. A new evidence record uses the current booking. Complete a scheduled visit from its checklist.','Այս գրառումները պատկանում են անդամի քարտին։ Նոր տվյալների գրառումն օգտագործում է ընթացիկ ամրագրումը։ Նշանակված այցն ավարտեք իր ստուգաթերթից։','Эти записи относятся к карте участника. Новая запись данных использует текущую запись на визит. Завершайте назначенный визит из его контрольного списка.')}</p>
    <Link href={`/staff/real/nurse-chat?member=${memberId}&view=visits`} className="dw-pill">{t('Your visits','Ձեր այցերը','Ваши визиты')}</Link>
   </header>
   {record?<RealVisitEvidence data={record} locale={locale} actorScope={actorScope} canRecord visitId={crypto.randomUUID()} openSubmissionId={crypto.randomUUID()} appendSubmissionId={crypto.randomUUID()} commandAction={recordRealVisitEvidence.bind(null,memberId!)} refreshAction={refreshRealVisitEvidence.bind(null,memberId!)}/>:unavailable}
  </section>;
 }
 if(selection.visit===undefined&&selection.source===undefined){
  let list:NurseVisitList|null=null;
  try{list=await readNurseVisits(client as unknown as NurseVisitRpc);}catch(error){unstable_rethrow(error);}
  return <NurseChatVisitList list={list} locale={locale} memberId={memberId}/>;
 }
 const parsed=z.object({memberId:z.uuid(),source:z.enum(nurseVisitSources),visit:z.uuid()}).safeParse({memberId,source:selection.source,visit:selection.visit});
 if(!parsed.success)return unavailable;
 let data:NurseVisitDetail|null=null;
 try{data=await readNurseVisit(client as unknown as NurseVisitRpc,parsed.data.memberId,parsed.data.source,parsed.data.visit);}catch(error){unstable_rethrow(error);}
 if(!data||!('enabled'in data))return unavailable;
 if(!data.enabled)return <NurseChatVisitList list={{version:'nurse-visit-v1',enabled:false,visits:[]}} locale={locale}/>;
 const visit=data.visit;
 if(visit.id!==parsed.data.visit||visit.source!==parsed.data.source)return unavailable;
 let evidence:Awaited<ReturnType<typeof readVisitEvidence>>|null=null;
 if(selection.evidence==='true'&&data.completion){
  try{const record=await readVisitEvidence({memberId:visit.memberId,client:client as unknown as VisitRpc});
   const visits=record.visits.filter(item=>item.id===data.completion!.visitId);
   if(visits.length)evidence={...record,visits};}catch(error){unstable_rethrow(error);}
 }
 return <article className="space-y-4" aria-label={t('Visit in chat','Այցը զրույցում','Визит в чате')}>
  <header className="space-y-2 rounded-xl bg-card p-4 sm:p-5">
   <h2 className="text-h3">{visit.memberName} · {visit.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):visit.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}</h2>
   <p className="text-body2">{yerevanStamp(visit.startsAt,locale)}</p>
   {visit.location&&<p className="break-words text-body2">{visit.location}</p>}
   <div className="flex flex-wrap gap-3">
    <Link href={`/staff/real/nurse-chat?member=${visit.memberId}&view=visits`} className="dw-pill">{t('Your visits','Ձեր այցերը','Ваши визиты')}</Link>
    <Link href={nurseVisitChatHref(visit,selection.evidence!=='true')} className="dw-pill">{selection.evidence==='true'?t('Visit actions','Այցի գործողությունները','Действия визита'):t('Visit evidence','Այցի տվյալներ','Данные визита')}</Link>
    {!data.completion&&<Link href={`/staff/real/nurse-chat?member=${visit.memberId}&memberEvidence=true`} className="dw-pill">{t('Record member evidence','Գրանցել անդամի տվյալներ','Записать данные участника')}</Link>}
   </div>
  </header>
  {selection.evidence==='true'?evidence?<RealVisitEvidence data={evidence} locale={locale} actorScope={actorScope} canRecord={false} visitId={data.completion?.visitId??crypto.randomUUID()} openSubmissionId={crypto.randomUUID()} appendSubmissionId={crypto.randomUUID()} commandAction={recordRealVisitEvidence.bind(null,visit.memberId)} refreshAction={refreshRealVisitEvidence.bind(null,visit.memberId)}/>:<p role="alert" className="rounded-xl bg-card p-4">{data.completion?t('Visit evidence is unavailable. Reload to check the saved records.','Այցի տվյալներն անհասանելի են։ Թարմացրեք՝ պահպանված գրառումները ստուգելու համար։','Данные визита недоступны. Обновите страницу, чтобы проверить сохранённые записи.'):t('This visit’s evidence is saved when you complete its checklist. Member-record entries are available separately.','Այս այցի տվյալները պահպանվում են ստուգաթերթն ավարտելիս։ Անդամի քարտի գրառումները հասանելի են առանձին։','Данные этого визита сохраняются при завершении контрольного списка. Записи карты участника доступны отдельно.')}</p>:
   <><aside role="status" className="space-y-2 rounded-xl border bg-card p-4">
    <h3 className="text-body2 font-semibold">{t('Check with your care team','Ճշտեք խնամքի թիմի հետ','Уточните у медицинской команды')}</h3>
    <p className="text-body2">{t('Ask the responsible doctor or administrator to check alerts and safety restrictions before the visit. This workspace does not show their status.','Այցից առաջ խնդրեք պատասխանատու բժշկին կամ ադմինիստրատորին ստուգել ահազանգերն ու անվտանգության սահմանափակումները։ Այս աշխատատարածքը դրանց վիճակը չի ցույց տալիս։','Перед визитом попросите ответственного врача или администратора проверить оповещения и ограничения безопасности. Это рабочее пространство не показывает их статус.')}</p>
   </aside><NurseVisitActions key={`${visit.source}:${visit.id}`} data={data} locale={locale} inline mark={recordNurseVisitMark} step={recordNurseVisitStep} complete={recordNurseVisitComplete} completeIds={{submissionId:crypto.randomUUID(),visitId:crypto.randomUUID(),openSubmissionId:crypto.randomUUID(),appendSubmissionId:crypto.randomUUID()}}/></>}
 </article>;
}
