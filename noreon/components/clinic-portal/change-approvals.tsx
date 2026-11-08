'use client';
import {useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Locale} from '@/lib/locale';
import {clinicDate,clinicTimestamp} from '@/lib/clinic-portal/display-time';
import type {ChangeRequest,DecisionOutcome} from '@/lib/clinic-admin/approvals-schema';
export const approvalText=(locale:Locale,en:string,hy:string,ru:string)=>locale==='hy'?hy:locale==='ru'?ru:en;
export function decisionText(locale:Locale,outcome:DecisionOutcome){
 const t=(en:string,hy:string,ru:string)=>approvalText(locale,en,hy,ru);
 switch(outcome){
 case 'approved':return t('Approved.','Հաստատված է։','Одобрено.');
 case 'rejected':return t('Rejected.','Մերժված է։','Отклонено.');
 case 'cancelled':return t('Cancelled.','Չեղարկված է։','Отменено.');
 case 'stale':return t('No longer valid: the details changed.','Այլևս վավեր չէ․ տվյալները փոխվել են։','Больше не действует: данные изменились.');
 case 'expired':return t('This request expired after 7 days. Send a new request.','Այս հարցման ժամկետը լրացել է 7 օր անց։ Ուղարկեք նոր հարցում։','Срок запроса истёк через 7 дней. Отправьте новый запрос.');
 case 'self_approval':return t('Another clinic admin or Noreon must approve your request.','Ձեր հարցումը պետք է հաստատի կլինիկայի մեկ այլ ադմինիստրատոր կամ Նորեոն Հելթը։','Ваш запрос должен одобрить другой администратор клиники или Нореон Хелс.');
 case 'reason_required':return t('Write a reason of 5 to 500 characters.','Գրեք 5-ից 500 նիշից բաղկացած պատճառ։','Укажите причину длиной от 5 до 500 символов.');
 case 'not_pending':return t('This request has already been decided. Reload the list.','Այս հարցման վերաբերյալ արդեն որոշում կա։ Թարմացրեք ցանկը։','По этому запросу уже принято решение. Обновите список.');
 case 'disabled':return t('Change approvals are not switched on yet.','Փոփոխությունների հաստատումը դեռ միացված չէ։','Согласование изменений пока не включено.');
 case 'refused':return t('You cannot decide this request.','Դուք չեք կարող որոշում կայացնել այս հարցման վերաբերյալ։','Вы не можете принять решение по этому запросу.');
 case 'invalid':return t('Check the request and try again.','Ստուգեք հարցումը և նորից փորձեք։','Проверьте запрос и попробуйте снова.');
 default:return t('The result could not be confirmed. Reload the list before trying again.','Արդյունքը չհաջողվեց հաստատել։ Նորից փորձելուց առաջ թարմացրեք ցանկը։','Не удалось подтвердить результат. Обновите список перед повторной попыткой.');
 }
}
/** "Approved by <name>, <time>" once the database names the decider; the bare outcome before that. */
export function decidedLine(locale:Locale,request:Pick<ChangeRequest,'state'|'decidedAt'|'deciderName'>){
 const t=(en:string,hy:string,ru:string)=>approvalText(locale,en,hy,ru);
 const when=request.decidedAt?`${clinicTimestamp(request.decidedAt,locale)} (UTC+4)`:null;
 const who=request.deciderName;
 if(request.state==='pending')return '';
 if(who&&request.state==='approved')return `${t(`Approved by ${who}`,`Հաստատել է՝ ${who}`,`Одобрено администратором ${who}`)}${when?`, ${when}`:''}`;
 if(who&&request.state==='rejected')return `${t(`Rejected by ${who}`,`Մերժել է՝ ${who}`,`Отклонено администратором ${who}`)}${when?`, ${when}`:''}`;
 return `${decisionText(locale,request.state)}${when?` · ${when}`:''}`;
}
export function ChangeSummary({request,locale,staff=false}:{request:ChangeRequest;locale:Locale;staff?:boolean}){
 const t=(en:string,hy:string,ru:string)=>approvalText(locale,en,hy,ru),s=request.summary,none=t('Not given','Նշված չէ','Не указано');
 const rows:[string,string|null|number,string|null|number][]=[];
 if(s.name)rows.push([t('Name','Անուն','Имя'),s.name.before,s.name.after]);
 if(s.birthDate){const b=s.birthDate;rows.push([t('Date of birth','Ծննդյան ամսաթիվ','Дата рождения'),staff&&'before'in b?(b.before?clinicDate(b.before,locale):null):b.beforeYear,staff&&'after'in b?(b.after?clinicDate(b.after,locale):null):b.afterYear]);}
 if(s.doctor)rows.push([t('Doctor','Բժիշկ','Врач'),s.doctor.before,s.doctor.after]);
 if(s.nurse)rows.push([t('Nurse','Բուժքույր','Медсестра'),s.nurse.before,s.nurse.after]);
 return <dl className="space-y-2 text-body2">{rows.map(([label,before,after])=><div key={label}><dt className="font-medium">{label}</dt><dd className="break-words">{before??none} → {after??none}</dd></div>)}</dl>;
}
const button='inline-flex min-h-12 items-center justify-center rounded-md border px-4 text-body2 disabled:opacity-60';
function RequestCard({request,locale,staff=false,decide,compact=false}:{request:ChangeRequest;locale:Locale;staff?:boolean;compact?:boolean;decide:(input:unknown)=>Promise<DecisionOutcome>}){
 const router=useRouter(),t=(en:string,hy:string,ru:string)=>approvalText(locale,en,hy,ru);
 const [note,setNote]=useState(''),[rejecting,setRejecting]=useState(false),[busy,setBusy]=useState(false),[outcome,setOutcome]=useState<DecisionOutcome|null>(null),lock=useRef(false),id=useId();
 const pending=request.state==='pending'&&(!outcome||['unavailable','invalid','reason_required','refused','self_approval','disabled'].includes(outcome));
 async function run(decision:'approve'|'reject'|'cancel'){
  if(lock.current)return;
  if(decision==='reject'&&(note.trim().length<5||note.trim().length>500)){setOutcome('reason_required');return;}
  lock.current=true;setBusy(true);
  let result:DecisionOutcome;try{result=await decide({requestId:request.id,decision,...(decision==='reject'?{note:note.trim()}: {})});}catch{result='unavailable';}
  setOutcome(result);lock.current=false;setBusy(false);router.refresh();
 }
 return <article className="space-y-3 rounded-lg border bg-background p-4" aria-busy={busy}>
  <h2 className="break-words text-h3">{compact?t('Waiting for approval:','Սպասում է հաստատման․','Ожидает согласования:'):<a className="underline underline-offset-4" href={(staff?`/staff/real/members/${request.memberId}`:`/clinic/real/records/${request.memberId}?clinic=${request.clinicId}&locale=${locale}`)}>{request.memberName}</a>}</h2>
  {staff&&<p className="text-body2">{request.clinicName}</p>}
  <p className="text-caption text-muted-foreground">{request.requesterName??t('Clinic admin','Կլինիկայի ադմինիստրատոր','Администратор клиники')} · {clinicTimestamp(request.createdAt,locale)} (UTC+4)</p>
  <ChangeSummary request={request} locale={locale} staff={staff}/>
  {request.state!=='pending'&&<p className="text-body2">{decidedLine(locale,request)}</p>}
  {request.decisionNote&&<p className="break-words whitespace-pre-wrap text-body2">{request.state==='rejected'?t('Rejected: ','Մերժված է․ ','Отклонено: '):''}{request.decisionNote}</p>}
  {outcome&&<p role={['approved','rejected','cancelled'].includes(outcome)?'status':'alert'} className="text-body2">{decisionText(locale,outcome)}</p>}
  {pending&&request.mine&&<p className="text-body2 text-muted-foreground">{t('You asked for this. Another admin must approve it.','Այս հարցումն ուղարկել եք դուք։ Այն պետք է հաստատի մեկ այլ ադմինիստրատոր։','Этот запрос отправили вы. Его должен одобрить другой администратор.')}</p>}
  {pending&&(!compact||request.mine)&&<div className="space-y-3">
   {request.mine?!staff&&<button disabled={busy} className={button} onClick={()=>run('cancel')}>{t('Cancel request','Չեղարկել հարցումը','Отменить запрос')}</button>:<>
    <div className="flex flex-wrap gap-3"><button disabled={busy} className={button} onClick={()=>run('approve')}>{t('Approve change','Հաստատել փոփոխությունը','Одобрить изменение')}</button><button disabled={busy} className={button} onClick={()=>setRejecting(true)}>{t('Reject change','Մերժել փոփոխությունը','Отклонить изменение')}</button></div>
    {rejecting&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();void run('reject');}}><label htmlFor={id} className="block text-body2">{t('Reason for rejection','Մերժման պատճառը','Причина отклонения')}</label><textarea id={id} required minLength={5} maxLength={500} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} className="w-full rounded-md border bg-background p-3 text-body2"/><button disabled={busy} className={button}>{t('Reject request','Մերժել հարցումը','Отклонить запрос')}</button></form>}
   </>}
  </div>}
 </article>;
}
export function ChangeApprovals({requests,locale,staff=false,decide,compact=false}:{requests:ChangeRequest[];locale:Locale;staff?:boolean;compact?:boolean;decide:(input:unknown)=>Promise<DecisionOutcome>}){
 return <div className="space-y-4">{requests.filter(request=>request.kind==='care_team').map(request=><RequestCard key={request.id} request={request} locale={locale} staff={staff} compact={compact} decide={decide}/>)}</div>;
}
