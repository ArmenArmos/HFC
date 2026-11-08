import type {StaffLabResults} from '@/lib/lab-ai/staff-results';
import type {MemberUploadApprovals} from '@/lib/lab-ai/member-approval';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
export type PatientLabFile={id:string;source:'clinic'|'member';name:string;at:string;state:'to-check'|'checked'|'mismatch'|'empty';needsReview:boolean};
export type PatientLabValue={id:string;fileId:string;source:'clinic'|'member';testName:string;catalogueRef:string|null;value:string;unit:string|null;on:string|null;mark:'reviewed'|'not-reviewed'|'member-reported'};
export type PatientLabData={files:PatientLabFile[];values:PatientLabValue[]};
/** Project the existing assignment-scoped read. A sheet's identity gate also gates its values. */
export function patientLabs(data:StaffLabResults,checks:DoctorUploadOverride[],approvals?:MemberUploadApprovals):PatientLabData{
 const files:PatientLabFile[]=[],values:PatientLabValue[]=[];
 for(const file of data.clinic){
  const job=file.job,override=checks.some(row=>row.fileId===file.fileId);
  const mismatch=override||(!job?.identityConfirmedAt&&(job?.identityStatus==='mismatch'||job?.identityStatus==='multiple_patients'));
  const identityReady=!override&&!!job&&(!!job.identityConfirmedAt||job.identityStatus==='match');
  const unreviewed=file.values.some(v=>v.status==='unverified'||v.status==='auto_accepted');
  const empty=job?.state==='done'&&file.values.length===0;
  const needsReview=empty||!identityReady||unreviewed||job?.state!=='done';
  files.push({id:file.fileId,source:'clinic',name:file.name,at:file.uploadedAt,state:mismatch?'mismatch':empty?'empty':!identityReady||needsReview?'to-check':'checked',needsReview});
  if(identityReady)for(const v of file.values){
   if(v.status==='rejected')continue;
   values.push({id:v.valueId,fileId:file.fileId,source:'clinic',testName:v.testName,catalogueRef:v.catalogueRef,value:String(v.status==='corrected'?v.correctedValue??v.valueText:v.valueText),unit:v.status==='corrected'?v.correctedUnit??v.unit:v.unit,on:v.collectedOn,mark:v.status==='verified'||v.status==='corrected'?'reviewed':'not-reviewed'});
  }
 }
 for(const file of data.memberUploads){
  const job=file.job,mismatch=job?.identityStatus==='mismatch'||job?.identityStatus==='multiple_patients'||job?.confirmation?.identityAnswer==='not_mine';
  const ready=job?.state==='done'&&!mismatch&&job?.confirmation?.identityAnswer==='mine';
  const approval=approvals?.readings.find(row=>row.documentId===file.documentId&&row.jobId===job?.jobId)?.approval;
  const pending=!approval;
  const empty=job?.state==='done'&&file.values.length===0;
  files.push({id:file.documentId,source:'member',name:file.name,at:file.uploadedAt,state:mismatch?'mismatch':empty?'empty':!ready||pending?'to-check':'checked',needsReview:empty||!ready||pending});
  if(ready)for(const v of file.values){
   const reviewed=approval?.values.find(value=>value.valueId===v.valueId);
   if(reviewed?.action==='removed'||(!reviewed&&v.memberStatus==='rejected'))continue;
   values.push({id:v.valueId,fileId:file.documentId,source:'member',testName:v.testName,catalogueRef:v.catalogueRef,value:String(reviewed?.value??(v.memberStatus==='corrected'?v.memberValue??v.valueText:v.valueText)),unit:v.unit,on:v.collectedOn,mark:reviewed?'reviewed':v.memberStatus==='pending'?'not-reviewed':'member-reported'});
  }
 }
 const priority=(f:PatientLabFile)=>f.state==='mismatch'?0:f.state==='to-check'?1:f.state==='empty'?2:3;
 return {files:files.sort((a,b)=>priority(a)-priority(b)||Date.parse(b.at)-Date.parse(a.at)),values:values.sort((a,b)=>(b.on??'').localeCompare(a.on??''))};
}
