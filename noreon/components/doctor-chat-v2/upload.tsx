'use client';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {useEffect,useState} from 'react';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {MemberUploadAi} from '@/components/staff/member-upload-ai';
import {memberUploadApprovedText} from '@/components/staff/member-upload-approve';
import {RecordRefreshProvider} from '@/components/staff/record-refresh';
import {readDoctorChatUpload,approveDoctorChatUpload,type ChatUploadResponse} from '@/lib/staff-zoe/chat-v2-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {LabPdfSheet} from './lab';

export function DoctorChatUpload({memberId,documentId,doctorId,locale,onApproved}:{memberId:string;documentId:string;doctorId:string;locale:StaffLocale;onApproved:(reply:string)=>void}){
 const [data,setData]=useState<ChatUploadResponse|null>(null),[page,setPage]=useState<number|null>(null),[revision,reload]=useState(0);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 useEffect(()=>{
  let active=true;
  void readDoctorChatUpload(memberId,documentId,doctorId).then(result=>{if(active)setData(result);},()=>{if(active)setData({kind:'unavailable'});});
  return()=>{active=false;};
 },[memberId,documentId,doctorId,revision]);
 if(!data)return <p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>;
 if(data.kind==='refused')return <p role="alert">{notDone('read-access',locale)}</p>;
 if(data.kind!=='upload')return <div><p role="alert">{notDone(data.kind==='off'?'disabled':'upload-unavailable',locale)}</p><button type="button" className="dcv2-choice" onClick={()=>reload(n=>n+1)}>{t('Reload','Թարմացնել','Обновить')}</button></div>;
 return <section className="dcv2-upload" data-upload-document={documentId}>
  <ChatMemberIdentity memberId={memberId} name={null} locale={locale}/>
  <p role="status">{done('upload-opened',locale)}</p>
  <h2>{data.document.fileName}</h2>
  <button type="button" className="dcv2-choice" onClick={()=>setPage(1)}>{t('Open file','Բացել ֆայլը','Открыть файл')}</button>
  <RecordRefreshProvider value={()=>reload(n=>n+1)}>
   <MemberUploadAi key={`${data.doc.job?.jobId}:${revision}`} doc={data.doc} locale={locale}
    approval={{data:data.approvals,memberId,approve:input=>approveDoctorChatUpload(input,doctorId)}}
    chat={{onOpenPdf:setPage,onApproved:()=>onApproved(done('upload-approved',locale,memberUploadApprovedText(locale)))}}/>
  </RecordRefreshProvider>
  <button type="button" className="dcv2-choice" onClick={()=>reload(n=>n+1)}>{t('Reload','Թարմացնել','Обновить')}</button>
  {page!==null&&<LabPdfSheet memberId={memberId} fileId={documentId} upload mime={data.document.mime} page={page} pages={data.document.mime==='application/pdf'?data.doc.job?.pageCount??page:1} locale={locale} onPage={setPage} onLoad={()=>{}} onClose={()=>setPage(null)}/>}
 </section>;
}
