import {z} from 'zod';
import {analyteDisplayName} from './analyte-names';
import {rangeStatus,type RangeStatus} from '@/lib/member-history/lab-results';

/**
 * The assigned doctor approves a member upload's AI reading before the member sees it (Armen, 20 Oct 2026;
 * 20261021070050). Read: staff_member_upload_approvals; command: doctor_member_upload_approve.
 */
export const approveVersion='member-upload-approve-v1' as const;
const uuid=z.uuid(),instant=z.iso.datetime({offset:true});
const approvedValue=z.object({valueId:uuid,action:z.enum(['kept','corrected','removed']),value:z.number().nullable()});
const approval=z.object({version:z.number().int(),approvedAt:instant,byYou:z.boolean(),doctorName:z.string().nullable(),interpretationHy:z.string(),interpretationEn:z.string(),
 interpretationEdited:z.boolean(),changes:z.array(z.record(z.string(),z.unknown())).nullable(),values:z.array(approvedValue)});
export const approvalsSchema=z.object({version:z.literal('member-upload-approvals-v1'),required:z.boolean(),canApprove:z.boolean(),
 readings:z.array(z.object({jobId:uuid,documentId:uuid,ranges:z.array(z.object({valueId:uuid,refLow:z.number().nullable(),refHigh:z.number().nullable()})),approval:approval.nullable()}))});
export type MemberUploadApprovals=z.infer<typeof approvalsSchema>;
export type MemberUploadReadingApproval=MemberUploadApprovals['readings'][number];

const valueAction=z.strictObject({valueId:uuid,action:z.enum(['keep','correct','remove']),value:z.number().finite().gt(-1e9).lt(1e9).optional()})
 .refine(v=>(v.action==='correct')===(v.value!==undefined));
export const approveCommandSchema=z.strictObject({version:z.literal(approveVersion),submissionId:uuid,memberId:uuid,jobId:uuid,basedOn:z.number().int().min(1).nullable(),
 values:z.array(valueAction).min(1).max(200),interpretationHy:z.string().trim().min(1).max(2000),interpretationEn:z.string().trim().min(1).max(1500),interpretationEdited:z.boolean()});
export type ApproveCommand=z.infer<typeof approveCommandSchema>;
// Astra N1-5: blank qualitative values stay printed; a typed number is a correction.
export function approveValueAction(text:string,baseline:number|null):Omit<ApproveCommand['values'][number],'valueId'>|null{
 if(!text.trim())return baseline===null?{action:'keep'}:null;
 const n=Number(text.trim().replace(',','.'));
 return Number.isFinite(n)?n===baseline?{action:'keep'}:{action:'correct',value:n}:null;
}
export const approveStatuses=['approved','invalid','stale','not-ready','disabled','unavailable','access','outcome-unknown'] as const;
export type ApproveResult={status:(typeof approveStatuses)[number]};

/** A value as the doctor's draft sees it: the number that will be shown, and its printed range. */
export type DraftValue={testName:string;catalogueRef:string|null;value:number|null;refLow:number|null;refHigh:number|null;collectedOn:string|null;removed:boolean};

const dmy=(iso:string|null)=>iso&&/^\d{4}-\d{2}-\d{2}$/.test(iso)?`${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(0,4)}`:null;
/**
 * A plain-words draft of what the member will read, built in code from the values and their printed ranges. The
 * doctor edits it before approving. Counts and names only: no diagnosis, advice or reassurance. UNAPPROVED v1
 * wording (Armen, Tatevik).
 */
export function draftInterpretation(values:DraftValue[]):{hy:string;en:string}{
 const kept=values.filter(v=>!v.removed);
 const by=(s:RangeStatus)=>kept.filter(v=>rangeStatus(v)===s);
 const ranged=kept.filter(v=>rangeStatus(v)!=='none');
 const date=dmy(kept.map(v=>v.collectedOn).filter(Boolean).sort().at(-1)??null);
 const names=(vs:DraftValue[],l:'hy'|'en')=>vs.map(v=>analyteDisplayName(v.testName,l,v.catalogueRef)).join(', ');
 const out=by('out'),edge=by('borderline'),inside=by('in').length+edge.length;
 const en:string[]=[],hy:string[]=[];
 if(ranged.length){
  en.push(`${date?`Your results from ${date}: `:'Your results: '}${inside} of ${ranged.length} with a printed range are inside the lab's range.`);
  hy.push(`${date?`Ձեր ${date}-ի արդյունքներից`:'Ձեր արդյունքներից'} ${ranged.length}-ն ունեն լաբորատորիայի միջակայք, և դրանցից ${inside}-ը միջակայքում են։`);
 }else{
  en.push(`${date?`Your results from ${date}`:'Your results'} are below. The sheet did not print a range for them.`);
  hy.push(`${date?`Ձեր ${date}-ի արդյունքները`:'Ձեր արդյունքները'} ներքևում են։ Թերթիկին դրանց միջակայքը նշված չէ։`);
 }
 if(out.length){en.push(`Outside the lab's range: ${names(out,'en')}.`);hy.push(`Միջակայքից դուրս են՝ ${names(out,'hy')}։`);}
 if(edge.length){en.push(`Close to the edge of the range: ${names(edge,'en')}.`);hy.push(`Միջակայքի սահմանին մոտ են՝ ${names(edge,'hy')}։`);}
 return {en:en.join(' '),hy:hy.join(' ')};
}
