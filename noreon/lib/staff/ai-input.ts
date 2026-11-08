import {explanationInput} from '@/lib/reports/explanation-input';
import {z} from 'zod';
import {caseSummaryPayloadSchema} from '@/lib/service-workflow/case-summary';
import type {EvidenceReport} from '@/lib/service-workflow/report-evidence';
import {validateConsentedSelection,type OmittedEvidence} from '@/lib/service-workflow/evidence-ledger';
import type {CaseEvidence} from '@/lib/service-workflow/case-summary';
const omittedSchema=z.object({findings:z.number().int().nonnegative(),bloodPressure:z.number().int().nonnegative(),reportRows:z.number().int().nonnegative()}).strict();
const summaryRequest=caseSummaryPayloadSchema.extend({evidenceRevision:z.number().int().nonnegative(),omitted:omittedSchema}).strict();
const explainRequest=z.object({op:z.literal('explain'),consent:z.literal(true),locale:z.enum(['en','hy']),reportId:z.string().min(1).max(48),reportRevision:z.number().int().nonnegative(),contentRevision:z.number().int().nonnegative()}).strict();
export function validateStaffAiInput(input:unknown,current:{evidenceRevision:number;evidence:CaseEvidence;reports?:EvidenceReport[]}) {
  if(input&&typeof input==='object'&&'op' in input&&input.op==='explain') {
    const parsed=explainRequest.parse(input);
    const report=current.reports?.find(report=>report.id===parsed.reportId);
    if(!report||report.state!=='confirmed'||report.revision!==parsed.reportRevision||(report.contentRevision??0)!==parsed.contentRevision)throw new Error('stale_evidence');
    return {op:'explain' as const,consent:true as const,locale:parsed.locale,reviewed:explanationInput(report.reviewed)};
  }
  const parsed=summaryRequest.parse(input);
  if(parsed.evidenceRevision!==current.evidenceRevision)throw new Error('stale_evidence');
  const evidence=validateConsentedSelection(parsed.evidence,current.evidence,parsed.omitted as OmittedEvidence);
  return caseSummaryPayloadSchema.parse({op:'case-summary',consent:true,evidence});
}
