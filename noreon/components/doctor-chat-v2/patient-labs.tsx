'use client';
import {useEffect,useEffectEvent,useRef,useState} from 'react';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {readDoctorPatientLabs,readDoctorChatResults,type PatientLabsResponse} from '@/lib/staff-zoe/chat-v2-actions';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {ResultsBlock,LabResultsHistory} from './results-block';
type ReportState=Awaited<ReturnType<typeof readDoctorChatResults>>;

export function PatientLabs({memberId,name,doctorId,locale,resultsReport,onLab,onUpload}:{memberId:string;name:string;doctorId:string;locale:StaffLocale;resultsReport:boolean;onLab:(fileId:string)=>void;onUpload:(fileId:string)=>void}){
 const [data,setData]=useState<PatientLabsResponse|null>(null),[block,setBlock]=useState<ReportState|null>(null),[notice,setNotice]=useState<string>();
 const request=useRef({version:0});
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 async function reload(){
  const current=++request.current.version;
  const [labs,report]=await Promise.all([
   readDoctorPatientLabs(memberId,doctorId).catch(():PatientLabsResponse=>({kind:'unavailable'})),
   resultsReport?readDoctorChatResults(doctorId,memberId).catch(():ReportState=>({status:'unavailable'})):Promise.resolve(null),
  ]);
  if(current!==request.current.version)return;
  setData(labs);setBlock(report);
 }
 const refresh=useEffectEvent(()=>{setData(null);setBlock(null);void reload();});
 useEffect(()=>{const sequence=request.current;void reload();const changed=()=>refresh();document.addEventListener('noreon:clinical-evidence-changed',changed);return()=>{sequence.version++;document.removeEventListener('noreon:clinical-evidence-changed',changed);};
 // Each patient route owns a keyed card.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[memberId,doctorId,resultsReport]);
 const open=(file:{id:string;source:'clinic'|'member'})=>file.source==='clinic'?onLab(file.id):onUpload(file.id);
 const waiting=data?.kind==='labs'?data.files.find(f=>f.needsReview):null;
 const state={
  'to-check':t('To check','Ստուգման ենթակա','Нужно проверить'),checked:t('Checked','Ստուգված','Проверено'),mismatch:t('Mismatch','Տվյալները չեն համընկնում','Данные не совпадают'),empty:t('0 values','0 արժեք','0 показателей'),
 };
 return <section className="dcv2-results" data-patient-labs={memberId}>
  <h2>{t('Labs','Լաբորատոր արդյունքներ','Анализы')} · <ChatMemberIdentity memberId={memberId} name={name} locale={locale}/></h2>
  {!data&&<p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>}
  {data&&data.kind!=='labs'&&<p role="alert">{data.kind==='off'?t('Lab files are not available in this chat yet.','Լաբորատոր ֆայլերը դեռ հասանելի չեն այս զրույցում։','Лабораторные файлы пока недоступны в этом чате.'):t('Lab files could not be read. Try again.','Լաբորատոր ֆայլերը չհաջողվեց կարդալ։ Փորձեք կրկին։','Не удалось загрузить лабораторные файлы. Попробуйте снова.')}</p>}
  {waiting&&<><p>{t('Some files or values still need your check.','Որոշ ֆայլեր կամ արժեքներ դեռ ձեր ստուգման կարիքն ունեն։','Некоторые файлы или показатели ещё нужно проверить.')}</p></>}
  {data?.kind==='labs'&&<>
   {!data.files.length&&<p>{t('No lab files yet. Upload or enter a lab report.','Լաբորատոր ֆայլեր դեռ չկան։ Վերբեռնեք կամ մուտքագրեք լաբորատոր հաշվետվություն։','Лабораторных файлов пока нет. Загрузите или внесите лабораторный отчёт.')}</p>}
   <ul className="dcv2-lab-files">{data.files.map(file=><li key={`${file.source}:${file.id}`} data-lab-file-row={file.id}>
    <button type="button" className="dcv2-choice" onClick={()=>open(file)}><span>{file.name}</span> · <time dateTime={file.at}>{yerevanStamp(file.at,locale)}</time> · {state[file.state]}</button>
    {file.needsReview&&<button type="button" className="dcv2-choice" onClick={()=>open(file)}>{t('Review these values','Վերանայել այս արժեքները','Проверить эти значения')}</button>}
    <p>{t('Check this file belongs to','Ստուգեք՝ այս ֆայլը պատկանում է','Проверьте, принадлежит ли этот файл')} <ChatMemberIdentity memberId={memberId} name={name} locale={locale}/></p>
   </li>)}</ul>
   <LabResultsHistory values={data.values} locale={locale}/>
  </>}
  {block?.status==='ready'&&block.memberId===memberId&&<ResultsBlock block={block} name={name} locale={locale} onRefresh={reload} onSaved={async words=>{setNotice(words);document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));}} onApproved={()=>{request.current.version++;setBlock(null);setNotice(t('Report approved.','Հաշվետվությունը հաստատված է։','Отчёт утверждён.'));}} onStale={reload}/>}
  {block?.status==='unavailable'&&<p role="alert">{t('Results could not be read. Try again.','Արդյունքները չհաջողվեց կարդալ։ Փորձեք կրկին։','Не удалось прочитать результаты. Попробуйте снова.')}</p>}
  {notice&&<p role="status">{notice}</p>}
  <button type="button" className="dcv2-choice" onClick={()=>{setData(null);setBlock(null);void reload();}}>{t('Refresh labs','Թարմացնել լաբորատոր արդյունքները','Обновить анализы')}</button>
 </section>;
}
