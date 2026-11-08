'use client';
import type {Locale} from '@/lib/locale';
import {useState} from 'react';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import {FileText} from 'lucide-react';
import {buttonClass} from './shell';
import {LabAiStatus} from './lab-ai-status';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {LabOverview} from '@/lib/lab-ai/doctor-schema';
import {memberDocumentVersion,type DocumentCommand,type DocumentCommandPort,type DocumentResult,type DoctorDocument,type DoctorDocumentsRead} from '@/lib/doctor-completion/document-schema';

const enCopy={title:'Lab documents for this member',intro:'Clinic lab PDFs attached to this member. The member sees a document only after you release it, separately from the care plan.',empty:'No clinic lab documents are attached to this member.',
  open:'Open PDF',opened:'You opened this document.',notOpened:'Open the PDF before releasing it.',released:'Released to the member',notReleased:'Not released',
  confirm:'This PDF contains only this member’s results.',release:'Release to member',withdraw:'Withdraw from member',saving:'Saving…',checkAgain:'Check again',
  done:{released:'Released. The member can now open this document.',withdrawn:'Withdrawn. The member can no longer open this document.'},
  status:{unchanged:'Nothing changed. Reload to see the current state.','confirm-required':'Confirm that the PDF contains only this member’s results.','open-first':'Open the PDF first, then release it.',stale:'This document changed or was moved. Reload to see the current documents.',invalid:'Check the document details and reload.',disabled:'Document release is switched off.',access:'Only the assigned doctor can release documents.',unavailable:'Couldn’t save right now. Try again.','outcome-unknown':'Save outcome unknown. Check again: a release is never recorded twice.'},
  uploaded:'Uploaded'};
const copy:Record<Locale,typeof enCopy>={
 en:enCopy,
 hy:{title:'Անդամի լաբորատոր փաստաթղթերը',intro:'Այս անդամին կցված կլինիկայի լաբորատոր PDF-ները։ Անդամը փաստաթուղթը տեսնում է միայն այն բանից հետո, երբ դուք այն հասանելի եք դարձնում՝ խնամքի պլանից առանձին։',empty:'Այս անդամին կլինիկայի լաբորատոր փաստաթղթեր կցված չեն։',
  open:'Բացել PDF-ը',opened:'Դուք բացել եք այս փաստաթուղթը։',notOpened:'Բացեք PDF-ը՝ նախքան այն հասանելի դարձնելը։',released:'Հասանելի է անդամին',notReleased:'Հասանելի չէ',
  confirm:'Այս PDF-ը պարունակում է միայն այս անդամի արդյունքները։',release:'Հասանելի դարձնել անդամին',withdraw:'Հետ վերցնել անդամից',saving:'Պահպանվում է…',checkAgain:'Կրկին ստուգել',
  done:{released:'Հասանելի է։ Անդամն այժմ կարող է բացել այս փաստաթուղթը։',withdrawn:'Հետ է վերցված։ Անդամն այլևս չի կարող բացել այս փաստաթուղթը։'},
  status:{unchanged:'Ոչինչ չփոխվեց։ Թարմացրեք էջը՝ ընթացիկ վիճակը տեսնելու համար։','confirm-required':'Հաստատեք, որ PDF-ը պարունակում է միայն այս անդամի արդյունքները։','open-first':'Նախ բացեք PDF-ը, ապա հասանելի դարձրեք այն։',stale:'Այս փաստաթուղթը փոխվել կամ տեղափոխվել է։ Թարմացրեք էջը։',invalid:'Ստուգեք փաստաթղթի տվյալները և թարմացրեք էջը։',disabled:'Փաստաթղթերի տրամադրումն անջատված է։',access:'Միայն կցված բժիշկը կարող է փաստաթղթեր տրամադրել։',unavailable:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։','outcome-unknown':'Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք․ տրամադրումը երբեք երկու անգամ չի գրանցվում։'},
  uploaded:'Վերբեռնվել է'},
 ru:{
  title:"Лабораторные документы участника",
  intro:"Лабораторные PDF клиники, прикреплённые к этому участнику. Участник видит документ только после того, как вы откроете ему доступ, отдельно от плана помощи.",
  empty:"К этому участнику не прикреплены лабораторные документы клиники.",open:"Открыть PDF",opened:"Вы открыли этот документ.",notOpened:"Откройте PDF перед предоставлением доступа.",
  released:"Доступен участнику",notReleased:"Доступ не предоставлен",confirm:"Этот PDF содержит результаты только этого участника.",release:"Предоставить доступ участнику",
  withdraw:"Отозвать доступ участника",saving:"Сохраняется…",checkAgain:"Проверить ещё раз",
  done:{released:"Доступ предоставлен. Теперь участник может открыть этот документ.",withdrawn:"Доступ отозван. Участник больше не может открыть этот документ."},
  status:{unchanged:"Ничего не изменилось. Обновите страницу, чтобы увидеть текущее состояние.","confirm-required":"Подтвердите, что PDF содержит результаты только этого участника.","open-first":"Сначала откройте PDF, затем предоставьте доступ.",stale:"Документ изменён или перемещён. Обновите страницу, чтобы увидеть текущие документы.",invalid:"Проверьте данные документа и обновите страницу.",disabled:"Предоставление доступа к документам отключено.",access:"Только назначенный врач может предоставлять доступ к документам.",unavailable:"Сейчас не удалось сохранить. Попробуйте снова.","outcome-unknown":"Результат сохранения неизвестен. Проверьте ещё раз: предоставление доступа никогда не записывается дважды."},
  uploaded:"Загружено",
 },
};
type Props={data:DoctorDocumentsRead;memberId:string;locale:Locale;submissionIds:Record<string,string>;command:DocumentCommandPort;
 /** AI reading of each document (dark); absent when the feature is off. */lab?:LabOverview|null;onCheckValues?:(fileId:string)=>void};

export function MemberDocuments(props:Props){
 const t=copy[props.locale];
 if(!props.data.enabled)return null;
 return <section className="max-w-3xl space-y-4 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="member-documents-title" lang={props.locale}>
  <header className="space-y-1"><h2 id="member-documents-title" className="flex items-center gap-2 text-h3"><FileText className="size-5" aria-hidden/>{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p></header>
  {props.data.documents.length?<ul className="space-y-4">{props.data.documents.map(doc=><DocumentRow key={doc.fileId} doc={doc} {...props}/>)}</ul>:<p className="text-body2">{t.empty}</p>}
 </section>;
}

function DocumentRow(props:Props&{doc:DoctorDocument}){
 const {doc,memberId,locale,submissionIds,command}=props;
 const t=copy[locale];
 const refresh=useRecordRefresh();
 const [confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null),[frozen,setFrozen]=useState<DocumentCommand|null>(null);
 const action=doc.released?'withdraw':'release';
 async function send(input:DocumentCommand){
  setPending(true);setMessage(null);
  const result=await command(input).catch(():DocumentResult=>({status:'outcome-unknown'}));
  setPending(false);
  if(result.status==='released'||result.status==='withdrawn'){setFrozen(null);setMessage({ok:true,text:t.done[result.status]});refresh();return;}
  if(result.status!=='outcome-unknown')setFrozen(null);
  setMessage({ok:false,text:t.status[result.status]});
 }
 function submit(){
  if(pending)return;
  const submissionId=submissionIds[`${doc.fileId}:${action}`];if(!submissionId)return;
  const input:DocumentCommand={version:memberDocumentVersion,submissionId,memberId,fileId:doc.fileId,action,...(action==='release'?{singleMemberConfirmed:confirmed}:{})};
  setFrozen(input);void send(input);
 }
 const boxId=`document-confirm-${doc.fileId}`;
 return <li className="min-w-0 space-y-3 rounded-lg border p-4">
  <div className="space-y-1"><h3 className="break-words text-body1 font-medium">{doc.name}</h3>
   <p className="text-caption text-muted-foreground">{t.uploaded} <time dateTime={doc.uploadedAt}>{yerevanStamp(doc.uploadedAt,locale)}</time> · {doc.clinic}</p>
   <p className="text-body2">{doc.released&&doc.releasedAt?<>{t.released} · <time dateTime={doc.releasedAt}>{yerevanStamp(doc.releasedAt,locale)}</time></>:t.notReleased}</p></div>
  <a className="inline-flex min-h-11 items-center underline" href={`/staff/real/members/${memberId}/documents/${doc.fileId}`} target="_blank" rel="noreferrer" onClick={()=>setTimeout(()=>refresh(true),1500)}>{t.open}</a>
  {props.lab!==undefined&&<LabAiStatus onOpen={props.onCheckValues?()=>props.onCheckValues!(doc.fileId):undefined} file={props.lab?.enabled?props.lab.files.find(f=>f.fileId===doc.fileId):props.lab===null?null:undefined} href={`/staff/real/members/${memberId}/documents/${doc.fileId}/check`} locale={locale}/>}
  {!doc.released&&<p className="text-caption text-muted-foreground">{doc.openedByYou?t.opened:t.notOpened}</p>}
  {!doc.released&&doc.openedByYou&&!frozen&&<label htmlFor={boxId} className="flex min-h-11 items-start gap-3 text-body2"><input id={boxId} type="checkbox" className="mt-1 size-5 shrink-0" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t.confirm}</label>}
  {message&&<p role={message.ok?'status':'alert'} className="text-body2">{message.text}</p>}
  {frozen&&message&&!message.ok?<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send(frozen)}>{pending?t.saving:t.checkAgain}</button>
   :(doc.released||doc.openedByYou)&&<button type="button" className={buttonClass} disabled={pending||(action==='release'&&!confirmed)} onClick={submit}>{pending?t.saving:action==='release'?t.release:t.withdraw}</button>}
 </li>;
}
