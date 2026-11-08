'use client';
import{clinicBatchName}from'@/lib/clinic-portal/display-time';
import{pick,type Locale}from'@/lib/locale';
import{useEffect,useRef,useState}from'react';
import{unstable_rethrow}from'next/navigation';
import{clinicRead,clinicRecover}from'@/lib/clinic-portal/actions';
import{hydrateClinicBatch}from'@/lib/clinic-portal/controller';
import type{ClinicSnapshot}from'@/lib/clinic-portal/schema';
import type{ClinicLabResults as ClinicLabResultsData}from'@/lib/clinic-portal/lab-results-schema';
import{ClinicStoredFiles}from'./files';
import{ClinicUpload}from'./upload';
import{ClinicLabResults}from'./lab-results';
export function ClinicBatchDetail({initial,locale,actorScope,resultLink=false,uploadFromRecords=false,labPreview,embedded=false,onOpenMember}:{initial:ClinicSnapshot;actorScope:string;locale:Locale;resultLink?:boolean;/** Full access on: uploads start from a member record, this page is read only. */uploadFromRecords?:boolean;/** Tests and previews only. */labPreview?:ClinicLabResultsData;embedded?:boolean;onOpenMember?:()=>void}){
 const[data,setData]=useState(initial),[labKey,setLabKey]=useState(0),[pending,setPending]=useState(false),[error,setError]=useState(false),[message,setMessage]=useState(''),busy=useRef(false),alive=useRef(true);
 const blocked=embedded&&error;
 const Heading=embedded?'h2':'h1';
 const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function refresh(more=false){
  if(busy.current)return;busy.current=true;setPending(true);
  try{const r=await clinicRead(initial.batch.clinicId,initial.batch.id,more?data.nextCursor:null,actorScope);if(!alive.current)return;if(r.status==='loaded'){const merged=hydrateClinicBatch(data,r.data,{append:more});setData(old=>old.batch.revision>merged.batch.revision?old:merged);setError(false);setLabKey(k=>k+1);}else setError(true);}
  catch(e){unstable_rethrow(e);if(alive.current)setError(true);}
  finally{busy.current=false;if(alive.current)setPending(false);}
 }
 async function recover(file:ClinicSnapshot['files'][number]){
  if(busy.current||(embedded&&error)||!file.recoveryCommand)return;busy.current=true;setPending(true);
  try{
   const r=await clinicRecover(initial.batch.clinicId,file.recoveryCommand,actorScope);if(!alive.current)return;
   if(r.status==='loaded'){
    if(r.snapshot)setData(old=>hydrateClinicBatch(old,r.snapshot!));
    setError(false);setMessage(r.receipt.status==='retired'?(t('The attempt is closed. Check cleanup status before selecting another upload.','Փորձը փակված է։ Ստուգեք մաքրման կարգավիճակը՝ նոր վերբեռնումից առաջ։','Попытка закрыта. Проверьте статус очистки, прежде чем выбрать другую загрузку.')):r.receipt.status==='committed'?(t('The saved outcome is confirmed. Review the current details.','Պահպանման արդյունքը հաստատված է։ Դիտեք ընթացիկ տվյալները։','Результат сохранения подтверждён. Проверьте текущие данные.')):(t('The outcome is still unknown. The file was not sent again.','Արդյունքը դեռ անհայտ է։ Ֆայլը նորից չի ուղարկվել։','Результат всё ещё неизвестен. Файл не был отправлен повторно.')));
   }else setError(true);
  }catch(e){unstable_rethrow(e);if(alive.current)setError(true);}
  finally{busy.current=false;if(alive.current)setPending(false);}
 }
 return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><Heading className={embedded?"break-words text-h2":"break-words text-h1"}>{clinicBatchName(data.batch.name,locale)}</Heading><p className="text-caption text-muted-foreground">{t('Uploaded by','Վերբեռնող՝','Загрузил(а)')} {data.batch.uploaderName}</p></div><button disabled={pending} onClick={()=>void refresh()} className="min-h-12 rounded-md border px-4 text-body2">{pending?(t('Checking…','Ստուգվում է…','Проверяется…')):(t('Refresh status','Թարմացնել կարգավիճակը','Обновить статус'))}</button></div>
 {error&&<p role="alert" className="rounded-lg border p-4 text-body2">{t('The refresh was unavailable. The last loaded information is still shown.','Թարմացումը չհաջողվեց։ Ցուցադրված են վերջին հասանելի տվյալները։','Не удалось обновить данные. Показаны последние загруженные сведения.')}</p>}
 {message&&<p role="status" className="text-body2">{message}</p>}
 {!blocked&&(uploadFromRecords?<p className="rounded-lg border bg-background p-4 text-body2">{onOpenMember?<button type="button" className="min-h-12 rounded-md border px-4 text-body2" onClick={onOpenMember}>{t('Find a member','Գտնել անդամին','Найти участника')}</button>:t('Results are now uploaded from the member record. This batch is kept for reading.','Արդյունքներն այժմ վերբեռնվում են անդամի քարտից։ Այս փաթեթը պահվում է կարդալու համար։','Теперь результаты загружаются из карты участника. Этот пакет сохранён для просмотра.')}</p>
 :<ClinicUpload actorScope={actorScope} snapshot={data} locale={locale} onLoaded={next=>{setData(old=>hydrateClinicBatch(old,next));setLabKey(k=>k+1);}}/>)}
 {/* With result linking on, stored PDFs are listed once with their reading and member; other upload states stay below. */}
 {resultLink&&!blocked&&<ClinicLabResults clinicId={data.batch.clinicId} batchId={data.batch.id} actorScope={actorScope} locale={locale} refreshKey={labKey} initial={labPreview} fromRecords={uploadFromRecords} onOpenMember={onOpenMember}/>}
 {(!resultLink||data.files.some(f=>f.upload.status!=='stored'))&&<ClinicStoredFiles snapshot={resultLink?{...data,files:data.files.filter(f=>f.upload.status!=='stored')}:data} locale={locale} pending={pending} onRecover={blocked?undefined:file=>void recover(file)}/>}
 {data.nextCursor&&!blocked&&<button disabled={pending} onClick={()=>void refresh(true)} className="min-h-12 rounded-md border px-4 text-body2">{t('Load more files','Բեռնել մյուս ֆայլերը','Загрузить ещё файлы')}</button>}</div>;
}
