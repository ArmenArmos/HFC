'use client';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {useEffect,useState} from 'react';
import {StaffZoeResponse} from '@/components/staff/zoe/answer';
import {memberRef} from '@/lib/staff-zoe/contracts';
import type {ZoeReply} from './messages';
import type {LabValueRow} from '@/lib/lab-ai/doctor-schema';
import {readDoctorChatLab} from '@/lib/staff-zoe/chat-v2-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {AnswerContent,Fact,ToolResult} from '@/lib/staff-zoe/contracts';

const labFacts=(reply:{cards:ToolResult[];content?:AnswerContent})=>reply.content?[...reply.content.say.flatMap(line=>line.facts),...reply.content.cards.flatMap(card=>card.facts)]:reply.cards.flatMap(card=>card.facts);

export const labValuesChanged=(locale:StaffLocale)=>st(locale,'Lab values changed. Ask Zoe again for the current record.','Լաբորատոր արժեքները փոխվել են։ Ընթացիկ գրառման համար կրկին հարցրեք Զոյային։','Лабораторные значения изменились. Спросите Zoe ещё раз, чтобы прочитать актуальную запись.');

export function unreviewedLabFiles(reply:{cards:ToolResult[];content?:AnswerContent},memberId:string){
 const facts=labFacts(reply);
 const files=new Map<string,Fact&{href:string}>();
 for(const fact of facts){
  if(!fact.id.startsWith('labs.')||fact.mark!=='not_reviewed'||(!fact.href&&!fact.fileId))continue;
  // Only the code-written check route for this member can become an action.
  const prefix=`/staff/real/members/${memberId}/documents/`;
  const href=fact.href??`${prefix}${fact.fileId}/check`;
  if(!href.startsWith(prefix)||!href.endsWith('/check'))continue;
  if(fact.fileId&&href!==`${prefix}${fact.fileId}/check`)continue;
  files.set(fact.fileId??href,{...fact,href});
 }
 return [...files.values()];
}

export function LabCheckLink({href,locale,label}:{href:string;locale:StaffLocale;label?:string}){
 return <a href={href} className="dcv2-choice">{label??st(locale,'Open the lab check','Բացել լաբորատոր ստուգումը','Открыть проверку анализов')}</a>;
}

type ReviewState='inline'|'link'|'refused'|'changed'|'identity'|'checked';
/** Recheck reviewed snapshots too: a saved answer predating the identity gate must not bypass it. */
function sourceFiles(reply:ZoeReply){
 const files=new Map(unreviewedLabFiles(reply,reply.member.memberId).map(f=>[f.fileId??f.href,f]));
 for(const fact of labFacts(reply))if(fact.id.startsWith('labs.')&&fact.fileId)
  files.set(fact.fileId,{...fact,href:`/staff/real/members/${reply.member.memberId}/documents/${fact.fileId}/check`});
 return [...files.values()];
}
const reviewed=(value:LabValueRow)=>value.status==='verified'||value.status==='corrected'||value.status==='rejected';
function staleLabFacts(reply:ZoeReply,fileId:string,values:LabValueRow[]){
 if(values.length&&values.every(reviewed))return true;
 // Saved fact ids are positional, not value ids. Match the source-written labels;
 // a changed match retires the snapshot rather than presenting an old value as reviewed.
 const facts=labFacts(reply).filter(f=>f.fileId===fileId&&f.mark==='not_reviewed');
 return values.some(value=>reviewed(value)&&facts.some(fact=>(fact.date===null||fact.date===value.collectedOn)&&
  ['unreviewed','չվերանայված','не проверено',...Object.values(AI_READ_LABEL)].some(label=>fact.label===`${value.testName}, ${label}`)));
}

export function LabReviewResponse({reply,doctorId,locale,busy,onLab,collapseZoe=false}:{reply:ZoeReply;doctorId?:string;locale:StaffLocale;busy?:boolean;onLab?:(memberId:string,fileId:string,name:string)=>void;collapseZoe?:boolean}){
 const memberId=reply.member.memberId;
 const [checked,setChecked]=useState<{reply:ZoeReply;doctorId:string;states:ReviewState[];identityChecks:DoctorUploadOverride[]}|null>(null);
 useEffect(()=>{
  if(!doctorId||!sourceFiles(reply).length)return;
  let active=true,sequence=0;
  async function reconcile(){
   const readSequence=++sequence;
   setChecked(null);
   const identityChecks:DoctorUploadOverride[]=[];
   const states=await Promise.all(sourceFiles(reply).map(async(fact):Promise<ReviewState>=>{
    try{
     // One read supplies both saved review status and the existing action preflight.
     const read=await readDoctorChatLab(memberId,fact.fileId??fact.href.split('/').at(-2),doctorId);
     if(read.kind==='refused')return 'refused';
     if(read.kind!=='lab')return 'link';
     if(read.identityCheck){identityChecks.push(read.identityCheck);return 'identity';}
     if(fact.mark==='not_reviewed'&&fact.fileId&&staleLabFacts(reply,fact.fileId,read.data.values))return 'changed';
     return fact.mark!=='not_reviewed'?'checked':fact.fileId?'inline':'link';
    }catch{return 'link';}
   }));
   if(active&&readSequence===sequence)setChecked({reply,doctorId:doctorId!,states,identityChecks});
  }
  const visible=()=>{if(!document.hidden)void reconcile();};
  void reconcile();
  document.addEventListener('visibilitychange',visible);
  return()=>{active=false;document.removeEventListener('visibilitychange',visible);};
 },[reply,memberId,doctorId]);
 const files=sourceFiles(reply);
 const states=checked?.reply===reply&&checked.doctorId===doctorId?checked.states:null;
 if(doctorId&&files.length&&!states)return <p className="cv2-say" role="status">{st(locale,'Checking lab values…','Ստուգում եմ լաբորատոր արժեքները…','Проверяю лабораторные значения…')}</p>;
 if(states?.some(state=>state==='link'||state==='refused'))return <>
  <p className="cv2-say" role="alert">{st(locale,'Lab values could not be checked. Open the lab check before using them.','Լաբորատոր արժեքները չհաջողվեց ստուգել։ Օգտագործելուց առաջ բացեք լաբորատոր ստուգումը։','Не удалось проверить показатели. Откройте проверку анализов перед их использованием.')}</p>
  {files.map((fact,index)=>states[index]==='link'?<LabCheckLink key={fact.fileId??fact.href} href={fact.href} locale={locale}/>:null)}
 </>;
 if(states?.includes('identity'))return <UploadIdentityChecks rows={checked?.identityChecks??[]} locale={locale} onOpen={onLab?row=>onLab(row.memberId,row.fileId,row.memberName):undefined}/>;
 // As after an in-chat review, ask again rather than rewriting a saved clinical answer.
 if(states?.includes('changed'))return <p className="cv2-say">{labValuesChanged(locale)}</p>;
 return <>
  <StaffZoeResponse member={{id:memberId,name:reply.member.memberName}} content={reply.content??null} cards={reply.cards} error={reply.error??null} loading={reply.kind==='zoe-loading'||reply.kind==='zoe-cards'} locale={locale} memberRef={memberRef(memberId)} inline collapseZoe={collapseZoe}/>
  {doctorId&&onLab&&!reply.error&&files.map((fact,index)=>states?.[index]==='link'?<LabCheckLink key={fact.fileId??fact.href} href={fact.href} locale={locale}/>:states?.[index]==='inline'?<button key={fact.fileId} type="button" className="dcv2-choice" disabled={busy} onClick={()=>fact.fileId&&onLab(memberId,fact.fileId,reply.member.memberName)} onPointerDown={event=>event.preventDefault()}>{st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения')}</button>:null)}
 </>;
}
