import 'server-only';
import {labIsFresh} from '@/lib/clinical/zones/evaluate';
import {yerevanToday} from '@/lib/member-history/measures';
import {claim,ownCard,record,type CardPorts,type CardResult} from './commands';
import type {MemberActor} from './actor';
import {documentInput,type DocumentInput} from './labs-contract';

type Ports=Pick<CardPorts,'readCard'|'claim'|'record'>&{save(documentId:string,v:DocumentInput):Promise<boolean>};
/** No file reading or value interpretation. Date and medicine-change facts come from the member's explicit confirmation. */
export async function runDocumentDetails(actor:MemberActor,ports:Ports,v:DocumentInput,now=new Date()):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'document');
 if(!card?.snapshot.document)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 if(v.studyDate&&(v.studyDate<'1950-01-01'||v.studyDate>yerevanToday(now)))return {status:'invalid',card};
 const c=await claim(actor,ports,card,'document',v.opId,v);
 if(!c.ok)return c.result;
 const confirmed=documentInput.safeParse(c.claim.payload);
 if(!confirmed.success)return {status:'invalid',card};
 const p=confirmed.data;
 if(p.docType!==v.docType||p.studyDate!==v.studyDate||p.medicineChangedSince!==v.medicineChangedSince)return {status:'stale',card};
 if(!await ports.save(card.snapshot.document.id,p))return {status:'failed',card};
 const freshness=labIsFresh({collectedOn:p.studyDate,today:yerevanToday(now),analyte:'baseline_panel',medicineChangedSince:p.medicineChangedSince==='UNKNOWN'?null:p.medicineChangedSince});
 return record(actor,ports,card,'document',{docType:p.docType,studyDate:p.studyDate,medicineChangedSince:p.medicineChangedSince,
  fresh:p.docType==='lab'&&freshness.fresh},true);
}

import {labReplyInput,type LabReplyInput,type LabAppointment} from './labs-contract';
type LabPorts=Pick<CardPorts,'readCard'|'claim'|'record'>&{
 current(appointmentId:string):Promise<LabAppointment|null>;
 raise(input:{memberId:string;appointmentId:string;requestId:string;reason:'fasting_failed'}):Promise<boolean>;
};
export async function runLabReply(actor:MemberActor,ports:LabPorts,v:LabReplyInput):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ports.readCard(v.cardId);
 if(!card?.valid||(card.kind!=='prep'&&card.kind!=='fasting'))return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 if((card.kind==='prep')!==(v.answer==='read'))return {status:'invalid',card};
 const live=await ports.current(card.snapshot.appointmentId);
 if(!live||live.revision!==card.snapshot.revision||Date.parse(live.startsAt)!==Date.parse(card.snapshot.startsAt))return {status:'stale',card};
 const c=await claim(actor,ports,card,card.kind,v.opId,v);
 if(!c.ok)return c.result;
 const pinned=labReplyInput.safeParse(c.claim.payload);
 if(!pinned.success||pinned.data.answer!==v.answer)return {status:'stale',card};
 if(v.answer==='ate'&&!await ports.raise({memberId:actor.memberId,appointmentId:live.appointmentId,requestId:c.claim.op,reason:'fasting_failed'}))return {status:'unavailable',card};
 return record(actor,ports,card,card.kind,{answer:v.answer},true);
}
