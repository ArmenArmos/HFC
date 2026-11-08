'use client';
import {clinicIdentityMatchLabel} from '@/lib/clinic-portal/identity-match-label';
import type{ClinicMemberMasked}from'@/lib/clinic-portal/member-masked-schema';
import{clinicMaskedBirthYear}from'./member-masked';
import{useCallback,useEffect,useId,useMemo,useRef,useState}from'react';
import{SelectField}from'@/components/ui/select-field';
import{unstable_rethrow}from'next/navigation';
import{AlertTriangle,Bot,CheckCircle2,Loader2,UserSearch}from'lucide-react';
import{clinicLabLink,clinicLabResults}from'@/lib/clinic-portal/lab-results-actions';
import{clinicLabStatus,type ClinicLabFile,type ClinicLabLinkResult,type ClinicLabLinkCommand,type ClinicLabResults,type ClinicLabStatus}from'@/lib/clinic-portal/lab-results-schema';
import{clinicLabFileLabel,clinicTimestamp as yerevanStamp}from'@/lib/clinic-portal/display-time';

import{pick,type Locale}from'@/lib/locale';
const en={title:'Results in this batch',intro:'Each PDF is read automatically and matched to a member who has a booking at this clinic. Check the suggestion and confirm, or choose the member yourself. Confirming completes that member’s visit.',
  unavailable:'Results could not load. Your files are safe. Try again.',retry:'Try again',empty:'No stored PDFs in this batch yet.',
  steps:['Reading','Suggested member','Confirmed'],
  status:{linked:'Confirmed',noreon:'Noreon is handling this file',['needs-review']:'Needs Noreon review',reading:'Reading the PDF',suggested:'Suggested member',choose:'Choose the member'} as Record<ClinicLabStatus,string>,
  confidence:{high:'Strong match: name and date of birth',medium:'Likely match: name and visit date',low:'Weak match'} as Record<string,string>,
  onSheet:'On the sheet',born:'born',sample:'sample',notRead:'not read',
  reviewWhy:{multiple:'This PDF seems to hold results for more than one person.',mismatch:'The name on the sheet is not one of your members with a booking.',noreon:'It was linked before and then moved by Noreon.'},
  readingOff:'Automatic reading is off. Choose the member.',couldNotRead:'The PDF could not be read automatically. Choose the member.',unreadable:'Couldn’t read this file. Please re-scan it or upload a clearer copy. You can also choose the member yourself.',
  confirm:'Confirm',chooseOther:'Choose another member',chooseAnyway:'Choose the member anyway',choose:'Choose member',search:'Search your members by name',noMatch:'No member with a booking here matches.',capped:'Only the 1,000 members with the most recent bookings are listed. If you cannot find the member, ask Noreon to link the file.',link:'Link to this member',cancel:'Cancel',saving:'Saving…',
  booking:'booking',linkedTo:(name:string,at:string)=>`Linked to ${name} · ${at}`,
  pickVisit:'This member has more than one booking. Which visit are these results from?',
  result:{saved:'Linked. The visit is marked completed and the results are with Noreon.',stale:'This file is already linked. Noreon can correct it.',access:'You can’t link results for this clinic.',disabled:'Linking results is not available yet.',
   ['needs-review']:'This file needs Noreon review before it can be linked. Keep this upload and ask Noreon to review it. Refresh status to check for changes.',['not-this-clinic']:'This member has no booking at your clinic, so Noreon will review the file.',invalid:'This can’t be linked. Refresh and check.',ambiguous:'Two members share this name. Ask Noreon.',
   unavailable:'Couldn’t save right now. Try again.',['outcome-unknown']:'Save outcome unknown. Retry the same link before choosing another member.',['choose-visit']:''} as Record<string,string>};
const copy:Record<Locale,typeof en>={
 en,
 hy:{title:'Այս փաթեթի արդյունքները',intro:'Յուրաքանչյուր PDF կարդացվում է ավտոմատ և համադրվում այս կլինիկայում գրանցում ունեցող անդամի հետ։ Ստուգեք առաջարկը և հաստատեք, կամ ընտրեք անդամին ինքներդ։ Հաստատումը ավարտում է անդամի այցը։',
  unavailable:'Արդյունքները չբեռնվեցին։ Ձեր ֆայլերն անվտանգ են։ Փորձեք կրկին։',retry:'Փորձել կրկին',empty:'Այս փաթեթում դեռ պահպանված PDF չկա։',
  steps:['Կարդացվում է','Առաջարկվող անդամ','Հաստատված'],
  status:{linked:'Հաստատված',noreon:'Այս ֆայլով զբաղվում է Նորեոն Հելթը',['needs-review']:'Պահանջում է Նորեոն Հելթի ստուգում',reading:'PDF-ը կարդացվում է',suggested:'Առաջարկվող անդամ',choose:'Ընտրեք անդամին'} as Record<ClinicLabStatus,string>,
  confidence:{high:'Ուժեղ համընկնում՝ անուն և ծննդյան ամսաթիվ',medium:'Հավանական համընկնում՝ անուն և այցի ամսաթիվ',low:'Թույլ համընկնում'} as Record<string,string>,
  onSheet:'Թերթում',born:'ծնվ.',sample:'նմուշ',notRead:'չի կարդացվել',
  reviewWhy:{multiple:'Այս PDF-ը կարծես մեկից ավելի մարդու արդյունքներ ունի։',mismatch:'Թերթի անունը ձեր գրանցում ունեցող անդամներից չէ։',noreon:'Այն նախկինում կապվել էր, հետո Նորեոն Հելթը տեղափոխել է։'},
  readingOff:'Ավտոմատ կարդալն անջատված է։ Ընտրեք անդամին։',couldNotRead:'PDF-ը հնարավոր չեղավ ավտոմատ կարդալ։ Ընտրեք անդամին։',unreadable:'Այս ֆայլը հնարավոր չեղավ կարդալ։ Խնդրում ենք նորից սկանավորել կամ վերբեռնել ավելի հստակ պատճեն։ Կարող եք նաև ինքներդ ընտրել անդամին։',
  confirm:'Հաստատել',chooseOther:'Ընտրել այլ անդամ',chooseAnyway:'Այնուամենայնիվ ընտրել անդամին',choose:'Ընտրել անդամ',search:'Որոնել ձեր անդամներին անունով',noMatch:'Այստեղ գրանցում ունեցող համապատասխան անդամ չկա։',capped:'Ցուցադրված են միայն ամենավերջին գրանցումներ ունեցող 1000 անդամները։ Եթե անդամին չեք գտնում, խնդրեք Նորեոն Հելթին կապել ֆայլը։',link:'Կապել այս անդամին',cancel:'Չեղարկել',saving:'Պահպանվում է…',
  booking:'գրանցում',linkedTo:(name:string,at:string)=>`Կապված է՝ ${name} · ${at}`,
  pickVisit:'Այս անդամն ունի մեկից ավելի գրանցում։ Ո՞ր այցից են այս արդյունքները։',
  result:{saved:'Կապված է։ Այցը նշվել է ավարտված, արդյունքները Նորեոն Հելթում են։',stale:'Այս ֆայլն արդեն կապված է։ Նորեոն Հելթը կարող է ուղղել այն։',access:'Դուք չեք կարող արդյունքներ կապել այս կլինիկայի համար։',disabled:'Արդյունքների կապումը դեռ հասանելի չէ։',
   ['needs-review']:'Կապելուց առաջ ֆայլը պետք է ստուգի Նորեոն Հելթը։ Պահեք այս վերբեռնումը և խնդրեք Նորեոն Հելթին ստուգել այն։ Փոփոխությունները տեսնելու համար թարմացրեք կարգավիճակը։',['not-this-clinic']:'Այս անդամը ձեր կլինիկայում գրանցում չունի, Նորեոն Հելթը կստուգի ֆայլը։',invalid:'Սա հնարավոր չէ կապել։ Թարմացրեք և ստուգեք։',ambiguous:'Երկու անդամ նույն անունն ունեն։ Դիմեք Նորեոն Հելթին։',
   unavailable:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։',['outcome-unknown']:'Պահպանման արդյունքն անհայտ է։ Կրկնեք նույն կապումը՝ նախքան այլ անդամ ընտրելը։',['choose-visit']:''} as Record<string,string>},
 ru:{title:'Результаты в этом пакете',intro:'Каждый PDF читается автоматически и сопоставляется с участником, у которого есть запись в эту клинику. Проверьте предложение и подтвердите его или выберите участника самостоятельно. Подтверждение завершает визит этого участника.',
  unavailable:'Не удалось загрузить результаты. Ваши файлы в безопасности. Попробуйте снова.',retry:'Попробовать снова',empty:'В этом пакете пока нет сохранённых PDF.',
  steps:['Чтение','Предложенный участник','Подтверждено'],
  status:{linked:'Подтверждено',noreon:'Нореон Хелс занимается этим файлом',['needs-review']:'Нужна проверка Нореон Хелс',reading:'Чтение PDF',suggested:'Предложенный участник',choose:'Выберите участника'},
  confidence:{high:'Уверенное совпадение: имя и дата рождения',medium:'Вероятное совпадение: имя и дата визита',low:'Слабое совпадение'},
  onSheet:'В документе',born:'дата рождения',sample:'образец',notRead:'не прочитано',
  reviewWhy:{multiple:'Похоже, этот PDF содержит результаты нескольких людей.',mismatch:'Имя в документе не совпадает с именами ваших участников, у которых есть запись.',noreon:'Ранее файл был привязан, затем Нореон Хелс изменил привязку.'},
  readingOff:'Автоматическое чтение отключено. Выберите участника.',couldNotRead:'Не удалось прочитать PDF автоматически. Выберите участника.',unreadable:'Не удалось прочитать этот файл. Отсканируйте его повторно или загрузите более чёткую копию. Вы также можете выбрать участника самостоятельно.',
  confirm:'Подтвердить',chooseOther:'Выбрать другого участника',chooseAnyway:'Всё равно выбрать участника',choose:'Выбрать участника',search:'Поиск ваших участников по имени',noMatch:'Нет подходящего участника с записью в эту клинику.',capped:'Показаны только 1000 участников с самыми недавними записями. Если вы не можете найти участника, попросите Нореон Хелс привязать файл.',link:'Привязать к этому участнику',cancel:'Отменить',saving:'Сохраняется…',
  booking:'запись',linkedTo:(name:string,at:string)=>`Привязано к ${name} · ${at}`,
  pickVisit:'У этого участника несколько записей. К какому визиту относятся эти результаты?',
  result:{saved:'Привязано. Визит отмечен как завершённый, результаты переданы Нореон Хелс.',stale:'Этот файл уже привязан. Нореон Хелс может исправить привязку.',access:'Вы не можете привязывать результаты для этой клиники.',disabled:'Привязка результатов пока недоступна.',
   ['needs-review']:'Перед привязкой файл должен проверить Нореон Хелс. Сохраните эту загрузку и попросите Нореон Хелс проверить её. Обновите статус, чтобы увидеть изменения.',['not-this-clinic']:'У этого участника нет записи в вашу клинику, поэтому Нореон Хелс проверит файл.',invalid:'Не удалось привязать. Обновите страницу и проверьте.',ambiguous:'У двух участников одинаковое имя. Обратитесь в Нореон Хелс.',
   unavailable:'Сейчас не удалось сохранить. Попробуйте снова.',['outcome-unknown']:'Результат сохранения неизвестен. Повторите ту же привязку, прежде чем выбирать другого участника.',['choose-visit']:''}},
};
type T=typeof copy.en;
const button='inline-flex min-h-12 items-center justify-center rounded-md border px-4 text-body2 font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring';
const primary='inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring';

/** One list for the batch: reading, suggestion and link per stored PDF (dark with result attach). */
type ResultsProps={clinicId:string;batchId:string;actorScope:string;locale:Locale;refreshKey:number;initial?:ClinicLabResults;fromRecords?:boolean;onOpenMember?:()=>void};
export function ClinicLabResults(props:ResultsProps){return <ClinicLabResultsList key={JSON.stringify([props.clinicId,props.batchId,props.actorScope])} {...props}/>;}
function ClinicLabResultsList({clinicId,batchId,actorScope,locale,refreshKey,initial,fromRecords=false,onOpenMember}:ResultsProps){
 const t=copy[locale],headingId=useId();
 const[data,setData]=useState<ClinicLabResults|null>(initial??null),[failed,setFailed]=useState(false),alive=useRef(true),readSequence=useRef(0);
 const revoke=useCallback(()=>{readSequence.current++;setData(null);setFailed(true);},[]);
 const load=useCallback(async()=>{
  const sequence=++readSequence.current;
  try{const r=await clinicLabResults(clinicId,batchId,actorScope);if(!alive.current||sequence!==readSequence.current)return;if(r.status==='loaded'){setData(r.data);setFailed(false);}else{setData(null);setFailed(true);}}
  catch(e){unstable_rethrow(e);if(alive.current&&sequence===readSequence.current){setData(null);setFailed(true);}}
 },[clinicId,batchId,actorScope]);
 useEffect(()=>{alive.current=true;readSequence.current++;const id=!initial||refreshKey?setTimeout(()=>void load(),0):undefined;return()=>{alive.current=false;clearTimeout(id);};},[load,refreshKey,initial]);
 const reading=data?.files.some(f=>clinicLabStatus(f,data.reading)==='reading');
 useEffect(()=>{if(!reading||initial)return;const id=setInterval(()=>void load(),15000);return()=>clearInterval(id);},[reading,load,initial]);
 if(!data)return failed?<div role="alert" className="space-y-3 rounded-xl border bg-background p-5"><p className="text-body2">{t.unavailable}</p><button type="button" className={button} onClick={()=>void load()}>{t.retry}</button></div>:<p role="status" className="text-body2 text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden/>{t.status.reading}</p>;
 if(!data.enabled)return null;
 return <section lang={locale} aria-labelledby={headingId} className="space-y-4">
  <div className="space-y-1"><h2 id={headingId} className="text-h2">{t.title}</h2><p className="max-w-3xl text-body2 text-muted-foreground">{t.intro}</p></div>
  {failed&&<p role="alert" className="text-body2">{t.unavailable}</p>}
  {data.files.length?<ul className="space-y-3">{data.files.map(f=><FileRow key={f.fileId} file={f} data={data} t={t} locale={locale} clinicId={clinicId} actorScope={actorScope} fromRecords={fromRecords} onOpenMember={onOpenMember} onDenied={revoke} onChanged={load}/>)}</ul>
   :<p role="status" className="rounded-lg border bg-background p-5 text-body2">{t.empty}</p>}
 </section>;
}

function Steps({status,t}:{status:ClinicLabStatus;t:T}){
 const at=status==='linked'?2:status==='suggested'||status==='choose'?1:status==='reading'?0:-1;
 if(at<0)return null;
 return <ol className="flex flex-wrap gap-x-2 gap-y-1 text-caption" aria-label={t.steps.join(', ')}>{t.steps.map((s,i)=><li key={s} aria-current={i===at?'step':undefined} className={`flex items-center gap-1 ${i<=at?'font-medium text-foreground':'text-muted-foreground'}`}>{i>0&&<span aria-hidden className="text-muted-foreground">→</span>}{s}</li>)}</ol>;
}

function FileRow({file,data,t,locale,clinicId,actorScope,fromRecords,onOpenMember,onDenied,onChanged}:{file:ClinicLabFile;data:ClinicLabResults;t:T;locale:Locale;clinicId:string;actorScope:string;fromRecords:boolean;onOpenMember?:()=>void;onDenied:()=>void;onChanged:()=>Promise<void>}){
 const [reviewBlocked,setReviewBlocked]=useState(false),[longRead,setLongRead]=useState(false);
 const currentStatus=clinicLabStatus(file,data.reading),status=reviewBlocked&&currentStatus==='reading'?'needs-review':currentStatus;
 useEffect(()=>{if(status!=='reading')return;const timer=setTimeout(()=>setLongRead(true),60_000);return()=>clearTimeout(timer);},[status]);
 const[choosing,setChoosing]=useState(false),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 const[visits,setVisits]=useState<{memberId:string;options:{appointmentId:string;startsAt:string}[]}|null>(null);
 const frozen=useRef<ClinicLabLinkCommand|null>(null),submission=useRef<Record<string,string>>({}),busy=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const r=file.reading;
 async function link(memberId:string,appointmentId?:string,retry=false){
  if(busy.current||(frozen.current&&!retry))return;busy.current=true;
  // One submission per member choice, so a resend replays instead of linking twice.
  const sub=submission.current[memberId]??=crypto.randomUUID();
  const command=frozen.current??{version:'clinic-lab-link-v1' as const,submissionId:sub,fileId:file.fileId,memberId,...(appointmentId?{appointmentId}:{})};
  frozen.current=command;
  setPending(true);setMessage(null);
  let res:ClinicLabLinkResult;
  try{res=await clinicLabLink(clinicId,command,actorScope);}catch(e){unstable_rethrow(e);res={status:'outcome-unknown'};}
  if(!alive.current)return;
  const unknown=res.status==='outcome-unknown'||res.status==='unavailable';
  setUncertain(unknown);if(!unknown)frozen.current=null;
  if(res.status==='access'||res.status==='disabled'){onDenied();return;}
  if(res.status==='choose-visit'){setVisits({memberId,options:res.options});busy.current=false;setPending(false);return;}
  if(!unknown)setVisits(null);
  if(res.status==='needs-review')setReviewBlocked(true);
  setMessage({ok:res.status==='saved',text:t.result[res.status]??res.status});
  if(res.status==='saved'||res.status==='stale'||res.status==='needs-review'||res.status==='not-this-clinic'){setChoosing(false);await onChanged();}
  busy.current=false;if(alive.current)setPending(false);
 }
 const sheet=r?<p className="text-caption text-muted-foreground">{clinicIdentityMatchLabel('name',r.nameMatch,locale)} · {clinicIdentityMatchLabel('birthYear',r.birthYearMatch,locale)}</p>:null;
 const tone=status==='linked'?'border-brand-teal':status==='needs-review'?'border-destructive':'';
 return <li className={`min-w-0 space-y-3 rounded-xl border bg-background p-4 ${tone}`}>
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div className="min-w-0 space-y-1"><p className="break-words text-body1 font-medium">{clinicLabFileLabel(file.uploadedAt,locale)}</p><p className="text-caption text-muted-foreground"><time dateTime={file.uploadedAt}>{yerevanStamp(file.uploadedAt,locale)}</time></p></div>
   <p className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-caption font-medium">
    {status==='linked'?<CheckCircle2 className="size-4" aria-hidden/>:status==='needs-review'?<AlertTriangle className="size-4" aria-hidden/>:status==='reading'&&!longRead?<Loader2 className="size-4 animate-spin" aria-hidden/>:<Bot className="size-4" aria-hidden/>}{t.status[status]}</p>
  </div>
  <Steps status={status} t={t}/>
  {status==='reading'&&<p role="status" className="text-body2 text-muted-foreground">{pick(locale,{en:longRead?'Reading is taking longer than expected. Choose the member below or refresh status. You do not need to upload this file again.':'You can choose the member while this file is being read.',hy:longRead?'Կարդալը սպասվածից երկար է տևում։ Ընտրեք անդամին ստորև կամ թարմացրեք կարգավիճակը։ Ֆայլը նորից վերբեռնելու կարիք չկա։':'Ֆայլը կարդալու ընթացքում կարող եք ընտրել անդամին։',ru:longRead?'Чтение занимает больше времени, чем ожидалось. Выберите участника ниже или обновите статус. Повторно загружать файл не нужно.':'Вы можете выбрать участника, пока файл читается.'})}</p>}
  {status==='linked'&&file.linked&&<p className="text-body2">{t.linkedTo(file.linked.name||'—',yerevanStamp(file.linked.linkedAt,locale))}</p>}
  {status==='noreon'&&<p className="text-body2">{t.reviewWhy.noreon}</p>}
  {status==='needs-review'&&<>{sheet}<p role="alert" className="text-body2">{reviewBlocked?t.result['needs-review']:r?.identityStatus==='multiple_patients'?t.reviewWhy.multiple:t.reviewWhy.mismatch}</p>{fromRecords&&!reviewBlocked&&r?.identityStatus!=='multiple_patients'&&<>{onOpenMember?<button type="button" className={button} disabled={pending||uncertain} onClick={onOpenMember}>{pick(locale,{en:"Find a member",hy:"Գտնել անդամին",ru:"Найти участника"})}</button>:<p className="text-body2">{pick(locale,{hy:'Բացեք անդամի քարտը «Անդամների քարտեր» բաժնում․ ֆայլը այնտեղ է՝ կցելու համար։',en:'Open the member’s record under Member records: the file is listed there to attach.',ru:'Откройте карточку участника в разделе «Карточки участников»: там указан файл для прикрепления.'})}</p>}</>}
   {/* A misprinted sheet for a member who is booked here can still be linked; the doctor confirms identity (Fable R6). */}
   {r?.identityStatus==='mismatch'&&!choosing&&<button type="button" className={button} disabled={pending||uncertain} onClick={()=>setChoosing(true)}><UserSearch className="mr-2 size-4" aria-hidden/>{t.chooseAnyway}</button>}</>}
  {status==='suggested'&&file.suggestion&&!choosing&&<div className="space-y-3">
   {sheet}
   <div className="rounded-lg bg-surface-subtle-teal p-3"><p className="text-body1 font-medium">{file.suggestion.name||'—'}<span className="font-normal"> · {t.born} {clinicMaskedBirthYear(data.maskedMembers?.find(m=>m.memberId===file.suggestion!.memberId),locale)}</span></p><p className="text-caption">{t.confidence[file.suggestion.confidence]}</p></div>
   <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={pending||uncertain} onClick={()=>void link(file.suggestion!.memberId)}>{pending?t.saving:t.confirm}</button><button type="button" className={button} disabled={pending||uncertain} onClick={()=>setChoosing(true)}>{t.chooseOther}</button></div>
  </div>}
  {(status==='choose'||status==='reading'||((status==='suggested'||status==='needs-review')&&choosing))&&<div className="space-y-2">
   {/* QA N-06: a sheet the reader could not read says so, so the clinic knows to re-scan. */}
   {status==='choose'&&(r?.state==='done'&&r.outcome==='unreadable'?<p role="alert" className="flex gap-2 text-body2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden/>{t.unreadable}</p>:<p className="text-body2">{!data.reading?t.readingOff:r&&(r.state==='rejected'||r.state==='failed')?t.couldNotRead:t.status.choose}</p>)}
   {sheet}
   {choosing||status==='choose'?<MemberChooser members={data.members} maskedMembers={data.maskedMembers} capped={!!data.membersCapped} preselect={file.suggestion?.memberId} t={t} locale={locale} pending={pending||uncertain} onPick={id=>void link(id)} onCancel={status==='choose'?undefined:()=>setChoosing(false)}/>
    :<button type="button" className={button} disabled={pending||uncertain} onClick={()=>setChoosing(true)}><UserSearch className="mr-2 size-4" aria-hidden/>{t.choose}</button>}
  </div>}
  {visits&&<fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-body2 font-medium">{t.pickVisit}</legend>
   {visits.options.map(o=><button key={o.appointmentId} type="button" className={`${button} w-full justify-start`} disabled={pending||uncertain} onClick={()=>void link(visits.memberId,o.appointmentId)}>{t.booking} {yerevanStamp(o.startsAt,locale)}</button>)}</fieldset>}
  {uncertain&&<button type="button" className={primary} disabled={pending} onClick={()=>{const command=frozen.current;if(command)void link(command.memberId,command.appointmentId,true);}}>{pending?t.saving:pick(locale,{en:'Retry linking',hy:'Կրկնել կապումը',ru:'Повторить привязку'})}</button>}
  {message&&<p role={message.ok?'status':'alert'} className="text-body2">{message.text}</p>}
 </li>;
}

/** This clinic's booked members (name, date of birth, nearest booking) in the shared searchable SelectField. */
function MemberChooser({members,maskedMembers=[],capped,preselect,t,locale,pending,onPick,onCancel}:{members:ClinicLabResults['members'];maskedMembers?:ClinicMemberMasked[];capped:boolean;preselect?:string;t:T;locale:Locale;pending:boolean;onPick:(id:string)=>void;onCancel?:()=>void}){
 const[picked,setPicked]=useState<string>(preselect??''),id=useId();
 const options=useMemo(()=>members.map(m=>({value:m.memberId,label:m.name||'—',description:`${t.born} ${clinicMaskedBirthYear(maskedMembers.find(masked=>masked.memberId===m.memberId),locale)} · ${t.booking} ${yerevanStamp(m.bookingAt,locale)}`})),[members,maskedMembers,t,locale]);
 return <div className="space-y-2">
  <label id={`${id}-label`} className="block text-caption">{t.choose}</label>
  <SelectField aria-labelledby={`${id}-label`} options={options} value={picked} onValueChange={setPicked} placeholder={t.choose} searchable searchPlaceholder={t.search} emptyText={t.noMatch} disabled={pending}/>
  <p className="text-caption text-muted-foreground">{pick(locale,{en:'Only members whose visit time has arrived can be linked here. If a member has a future visit or is missing, wait until the visit time or ask Noreon to review the file.',hy:'Այստեղ կարող եք կապել միայն այն անդամներին, որոնց այցի ժամը հասել է։ Եթե այցը ապագայում է կամ անդամը չկա, սպասեք մինչև այցի ժամը կամ խնդրեք Նորեոն Հելթին ստուգել ֆայլը։',ru:'Здесь можно привязать только участников, время визита которых уже наступило. Если визит впереди или участника нет в списке, дождитесь времени визита или попросите Нореон Хелс проверить файл.'})}</p>
  {capped&&<p className="text-caption text-muted-foreground">{t.capped}</p>}
  <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={pending||!picked} onClick={()=>picked&&onPick(picked)}>{pending?t.saving:t.link}</button>{onCancel&&<button type="button" className={button} disabled={pending} onClick={onCancel}>{t.cancel}</button>}</div>
 </div>;
}
