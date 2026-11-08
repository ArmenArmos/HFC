import {z} from 'zod';
import type {ConsultationProposal} from '@/lib/patient-care/consultation-proposal';
import type {PublicationGate} from './publication-gate';
import {approveCommandSchema,approveStatuses,type ApproveResult,type DoctorFirstNote} from '@/lib/first-note/schema';
import type {FirstNoteDraft} from '@/lib/first-note/compose';
import type {DoctorRegimenReview} from '@/lib/patient-care/regimen';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {DecisionRpc} from './items';

const hash=z.string().regex(/^[a-f0-9]{32}$/);
export const approvalContextSchema=z.object({memberId:z.uuid(),revision:z.number().int().nonnegative(),evidenceToken:hash});
export const firstNoteContextSchema=approvalContextSchema.extend({appointmentsRevision:hash});
export const firstNoteCardCommandSchema=z.strictObject({context:firstNoteContextSchema,note:approveCommandSchema})
 .refine(v=>v.context.memberId===v.note.memberId);
export const clinicalCardCommandSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('regimen'),context:approvalContextSchema,requestId:z.uuid(),regimenHash:hash,approved:z.literal(true),changeSummary:z.string().trim().max(1000)}),
 z.strictObject({kind:z.literal('consultation-decision'),context:approvalContextSchema,decision:z.enum(['required','not-required']),note:z.string().trim().min(1).max(2000)}),
 z.strictObject({kind:z.literal('complete-consultation'),context:approvalContextSchema,completedAtLocal:z.string().min(1).max(40),mode:z.enum(['phone','video','in-person']),note:z.string().trim().min(1).max(2000)}),
]);
export type ApprovalContext=z.infer<typeof approvalContextSchema>;
export type FirstNoteContext=z.infer<typeof firstNoteContextSchema>;
export type ClinicalCardCommand=z.infer<typeof clinicalCardCommandSchema>;
export type FirstNoteReviewCard={context:FirstNoteContext;submissionId:string;data:Extract<DoctorFirstNote,{enabled:true}>;draft:FirstNoteDraft|null;assessmentRevision:number};
export type RegimenReviewCard={context:ApprovalContext;requestId:string;draft:NonNullable<ClinicalSnapshot['draft']>;review:DoctorRegimenReview;clinicalReview:ClinicalSnapshot['review'];current:boolean;publicationGate?:PublicationGate|null;staleReason?:'consultation'};
export type ConsultationReviewCard={context:ApprovalContext;review:NonNullable<ClinicalSnapshot['review']>;proposal?:ConsultationProposal|null};
export type ApprovalCards={firstNote:FirstNoteReviewCard|null;regimen:RegimenReviewCard|null;consultation:ConsultationReviewCard|null};

/** Card-only guard, then the same first-note command, with an atomic audit in the database. */
export async function runFirstNoteCard(client:DecisionRpc,input:unknown):Promise<ApproveResult>{
 const p=firstNoteCardCommandSchema.safeParse(input);if(!p.success)return {status:'invalid'};
 const {context:c,note}=p.data;
 // The existing parser trims page submissions. A card may approve only the exact text that was displayed.
 const shown=(input as {note:{textEn:unknown;textHy:unknown}}).note;
 if(shown.textEn!==note.textEn||shown.textHy!==note.textHy)return {status:'invalid'};
 try{
  const r=await client.rpc('doctor_first_note_card_approve',{p_command:note,p_revision:c.revision,p_evidence_token:c.evidenceToken,p_appointments_revision:c.appointmentsRevision});
  if(r.error)return {status:r.error.code==='42501'?'access':r.error.code==='40001'?'stale':r.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const s=(r.data as {status?:string}|null)?.status;
  return (approveStatuses as readonly string[]).includes(s??'')?{status:s as ApproveResult['status']}:{status:'outcome-unknown'};
 }catch{return {status:'outcome-unknown'};}
}

/** No new command semantics: translate a typed press to the existing page action's fields. */
export function clinicalCardForm(command:ClinicalCardCommand):FormData{
 const f=new FormData(),c=command.context;
 f.set('id',c.memberId);f.set('revision',String(c.revision));f.set('token',c.evidenceToken);
 f.set('operation',command.kind==='regimen'?'publish':command.kind);
 if(command.kind==='regimen'){
  f.set('requestId',command.requestId);f.set('regimenHash',command.regimenHash);f.set('regimenApproved','on');f.set('changeSummary',command.changeSummary);
 }else{
  f.set('note',command.note);
  if(command.kind==='consultation-decision')f.set('decision',command.decision);
  else{f.set('completedAtLocal',command.completedAtLocal);f.set('mode',command.mode);}
 }
 return f;
}
