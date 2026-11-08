'use client';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LabAiCheck,labCheckMessage} from '@/components/staff/lab-ai-check';
import {RecordRefreshProvider} from '@/components/staff/record-refresh';
import {LabCheckLink} from './lab-review-action';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';
import type {AutoAcceptReason} from '@/lib/lab-ai/auto-accept';
import type {LabRead,LabValueRow,ReviewCommand} from '@/lib/lab-ai/doctor-schema';
import {readDoctorChatLab,reviewDoctorChatLabValue,confirmDoctorChatPassingLabValues,confirmDoctorChatLabIdentity,requestDoctorChatLabReading} from '@/lib/staff-zoe/chat-v2-actions';

type Ready=Extract<LabRead,{enabled:true}>;
export function DoctorChatLab({memberId,fileId,doctorId,locale,onReviewed,onIdentityConfirmed,resultsReport=false,onResults,inline=false}:{inline?:boolean;onIdentityConfirmed?:(memberId:string,fileId:string)=>void;resultsReport?:boolean;onResults?:()=>void;memberId:string;fileId:string;doctorId:string;locale:StaffLocale;onReviewed:(text:string)=>void}){
 const [data,setData]=useState<Ready|null>(null),[error,setError]=useState<string|null>(null),[page,setPage]=useState<number|null>(null);
 const [ruleBlocks,setRuleBlocks]=useState<Record<string,AutoAcceptReason|null>>({});
 const [submissionIds,setSubmissionIds]=useState<Record<string,string>>({});
 const [identityCheck,setIdentityCheck]=useState<DoctorUploadOverride|null>(null);
 const request=useRef({version:0});
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const reload=useCallback(async()=>{
  const version=++request.current.version;
  try{
   const result=await readDoctorChatLab(memberId,fileId,doctorId);
   if(version!==request.current.version)return;
   if(result.kind!=='lab'||result.data.fileId!==fileId){if(result.kind==='refused'||result.kind==='lab'){setData(null);setPage(null);setIdentityCheck(null);}setError(result.kind==='off'?'disabled':result.kind==='refused'||result.kind==='lab'?'access':'unavailable');return;}
   setData(result.data);setRuleBlocks(result.ruleBlocks??{});setIdentityCheck(result.identityCheck??null);setError(null);
   setSubmissionIds(previous=>Object.fromEntries(result.data.values.flatMap(v=>(['confirm','correct','reject'] as const).map(action=>{
    const key=`${v.valueId}:${action}`;return [key,previous[key]??crypto.randomUUID()];
   }))));
  }catch{if(version===request.current.version)setError('unavailable');}
 },[memberId,fileId,doctorId]);
 // The external read resolves before any state update, including a rejected action.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const sequence=request.current;void reload();return()=>{sequence.version++;};},[reload]);
 function reviewed(value:LabValueRow,command:ReviewCommand,savedStatus?:string){
  const status=command.action==='confirm'?'verified':command.action==='correct'?'corrected':'rejected';
  // The database keeps another reviewer's result, so a different saved status means this press did not set it.
  // Name no value here: the reload shows what is saved.
  if(savedStatus!==status){
   const named=analyteDisplayName(value.testName,locale,value.catalogueRef);
   onReviewed(notDone('lab-already-reviewed',locale,t(`${named} was already reviewed. Check the saved value.`,`${named}-ն արդեն վերանայված է։ Ստուգեք պահպանված արժեքը։`,`${named}: показатель уже проверен. Проверьте сохранённое значение.`)));
   return;
  }
  document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));
  // Keep this mounted block and all other edits.
  request.current.version++;
  setData(previous=>previous?{...previous,values:previous.values.map(v=>v.valueId===value.valueId?{...v,status,correctedValue:command.value??null,correctedUnit:command.unit??null}:v)}:previous);
  const name=analyteDisplayName(value.testName,locale,value.catalogueRef);
  const number=command.action==='correct'?command.value:value.valueText;
  const unit=command.action==='correct'?command.unit:value.unit;
  const amount=`${number}${unit?` ${unit}`:''}`;
  onReviewed(done('action',locale,command.action==='confirm'?t(`${name} ${amount} confirmed`,`${name} ${amount} հաստատված է`,`${name} ${amount} подтверждён`)
   :command.action==='correct'?t(`${name} corrected to ${amount}`,`${name} ուղղված է՝ ${amount}`,`${name} исправлен на ${amount}`)
   :t(`${name} rejected`,`${name} մերժված է`,`${name} отклонён`)));
 }
 const complete=!identityCheck&&data?.job?.state==='done'&&(data.job.identityStatus==='match'||!!data.job.identityConfirmedAt)&&data.values.length>0&&data.values.every(v=>['auto_accepted','verified','corrected','rejected'].includes(v.status));
 return <section className="dcv2-lab" data-lab-file={fileId}>
  <ChatMemberIdentity memberId={memberId} name={null} locale={locale}/>
  {identityCheck&&<UploadIdentityChecks rows={[identityCheck]} locale={locale}/>}
  {data&&!error&&<p role="status">{done('lab-opened',locale)}</p>}
  {error&&<p role="alert">{notDone('action',locale,labCheckMessage(error,locale))}</p>}
  {error&&error!=='access'&&<LabCheckLink href={`/staff/real/members/${memberId}/documents/${fileId}/check`} locale={locale}/>}
  {!data&&!error&&<p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>}
  {data&&error!=='access'&&error!=='disabled'&&<RecordRefreshProvider value={()=>void reload()}>
   <fieldset disabled={!!error}>
    <LabAiCheck ruleBlocks={ruleBlocks} identityRequired={!!identityCheck} data={identityCheck&&data.job?{...data,job:{...data.job,identityStatus:data.job.identityStatus==='multiple_patients'?'multiple_patients':'mismatch'}}:data} memberId={memberId} locale={locale} submissionIds={submissionIds}
     chat={{onOpenPdf:setPage,onReviewed:reviewed,inlinePdf:inline,onPdfLoad:()=>void reload()}}
     ports={{confirmPassing:async input=>{const result=await confirmDoctorChatPassingLabValues(memberId,fileId,input,doctorId);if(result.status==='saved')document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));return result;},review:input=>reviewDoctorChatLabValue(memberId,fileId,input,doctorId),confirmIdentity:async input=>{const result=await confirmDoctorChatLabIdentity(memberId,fileId,input,doctorId);if(result.status==='confirmed'){setIdentityCheck(null);document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));onIdentityConfirmed?.(memberId,fileId);}return result;},readAgain:()=>requestDoctorChatLabReading(memberId,fileId,doctorId)}}/>
   </fieldset>
   {complete&&<p role="status">{t('All values on this sheet are reviewed.','Այս թերթի բոլոր արժեքները վերանայված են։','Все показатели на этом бланке проверены.')}</p>}
   {complete&&resultsReport&&<button type="button" className="dcv2-choice" onClick={onResults}>{t('See results and report','Տեսնել արդյունքներն ու հաշվետվությունը','Посмотреть результаты и отчёт')}</button>}
   <p>{t('Nothing is released to the member here. Member uploads that need approval still need a separate approval.','Այստեղ անդամին ոչինչ չի տրամադրվում։ Հաստատում պահանջող անդամի վերբեռնումները դեռ առանձին հաստատման կարիք ունեն։','Здесь участнику ничего не публикуется. Загрузки участника, требующие одобрения, всё ещё нуждаются в отдельном одобрении.')}</p>
  </RecordRefreshProvider>}
  {inline&&data&&!error&&<a className="dcv2-choice" href={`/staff/real/members/${memberId}/documents/${fileId}/check`}>{t('Open full page','Բացել ամբողջական էջը','Открыть полную страницу')}</a>}
  <button type="button" className="dcv2-choice" onClick={()=>void reload()}>{t('Reload','Թարմացնել','Обновить')}</button>
  {data&&!error&&page!==null&&<LabPdfSheet memberId={memberId} fileId={fileId} page={page} pages={data?.job?.pageCount??page} locale={locale} onPage={setPage} onLoad={()=>void reload()} onClose={()=>{setPage(null);void reload();}}/>}
 </section>;
}

export function LabPdfSheet({memberId,fileId,page,pages,locale,onPage,onLoad,onClose,upload=false,mime="application/pdf"}:{memberId:string;fileId:string;page:number;pages:number;locale:StaffLocale;onPage:(page:number)=>void;onLoad:()=>void;onClose:()=>void;upload?:boolean;mime?:string}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,box=dialog.current;
  box?.showModal();box?.focus({preventScroll:true});
  return()=>{box?.close();previous?.focus({preventScroll:true});};
 },[]);
 const src=`/staff/real/members/${memberId}/${upload?'member-uploads':'documents'}/${fileId}?page=${page}`;
 return <dialog ref={dialog} tabIndex={-1} className="dcv2-pdf" aria-label={upload?st(locale,'Member upload','Անդամի վերբեռնումը','Файл участника'):st(locale,'Lab PDF','Լաբորատոր PDF','Лабораторный PDF')} onCancel={onClose}>
  <div className="dcv2-pdf-bar">
   {pages>1&&<><button type="button" className="dcv2-choice" disabled={page<=1} onClick={()=>onPage(page-1)}>{st(locale,'Previous','Նախորդը','Назад')}</button>
    <span>{st(locale,`Page ${page} of ${pages}`,`Էջ ${page}՝ ${pages}-ից`,`Страница ${page} из ${pages}`)}</span>
    <button type="button" className="dcv2-choice" disabled={page>=pages} onClick={()=>onPage(page+1)}>{st(locale,'Next','Հաջորդը','Далее')}</button></>}
   <button type="button" className="dcv2-choice" onClick={onClose}>{upload?st(locale,'Close file','Փակել ֆայլը','Закрыть файл'):st(locale,'Close PDF','Փակել PDF-ը','Закрыть PDF')}</button>
  </div>
  {/* The authenticated file route serves the original photo. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  {mime!=='application/pdf'?<img className="dcv2-upload-image" src={src} alt={st(locale,'Member upload','Անդամի վերբեռնումը','Файл участника')}/>:<iframe key={page} title={st(locale,`PDF page ${page}`,`PDF էջ ${page}`,`PDF страница ${page}`)} src={src} onLoad={onLoad}/> }
 </dialog>;
}
