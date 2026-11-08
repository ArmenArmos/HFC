'use client';
import type{ClinicMemberMasked}from'@/lib/clinic-portal/member-masked-schema';
import{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{clinicMemberFileAttach,clinicMemberFilesRead,clinicMemberUploadBegin,clinicMemberUploadReserve}from'@/lib/clinic-admin/actions';
import{pick,type Locale}from'@/lib/locale';
import{MemberResultsUpload}from'./member-results-upload';
import{ClinicUpload}from'./upload';
import{clinicRead}from'@/lib/clinic-portal/actions';
import type{ClinicSnapshot}from'@/lib/clinic-portal/schema';
import type{MemberUploadAttempt}from'@/lib/clinic-admin/files-schema';

type Props={masked?:ClinicMemberMasked;clinicId:string;memberId:string;actorScope:string;locale:Locale;memberName?:string;onChanged?:()=>void};
type ReadResult=Awaited<ReturnType<typeof clinicMemberFilesRead>>;
const tr=(locale:Locale,en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});

/** A member selection owns its read and command state. Changing scope removes the old list immediately. */
export function ChatMemberFiles(props:Props){
 return <ScopedMemberFiles key={`${props.clinicId}:${props.actorScope}:${props.memberId}`} {...props}/>;
}
function ScopedMemberFiles({clinicId,memberId,actorScope,locale,memberName,onChanged,masked}:Props){
 const [result,setResult]=useState<ReadResult|{status:'loading'}>({status:'loading'});
 const [snapshot,setSnapshot]=useState<ClinicSnapshot|null>(null),[pending,setPending]=useState(false),[setupMessage,setSetupMessage]=useState('');
 const attempt=useRef<MemberUploadAttempt|null>(null),busy=useRef(false);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const generation=useRef(0);
 const read=useCallback(async():Promise<ReadResult>=>{
  const current=++generation.current;
  let next:ReadResult;
  try{next=await clinicMemberFilesRead(clinicId,actorScope,memberId);}catch{next={status:'unavailable'};}
  // A denied or unavailable read replaces the previous list, including its attachment controls.
  if(current===generation.current)setResult(next);
  return next;
 },[clinicId,actorScope,memberId]);
 useEffect(()=>{void read();},[read]);
 const refresh=useCallback(async()=>{
  const next=await read();
  if(alive.current)onChanged?.();
  return next;
 },[read,onChanged]);
 async function prepareUpload(){
  if(busy.current)return;busy.current=true;setPending(true);
  // Keep every create field through a lost create, registration or snapshot response.
  attempt.current??={submissionId:crypto.randomUUID(),batchId:crypto.randomUUID(),name:tr(locale,'Results upload','Արդյունքների վերբեռնում','Загрузка результатов')};
  try{
   const started=await clinicMemberUploadBegin(clinicId,actorScope,memberId,attempt.current);
   if(!alive.current)return;
   if(started.status==='started'){
    const loaded=await clinicRead(clinicId,started.batchId,null,actorScope);
    if(!alive.current)return;
    if(loaded.status==='loaded'){setSnapshot(loaded.data);setSetupMessage('');return;}
   }
   setSetupMessage(tr(locale,'Upload could not be prepared. Retry to check the same upload.','Չհաջողվեց պատրաստել վերբեռնումը։ Կրկնեք՝ նույն վերբեռնումը ստուգելու համար։','Не удалось подготовить загрузку. Повторите, чтобы проверить ту же загрузку.'));
  }catch{
   if(alive.current)setSetupMessage(tr(locale,'The result is not confirmed. Retry to check the same upload.','Արդյունքը չի հաստատվել։ Կրկնեք՝ նույն վերբեռնումը ստուգելու համար։','Результат не подтверждён. Повторите, чтобы проверить ту же загрузку.'));
  }finally{busy.current=false;if(alive.current)setPending(false);}
 }
 const commands=useMemo(()=>({begin:clinicMemberUploadBegin.bind(null,clinicId,actorScope,memberId),reserve:clinicMemberUploadReserve.bind(null,clinicId,actorScope),attach:clinicMemberFileAttach.bind(null,clinicId,actorScope,memberId)}),[clinicId,actorScope,memberId]);
 return <section className="space-y-3" aria-label={tr(locale,'Member results','Անդամի արդյունքները','Результаты участника')}>
  <h3 className="text-body2 font-medium">{memberName?`${tr(locale,'Results for','Արդյունքները՝','Результаты для')} ${memberName}`:tr(locale,'Member results','Անդամի արդյունքները','Результаты участника')}</h3>
  {result.status==='loaded'?<>
   {snapshot&&result.data.uploadAvailable?<ClinicUpload snapshot={snapshot} actorScope={actorScope} locale={locale} onLoaded={next=>{setSnapshot(next);void refresh();}}/>
    :<button type="button" disabled={pending||!result.data.uploadAvailable} className="min-h-12 rounded-md border px-4 text-body2 disabled:opacity-60" onClick={()=>void prepareUpload()}>{pending?tr(locale,'Preparing upload…','Վերբեռնումը պատրաստվում է…','Подготовка загрузки…'):setupMessage?tr(locale,'Retry upload setup','Կրկնել վերբեռնման պատրաստումը','Повторить подготовку загрузки'):tr(locale,'Upload results','Վերբեռնել արդյունքներ','Загрузить результаты')}</button>}
   {setupMessage&&<p role="alert" className="text-body2">{setupMessage}</p>}
   {!result.data.uploadAvailable&&<p role="status" className="text-body2 text-muted-foreground">{tr(locale,'Attaching results is switched off right now.','Արդյունքների կցումն այժմ անջատված է։','Прикрепление результатов сейчас отключено.')}</p>}
   <MemberResultsUpload masked={masked} locale={locale} clinicId={clinicId} memberId={memberId} actorScope={actorScope} initial={result.data} attachmentOnly read={refresh} {...commands}/>
  </>
   :result.status==='loading'?<p role="status" className="text-body2 text-muted-foreground">{tr(locale,'Loading results…','Արդյունքները բեռնվում են…','Загружаем результаты…')}</p>
   :<div className="space-y-2"><p role="alert" className="text-body2 text-muted-foreground">{tr(locale,'Results are unavailable here right now.','Արդյունքներն այստեղ այժմ անհասանելի են։','Результаты сейчас недоступны.')}</p><button type="button" className="min-h-12 rounded-md border px-4 text-body2" onClick={()=>void read()}>{tr(locale,'Try again','Նորից փորձել','Попробовать снова')}</button></div>}
 </section>;
}
