import Link from 'next/link';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {readNurseMemberCard} from '@/lib/nurse-chat/member-card-actions';
import {RecordCard} from './zoe/cards';
import {CareTasks} from './care-tasks';
import {RealLabStages} from './real-lab-stages';
import {labStages} from '@/lib/staff/lab-stage-schema';
import {recordRealLabStage} from '@/lib/staff/lab-stage-actions';
import {BpWeekPanel} from './bp-week-panel';
import {NurseChatVisits,type NurseVisitSelection} from './nurse-chat-visits';

export async function NurseMemberWork({memberId,card,selection,locale}:{memberId:string;card?:string|string[];selection:NurseVisitSelection;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const active=typeof card==='string'&&['context','notes','samples','week','conversation'].includes(card)?card:'visits';
 const links=[['visits',t('Visit','Այց','Визит')],['context',t('Clinical context','Կլինիկական տվյալներ','Клинические данные')],['notes',t('Factual notes','Փաստական նշումներ','Фактические заметки')],['samples',t('Sample stages','Նմուշների ընթացքը','Этапы образцов')],['week',t('BP week','Ճնշման շաբաթ','Неделя АД')],['conversation',t('Conversation','Զրույց','Разговор')]];
 const href=(key:string)=>{const query=new URLSearchParams({member:memberId,card:key});for(const [name,value] of Object.entries(selection))if(typeof value==='string')query.set(name,value);return `/staff/real/nurse-chat?${query}` as const;};
 let content:React.ReactNode=null;
 const unavailable=<p role="alert" className="rounded-xl border bg-card p-4">{t('This card is unavailable. Reload to check your access and the saved record.','Այս քարտն անհասանելի է։ Թարմացրեք՝ ձեր հասանելիությունն ու պահպանված գրառումը ստուգելու համար։','Эта карточка недоступна. Обновите страницу и проверьте доступ и сохранённую запись.')}</p>;
 if(active==='visits')content=<NurseChatVisits memberId={memberId} selection={selection} locale={locale}/>;
 else if(active!=='conversation'){
  const result=await readNurseMemberCard(memberId,active);
  if(result.kind!=='ready')content=unavailable;
  else switch(result.card){
   case 'context':content=<div className="space-y-2">{result.cards.map((item,index)=><details key={item.tool} name="nurse-context" open={index===0} className="rounded-xl border bg-card p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{({overview:t('Overview','Ընդհանուր','Обзор'),bp:t('Blood pressure and sources','Ճնշում և աղբյուրներ','Давление и источники'),plan:t('Published plan','Հրապարակված պլան','Опубликованный план'),adherence:t('Medicines and adherence','Դեղեր և հետևողականություն','Препараты и приверженность'),open_items:t('Open tasks','Բաց առաջադրանքներ','Открытые задачи'),visits:t('Visit history','Այցերի պատմություն','История визитов')} as Record<string,string>)[item.tool]}</summary><RecordCard card={item} locale={locale} memberRef={memberId.slice(-8).toUpperCase()}/></details>)}</div>;break;
   case 'notes':content=<CareTasks id={memberId} revision={result.revision} native notesOnly notes={result.notes} locale={locale}/>;break;
   case 'samples':content=<>{result.visits.map(visit=><p key={`${visit.source}:${visit.id}`} className="rounded-xl border bg-card p-3 text-body2">{yerevanStamp(visit.startsAt,locale)} · {t(`${visit.samplesTaken} of ${visit.samplesPlanned} samples taken at the completed visit.`,`Ավարտված այցի ընթացքում վերցված նմուշներ՝ ${visit.samplesTaken}/${visit.samplesPlanned}։`,`Во время завершённого визита взято образцов: ${visit.samplesTaken} из ${visit.samplesPlanned}.`)}</p>)}{!result.data.samples.length&&result.visits.some(visit=>visit.samplesTaken>0)?<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('Collection is recorded in the visits above. Lab handover tracking is unavailable for these samples. Open the visit evidence and check with the care team before recording a handover.','Նմուշառումը գրանցված է վերևի այցերում։ Այս նմուշների լաբորատոր փոխանցման ընթացքը հասանելի չէ։ Փոխանցում գրանցելուց առաջ բացեք այցի տվյալները և ճշտեք խնամքի թիմի հետ։','Взятие образцов записано в визитах выше. Отслеживание передачи этих образцов в лабораторию недоступно. Перед записью передачи откройте данные визита и уточните у медицинской команды.')}</p>:<RealLabStages data={result.data} locale={locale} role="nurse" submissionIds={Object.fromEntries(result.data.samples.flatMap(sample=>labStages.map(stage=>[`${sample.entryId}:${stage}`,crypto.randomUUID()])))} commandAction={recordRealLabStage.bind(null,memberId)}/>}</>;break;
   case 'week':content=result.data?.enabled?<BpWeekPanel read={result.data} memberId={memberId} locale={locale} now={new Date(result.asOf)}/>:<p role="status" className="rounded-xl border bg-card p-4">{result.data?t('BP weeks are switched off.','Ճնշման շաբաթներն անջատված են։','Недели АД отключены.'):t('BP weeks are unavailable. Reload to check.','Ճնշման շաբաթներն անհասանելի են։ Թարմացրեք՝ ստուգելու համար։','Недели АД недоступны. Обновите страницу для проверки.')}</p>;break;
  }
 }
 return <section className="space-y-3" aria-label={t('Member work cards','Անդամի աշխատանքային քարտեր','Рабочие карточки участника')}>
  <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={t('Open one card','Բացել մեկ քարտ','Открыть одну карточку')}>{links.map(([key,label])=><Link key={key} href={href(key)} aria-current={active===key?'page':undefined} scroll={false} className={`dw-pill shrink-0 whitespace-nowrap ${active===key?'border border-primary':''}`}>{label}</Link>)}</nav>
  {content}
 </section>;
}
