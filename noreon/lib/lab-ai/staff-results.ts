import {z} from 'zod';
import {summarySchema} from './doctor-schema';

/**
 * AI-read lab results for one member, for the assigned doctor or an administrator (staff_lab_ai_results,
 * 20261018120200). Read only: clinic values carry the doctor's review state, member uploads the member's
 * answers. The reader gives no confidence score; `checks` are the code checks that failed for a value.
 */
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date();
const jobState=z.enum(['queued','running','done','rejected','failed']);
const identityStatus=z.enum(['match','unknown','mismatch','multiple_patients']);
const valueBase={valueId:uuid,seq:z.number().int(),testName:z.string(),catalogueRef:z.string().nullable(),valueText:z.string(),value:z.number().nullable(),unit:z.string().nullable(),
 refText:z.string().nullable(),labFlag:z.string().nullable(),collectedOn:day.nullable(),page:z.number().int(),checks:z.array(z.string()),
 attention:z.enum(['threshold','lab_critical','needs_doctor']).nullable(),attentionRule:z.string().nullable()};
const clinicValue=z.object({...valueBase,status:z.enum(['unverified','auto_accepted','verified','corrected','rejected']),correctedValue:z.number().nullable(),correctedUnit:z.string().nullable(),reviewedAt:instant.nullable()});
const memberValue=z.object({...valueBase,memberStatus:z.enum(['pending','confirmed','corrected','rejected']),memberValue:z.number().nullable(),memberReviewedAt:instant.nullable()});
const identity=z.object({nameOnSheet:z.string().nullable(),birthDateOnSheet:z.string().nullable(),sampleDate:z.string().nullable(),patientsSeen:z.number().int(),nameMatch:z.string(),birthDateMatch:z.string()}).partial();
const jobBase={jobId:uuid,state:jobState,outcome:z.string().nullable(),pageCount:z.number().int().nullable(),identityStatus:identityStatus.nullable(),identity:identity.nullable(),
 summary:summarySchema.nullable(),provider:z.string().nullable(),model:z.string().nullable(),createdAt:instant,finishedAt:instant.nullable()};
export const staffLabResultsSchema=z.object({version:z.literal('staff-lab-ai-v1'),enabled:z.boolean(),viewer:z.enum(['doctor','admin']),
 clinic:z.array(z.object({fileId:uuid,name:z.string(),clinic:z.string(),uploadedAt:instant,
  job:z.object({...jobBase,identityConfirmedAt:instant.nullable()}).nullable(),values:z.array(clinicValue)})),
 memberUploads:z.array(z.object({documentId:uuid,name:z.string(),uploadedAt:instant,
  job:z.object({...jobBase,confirmation:z.object({identityAnswer:z.enum(['mine','not_mine']).nullable(),valuesSaved:z.number().int(),valuesCharted:z.number().int(),at:instant}).nullable()}).nullable(),
  values:z.array(memberValue)})),
});
export type StaffLabResults=z.infer<typeof staffLabResultsSchema>;
export type StaffClinicFile=StaffLabResults['clinic'][number];
export type StaffMemberUpload=StaffLabResults['memberUploads'][number];

/** Outside the lab's range or flagged by the lab (high, low, abnormal, critical), or a THRESHOLD rule matched. */
export const outOfRange=(v:{attention:string|null;labFlag:string|null})=>v.attention!==null||(v.labFlag!==null&&v.labFlag!=='normal');

export type ResultsCardItem={key:string;href:string;source:'clinic'|'member';name:string;state:'reading'|'read'|'not_read';outOfRange:number;values:number;at:string};
export const RESULTS_CARD_DAYS=14;
/**
 * The "Results" card at the top of the member page: readings still running, and readings that finished in
 * the last two weeks (running first, then newest), so the member's profile visibly changes after a reading.
 */
/** The doctor opens a clinic file's check page; anything else jumps to its row further down the page. */
export function resultsCardItems(r:StaffLabResults|null|undefined,memberId:string,now:number=Date.now()):ResultsCardItem[]{
 if(!r?.enabled)return [];
 const since=now-RESULTS_CARD_DAYS*86_400_000,out:ResultsCardItem[]=[];
 const push=(source:'clinic'|'member',id:string,name:string,job:{state:string;createdAt:string;finishedAt:string|null}|null,values:{attention:string|null;labFlag:string|null}[])=>{
  if(!job)return;
  const running=job.state==='queued'||job.state==='running';
  const at=job.finishedAt??job.createdAt;
  if(!running&&Date.parse(at)<since)return;
  out.push({key:`${source}:${id}`,href:source==='clinic'&&r.viewer==='doctor'?`/staff/real/members/${memberId}/documents/${id}/check`:`#lab-ai-${id}`,source,name,state:running?'reading':job.state==='done'&&values.length?'read':'not_read',outOfRange:values.filter(outOfRange).length,values:values.length,at});
 };
 for(const f of r.clinic)push('clinic',f.fileId,f.name,f.job,f.values);
 for(const d of r.memberUploads)push('member',d.documentId,d.name,d.job,d.values);
 return out.sort((a,b)=>(a.state==='reading'?0:1)-(b.state==='reading'?0:1)||Date.parse(b.at)-Date.parse(a.at));
}
