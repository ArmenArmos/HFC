'use client';
import {clinicIdentityMatchLabel} from '@/lib/clinic-portal/identity-match-label';
import{useCallback,useEffect,useRef,useState,type DragEvent}from'react';
import type{ClinicMemberMasked}from'@/lib/clinic-portal/member-masked-schema';
import{ClinicFileLinkedNotice,clinicMaskedBirthYear}from'./member-masked';
import{Upload}from'lucide-react';
import{fileStatus,type AttachResult,type FileCompare,type MemberFile,type MemberFiles,type ReserveResult}from'@/lib/clinic-admin/files-schema';
import{clinicLabFileLabel,clinicLabUploadName,clinicDate,clinicTimestamp as yerevanStamp}from'@/lib/clinic-portal/display-time';
import{pick,type Locale}from'@/lib/locale';
type ReadResult={status:'loaded';data:MemberFiles}|{status:'missing'|'forbidden'|'unavailable'|'disabled'};
type Begin={status:'started';batchId:string}|{status:'refused'|'invalid'|'unavailable'|'disabled'|'not_enrolled'};
type Local={key:string;name:string;stage:'uploading'|'failed'|'done'};
const MAX_BYTES=8*1024*1024;
const tr=(locale:Locale,en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
const born=(value:string|null,locale:Locale)=>value?clinicDate(value.slice(0,10),locale):tr(locale,'Not on the sheet','Թերթիկում չկա','Нет на бланке');
const primary='inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60';
const secondary='inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 text-body2 disabled:opacity-60';
const chip:Record<ReturnType<typeof fileStatus>|'uploading',[string,string,string]>={
 uploading:['Uploading','Վերբեռնվում է','Загружается'],reading:['Reading','Ընթերցվում է','Распознаётся'],'reading-values':['Attached: values being read','Կցված է․ արժեքները ընթերցվում են','Прикреплено: значения распознаются'],check:['Check the details','Ստուգեք տվյալները','Проверьте данные'],blocked:['Several people in one file','Մեկ ֆայլում մի քանի մարդ','Несколько людей в одном файле'],
 'book-first':['Book a visit first','Նախ գրանցեք այց','Сначала запишите на визит'],'choose-visit':['Choose the visit','Ընտրեք այցը','Выберите визит'],ready:['Ready for the doctor','Պատրաստ է բժշկի համար','Готово для врача'],'by-hand':['Ready: the doctor reads the PDF','Պատրաստ է․ բժիշկը կկարդա PDF-ը','Готово: врач прочитает PDF'],
 failed:['Not attached','Կցված չէ','Не прикреплено'],paused:['Waiting','Սպասում է','Ожидание'],unmatched:['Earlier upload, not attached','Նախկին վերբեռնում, կցված չէ','Прежняя загрузка, не прикреплена'],
 'identity-check':['Waiting for the doctor to check this file','Սպասում է բժշկի ստուգմանը','Ожидает проверки врачом'],
 'identity-checked':['File identity checked','Ֆայլի պատկանելությունը ստուգված է','Принадлежность файла проверена'],
 unreadable:["Couldn't read this file",'Չհաջողվեց կարդալ այս ֆայլը','Не удалось прочитать этот файл'],
 detached:['Removed by Noreon','Հեռացվել է Noreon-ի կողմից','Удалено Noreon']};

function Compare({locale,compare,masked}:{locale:Locale;masked?:ClinicMemberMasked;compare:Extract<FileCompare,{status:'compared'}>}){
 const nameDiff=compare.sheet?.nameMatch==='no',dobDiff=compare.sheet?.birthYearMatch==='no';
 const cell=(diff:boolean)=>`py-2 pr-3 align-top break-words ${diff?'font-semibold':''}`;
 return <><table className="w-full table-fixed text-body2"><thead><tr className="text-left text-caption text-muted-foreground"><th className="w-1/3 py-1 pr-3 font-normal"></th><th className="py-1 pr-3 font-normal">{tr(locale,'On the sheet','Թերթիկում','На бланке')}</th><th className="py-1 font-normal">{tr(locale,'Member','Անդամ','Участник')}</th></tr></thead>
  <tbody className="divide-y"><tr><th scope="row" className="py-2 pr-3 text-left align-top font-normal text-muted-foreground">{tr(locale,'Name','Անուն','Имя')}{nameDiff&&<span className="block text-caption">{tr(locale,'differs','տարբերվում է','отличается')}</span>}</th><td className={cell(nameDiff)}>{clinicIdentityMatchLabel('name',compare.sheet?.nameMatch??'unknown',locale)}</td><td className={cell(nameDiff)}>{compare.member.name||'–'}</td></tr>
  <tr><th scope="row" className="py-2 pr-3 text-left align-top font-normal text-muted-foreground">{tr(locale,'Birth year','Ծննդյան տարեթիվ','Год рождения')}{dobDiff&&<span className="block text-caption">{tr(locale,'differs','տարբերվում է','отличается')}</span>}</th><td className={cell(dobDiff)}>{clinicIdentityMatchLabel('birthYear',compare.sheet?.birthYearMatch??'unknown',locale)}</td><td className={cell(dobDiff)}>{compare.member.editedAt?tr(locale,'Date of birth hidden','Ծննդյան ամսաթիվը թաքցված է','Дата рождения скрыта'):clinicMaskedBirthYear(masked,locale)}</td></tr></tbody></table>{compare.member.editedAt&&<p className="pt-2 text-caption text-muted-foreground">{tr(locale,'Member values are from before your clinic changed them on','Անդամի տվյալները ձեր կլինիկայի փոփոխությունից առաջինն են՝','Данные участника указаны до изменений, внесённых вашей клиникой')} {born(compare.member.editedAt,locale)}.</p>}
 </>;
}

function FileRow({locale,file,attach,onChanged,masked}:{locale:Locale;masked?:ClinicMemberMasked;file:MemberFile;attach:(input:unknown)=>Promise<AttachResult>;onChanged:()=>void}){
 const status=fileStatus(file);
 const [busy,setBusy]=useState(false),[result,setResult]=useState<AttachResult|null>(null),[reason,setReason]=useState('');
 const [mismatch,setMismatch]=useState<FileCompare|null>(null);
 const lock=useRef(false),selectedVisit=useRef<string|undefined>(undefined);
 const retry=useRef<{fileId:string;submissionId:string;confirm:boolean;reason?:string;appointmentId?:string}|null>(null);
 const compare=mismatch??file.compare;
 const compared=compare?.status==='compared'&&compare.read?compare:null;
 const needsConfirm=(status==='check'||!!mismatch)&&!!compared?.differs;
 const uncertain=result?.status==='outcome-unknown'||result?.status==='unavailable';
 async function run(confirm:boolean,appointmentId?:string){
  if(lock.current)return;lock.current=true;setBusy(true);
  if(!retry.current){
   if(appointmentId)selectedVisit.current=appointmentId;
   retry.current={fileId:file.fileId,submissionId:crypto.randomUUID(),confirm,...(confirm&&reason.trim()?{reason:reason.trim()}:{}),...(selectedVisit.current?{appointmentId:selectedVisit.current}:{})};
  }
  let r:AttachResult;try{r=await attach(retry.current);}catch{r={status:'outcome-unknown'};}
  if(r.status!=='outcome-unknown'&&r.status!=='unavailable')retry.current=null;
  if(r.status==='mismatch')setMismatch(r.compare);
  if(r.status==='saved'||r.status==='stale')setMismatch(null);
  lock.current=false;setBusy(false);setResult(r);
  if(r.status==='saved'||r.status==='stale')onChanged();
 }
 const shown=result?.status==='book-first'?'book-first':result?.status==='blocked'?'blocked':result?.status==='choose-visit'?'choose-visit':result?.status==='mismatch'?'check':status;
 return <li className="space-y-3 py-4">
  <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-body2 font-medium">{clinicLabFileLabel(file.uploadedAt,locale)}</p><p className="text-caption text-muted-foreground">{tr(locale,'Uploaded','Վերբեռնվել է','Загружено')} {born(file.uploadedAt,locale)}</p></div>
   <span className="rounded-full border px-3 py-1 text-caption">{tr(locale,...chip[shown])}</span></div>
  {file.override&&shown!=='unreadable'&&shown!=='identity-check'&&<p className="text-caption text-muted-foreground">{tr(locale,'Attached although the sheet differed. Noreon and the doctor can see this.','Կցվել է, թեև թերթիկի տվյալները տարբերվում էին։ Noreon-ը և բժիշկը տեսնում են դա։','Прикреплено, хотя данные на бланке отличались. Noreon и врач видят это.')}</p>}
  {shown==='blocked'&&<p role="note" className="text-body2">{tr(locale,'The reader found more than one person in this PDF, so it cannot be attached to one member. Upload one PDF per person.','Ընթերցողը այս PDF-ում գտել է մեկից ավելի մարդ, ուստի այն չի կարող կցվել մեկ անդամի։ Վերբեռնեք մեկ PDF յուրաքանչյուր մարդու համար։','При распознавании в этом PDF найдены данные нескольких людей, поэтому его нельзя прикрепить к одному участнику. Загрузите отдельный PDF для каждого человека.')}</p>}
  {shown==='book-first'&&<p role="note" className="text-body2">{tr(locale,'This member is not cared for by your clinic’s doctors or nurses, and has no confirmed visit with your clinic in the last 120 days. Book a visit first, then attach the file.','Այս անդամին չեն խնամում ձեր կլինիկայի բժիշկները կամ բուժքույրերը, և վերջին 120 օրում ձեր կլինիկայում հաստատված այց չունի։ Նախ գրանցեք այց, ապա կցեք ֆայլը։','Этот участник не находится под наблюдением врачей или медсестёр вашей клиники и не имеет подтверждённого визита в вашу клинику за последние 120 дней. Сначала запишите его на визит, затем прикрепите файл.')}</p>}
  {shown==='paused'&&<p className="text-body2 text-muted-foreground">{tr(locale,'Waiting: the person who uploaded it no longer has access, or uploads are switched off. Attach it again from here.','Սպասում է․ վերբեռնողը այլևս մուտք չունի, կամ վերբեռնումն անջատված է։ Կցեք այն նորից այստեղից։','Ожидание: у загрузившего файл больше нет доступа или загрузка отключена. Прикрепите его снова здесь.')}</p>}
  {shown==='detached'&&<p className="text-body2 text-muted-foreground">{tr(locale,'Noreon removed this file from this member, so the doctor does not see it here. Ask Noreon if you think this is wrong.','Noreon-ը հեռացրել է այս ֆայլը այս անդամից, ուստի բժիշկն այն այստեղ չի տեսնում։ Եթե կարծում եք, որ սա սխալ է, դիմեք Noreon-ին։','Noreon удалил этот файл из записи участника, поэтому врач не видит его здесь. Обратитесь в Noreon, если считаете это ошибкой.')}</p>}
  {shown==='reading'&&!file.attached&&<p className="text-body2 text-muted-foreground">{tr(locale,'Reading the name and date of birth on the sheet. It attaches by itself when they match.','Ընթերցվում են թերթիկի անունը և ծննդյան ամսաթիվը։ Համընկնելու դեպքում ֆայլն ինքնաբերաբար կկցվի։','Распознаются имя и дата рождения на бланке. При совпадении файл прикрепится автоматически.')}</p>}
  {compared&&(needsConfirm||status==='unmatched')&&<div className="space-y-3 rounded-md border p-3">
   {needsConfirm&&<p role="alert" className="text-body2 font-medium">{tr(locale,'The sheet does not match this member. Check that this is the right person.','Թերթիկը չի համապատասխանում այս անդամին։ Ստուգեք, որ սա ճիշտ մարդն է։','Данные на бланке не совпадают с данными этого участника. Проверьте, что это нужный человек.')}</p>}
   <Compare locale={locale} compare={compared} masked={masked}/>
   {needsConfirm&&<label className="block space-y-2 text-body2"><span>{tr(locale,'Reason (optional)','Պատճառ (ըստ ցանկության)','Причина (необязательно)')}</span>
    <input disabled={busy||uncertain} value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} autoComplete="off" className="min-h-12 w-full min-w-0 rounded-md border bg-background px-3 text-body2"/></label>}
  </div>}
  {!uncertain&&result?.status==='choose-visit'&&<div className="space-y-2"><p className="text-body2">{tr(locale,'Which visit are these results from?','Ո՞ր այցի արդյունքներն են սրանք։','К какому визиту относятся эти результаты?')}</p>
   <div className="flex flex-wrap gap-2">{result.options.map(o=><button key={o.appointmentId} type="button" disabled={busy} className={secondary} onClick={()=>run(needsConfirm,o.appointmentId)}>{`${yerevanStamp(o.startsAt,locale)} (UTC+4)`}</button>)}</div></div>}
  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
   {!uncertain&&!file.attached&&needsConfirm&&<button type="button" disabled={busy} className={primary} onClick={()=>run(true)}>{busy?tr(locale,'Attaching…','Կցվում է…','Прикрепляется…'):tr(locale,'Continue anyway','Այնուամենայնիվ շարունակել','Всё равно продолжить')}</button>}
   {!uncertain&&!needsConfirm&&!file.attached&&(status==='unmatched'||status==='failed'||status==='paused'||status==='book-first'||(status==='choose-visit'&&result?.status!=='choose-visit'))&&<button type="button" disabled={busy} className={primary} onClick={()=>run(false)}>{busy?tr(locale,'Attaching…','Կցվում է…','Прикрепляется…'):status==='choose-visit'?tr(locale,'Choose the visit','Ընտրել այցը','Выбрать визит'):tr(locale,'Attach to this member','Կցել այս անդամին','Прикрепить к этому участнику')}</button>}
   {uncertain&&<button type="button" disabled={busy} className={primary} onClick={()=>run(false)}>{busy?tr(locale,'Attaching…','Կցվում է…','Прикрепляется…'):tr(locale,'Retry attachment','Կրկնել կցումը','Повторить прикрепление')}</button>}
   {shown==='unreadable'?<p className="text-caption text-muted-foreground">{tr(locale,'Upload a clearer copy of the sheet.','Վերբեռնեք թերթիկի ավելի պարզ պատճենը։','Загрузите более чёткую копию листа.')}</p>
    :shown==='identity-check'?<p className="text-caption text-muted-foreground">{tr(locale,"Linked to the member's record. The doctor will check this file.",'Կցված է անդամի գրառմանը։ Բժիշկը կստուգի այս ֆայլը։','Прикреплено к записи участника. Врач проверит этот файл.')}</p>
    :file.attached&&<ClinicFileLinkedNotice locale={locale}/>}
  </div>
  {result&&(result.status==='saved'||result.status==='stale'||result.status==='refused'||result.status==='invalid'||result.status==='unavailable'||result.status==='outcome-unknown'||result.status==='reading'||result.status==='disabled')&&<p role={result.status==='saved'?'status':'alert'} className="text-body2">{
   result.status==='saved'?tr(locale,'Attached.','Կցված է։','Прикреплено.'):result.status==='stale'?tr(locale,'This file has already been attached.','Այս ֆայլն արդեն կցված է։','Этот файл уже прикреплён.'):result.status==='reading'?tr(locale,'The sheet is still being read. Try again in a minute.','Թերթիկը դեռ ընթերցվում է։ Փորձեք մեկ րոպեից։','Бланк ещё распознаётся. Попробуйте снова через минуту.')
   :result.status==='refused'?tr(locale,'You cannot attach files to this member.','Դուք չեք կարող ֆայլեր կցել այս անդամին։','Вы не можете прикреплять файлы к этому участнику.'):tr(locale,'That did not work. Try again.','Չստացվեց։ Նորից փորձեք։','Не получилось. Попробуйте снова.')}</p>}
 </li>;
}

export function MemberResultsUpload({locale,clinicId,actorScope,initial,begin,reserve,read,attach,attachmentOnly=false,masked}:{locale:Locale;masked?:ClinicMemberMasked;clinicId:string;memberId:string;actorScope:string;initial:MemberFiles;attachmentOnly?:boolean;
 begin:()=>Promise<Begin>;reserve:(batchId:string,input:unknown)=>Promise<ReserveResult>;read:()=>Promise<ReadResult>;attach:(input:unknown)=>Promise<AttachResult>}){
 const [data,setData]=useState(initial),[local,setLocal]=useState<Local[]>([]),[message,setMessage]=useState(''),[over,setOver]=useState(false),[busy,setBusy]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const [source,setSource]=useState(initial);
 // Chat can refresh the list after a separate upload without resetting attachment retries.
 if(source!==initial){setSource(initial);setData(initial);}
 const refresh=useCallback(async()=>{try{const r=await read();if(r.status==='loaded')setData(r.data);}catch{/* keep the last list */}},[read]);
 const pending=local.some(l=>l.stage==='uploading')||data.uploads.some(f=>{const s=fileStatus(f);return s==='reading'||s==='reading-values'||f.attached&&(f.memberReading==='queued'||f.memberReading==='running');});
 useEffect(()=>{if(!pending)return;const t=setInterval(()=>void refresh(),5000);return()=>clearInterval(t);},[pending,refresh]);
 async function send(files:File[]){
  if(busy||!files.length)return;
  const pdfs=files.filter(f=>f.type==='application/pdf'&&f.size>0&&f.size<=MAX_BYTES);
  setMessage(pdfs.length<files.length?tr(locale,'Some files were skipped: only PDFs up to 8 MB.','Որոշ ֆայլեր բաց են թողնվել․ միայն մինչև 8 ՄԲ PDF-ներ։','Некоторые файлы пропущены: разрешены только PDF размером до 8 MB.'):'');
  if(!pdfs.length)return;
  setBusy(true);
  const rows=pdfs.map(()=>({key:crypto.randomUUID(),name:clinicLabFileLabel(new Date().toISOString(),locale),stage:'uploading'as const}));setLocal(old=>[...rows,...old]);
  const mark=(key:string,stage:Local['stage'])=>setLocal(old=>old.map(l=>l.key===key?{...l,stage}:l));
  try{
   const started=await begin();
   if(started.status!=='started'){rows.forEach(r=>mark(r.key,'failed'));setMessage(started.status==='not_enrolled'?tr(locale,'This member has not joined the care programme yet, so results cannot be attached.','Այս անդամը դեռ չի միացել խնամքի ծրագրին, ուստի արդյունքներ կցել հնարավոր չէ։','Этот участник ещё не присоединился к программе наблюдения, поэтому прикрепить результаты нельзя.'):tr(locale,'Upload is unavailable right now. Try again.','Վերբեռնումը հիմա անհասանելի է։ Նորից փորձեք։','Загрузка сейчас недоступна. Попробуйте снова.'));return;}
   for(const[i,file]of pdfs.entries()){
    const row=rows[i]!;
    try{
     const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
     const reserved=await reserve(started.batchId,{name:clinicLabUploadName(new Date().toISOString()),size:file.size,fingerprint});
     if(reserved.status!=='reserved'){mark(row.key,'failed');continue;}
     const response=await fetch(`/clinic/real/batches/${reserved.batchId}/files/${reserved.fileId}?clinic=${clinicId}`,{method:'PUT',headers:{'content-type':'application/pdf','x-clinic-upload-attempt':reserved.attemptId,'x-clinic-ui-scope':actorScope},body:file});
     const body:unknown=await response.json().catch(()=>null);
     mark(row.key,response.ok&&typeof body==='object'&&body!==null&&'status'in body&&body.status==='stored'?'done':'failed');
    }catch{mark(row.key,'failed');}
   }
  }finally{setBusy(false);await refresh();}
 }
 return <div className="space-y-4">
  {!attachmentOnly&&<div onDragOver={(e:DragEvent)=>{e.preventDefault();setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={(e:DragEvent)=>{e.preventDefault();setOver(false);void send(Array.from(e.dataTransfer.files));}}
   className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center ${over?'border-primary bg-muted':''}`}>
   <Upload aria-hidden className="size-6 text-muted-foreground"/>
   <p className="text-body2">{tr(locale,'Drop lab PDFs for this member here, or choose them. Several files at once are fine.','Քաշեք այստեղ այս անդամի լաբորատոր PDF-ները կամ ընտրեք դրանք։ Կարելի է միանգամից մի քանի ֆայլ։','Перетащите сюда PDF с анализами этого участника или выберите их. Можно загрузить несколько файлов сразу.')}</p>
   <input ref={input} type="file" accept="application/pdf" multiple className="sr-only" onChange={e=>{void send(Array.from(e.target.files??[]));e.target.value='';}}/>
   <button type="button" disabled={busy||!data.uploadAvailable} className={primary} onClick={()=>input.current?.click()}><Upload aria-hidden className="size-4"/>{busy?tr(locale,'Uploading…','Վերբեռնվում է…','Загружается…'):tr(locale,'Upload results','Վերբեռնել արդյունքներ','Загрузить результаты')}</button>
   {!data.uploadAvailable&&<p className="text-caption text-muted-foreground">{tr(locale,'Attaching results is switched off right now.','Արդյունքների կցումն այժմ անջատված է։','Прикрепление результатов сейчас отключено.')}</p>}
   <p className="text-caption text-muted-foreground">{tr(locale,'Each file is checked against this member’s name and date of birth before it is attached.','Յուրաքանչյուր ֆայլ կցելուց առաջ ստուգվում է այս անդամի անվան և ծննդյան ամսաթվի հետ։','Перед прикреплением каждый файл проверяется на совпадение с именем и датой рождения этого участника.')}</p>
  </div>}
  {message&&<p role="alert" className="text-body2">{message}</p>}
  {local.filter(l=>l.stage!=='done').length>0&&<ul className="divide-y rounded-lg border px-4">{local.filter(l=>l.stage!=='done').map(l=><li key={l.key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-body2"><span className="break-words">{l.name}</span><span className="rounded-full border px-3 py-1 text-caption">{l.stage==='uploading'?tr(locale,...chip.uploading):tr(locale,'Upload failed','Վերբեռնումը ձախողվեց','Не удалось загрузить')}</span></li>)}</ul>}
  {data.uploads.length?<ul className="divide-y">{data.uploads.map(f=><FileRow key={f.fileId} masked={masked} locale={locale} file={f} attach={attach} onChanged={()=>void refresh()}/>)}</ul>
   :<p className="text-body2 text-muted-foreground">{tr(locale,attachmentOnly?'No results attached to this member yet.':'No results uploaded from this record yet.',attachmentOnly?'Այս անդամին դեռ արդյունքներ չեն կցվել։':'Այս քարտից դեռ արդյունքներ չեն վերբեռնվել։',attachmentOnly?'К этому участнику ещё не прикреплены результаты.':'Из этой записи ещё не загружены результаты.')}</p>}
  {data.unmatched.length>0&&<div className="space-y-2"><h3 className="text-body2 font-medium">{tr(locale,'Earlier uploads that may be this member’s','Նախկին վերբեռնումներ, որոնք կարող են պատկանել այս անդամին','Прежние загрузки, которые могут относиться к этому участнику')}</h3>
   <p className="text-caption text-muted-foreground">{tr(locale,'Files your clinic uploaded before that were never attached, where the sheet names this member. Check each one before attaching it.','Ձեր կլինիկայի նախկինում վերբեռնած, բայց չկցված ֆայլեր, որոնց թերթիկում նշված է այս անդամը։ Կցելուց առաջ ստուգեք յուրաքանչյուրը։','Файлы, ранее загруженные вашей клиникой, но не прикреплённые, в которых на бланке указано имя этого участника. Проверьте каждый файл перед прикреплением.')}</p>
   <ul className="divide-y">{data.unmatched.map(f=><FileRow key={f.fileId} masked={masked} locale={locale} file={f} attach={attach} onChanged={()=>void refresh()}/>)}</ul></div>}
 </div>;
}
