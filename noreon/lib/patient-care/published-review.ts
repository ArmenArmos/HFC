import {z} from 'zod';
import {extractionSchema,rowSchema,type ReportExtraction} from '@/lib/reports/schema';
import {draftSchema} from '@/lib/service-workflow/publication';
import type {CarePlan} from './types';
import {clinicLabReceiptSchema,isClinicLabReceipt} from './clinical-review-schema';
/** Owner-only immutable publication snapshots returned by the existing RPC. */
export const publishedReviewSchema=z.array(z.object({planId:z.uuid(),publishedAt:z.string(),draft:draftSchema,receipts:z.record(z.string(),z.union([clinicLabReceiptSchema.passthrough(),z.object({reportId:z.uuid(),rows:z.array(z.number()),note:z.string()}).passthrough()])),reports:z.array(z.object({id:z.uuid(),reviewed:z.unknown()}).passthrough())}));
export type PublishedReview=z.infer<typeof publishedReviewSchema>[number];
export function withPublishedReview(plan:CarePlan,publications:PublishedReview[]):CarePlan {
 const publication=publications.find(p=>p.planId===plan.id);
 return publication?{...plan,publishedReview:{explanation:publication.draft.explanation,instructions:publication.draft.instructions,followUp:publication.draft.followUp}}:plan;
}
export type PublishedSourceRow={
 id:string;planId:string;publishedAt:string;reportId:string;rowIndex:number;
 source:ReportExtraction['rows'][number];laboratory:string|null;reportDate:string|null;notes:string[];
};
/** Only checked receipt rows in owner-visible publications, kept exactly as recorded. */
export function publishedSourceRows(publications:PublishedReview[]):PublishedSourceRow[]{
 const rows=new Map<string,PublishedSourceRow>();
 for(const publication of publications){
  for(const receipt of Object.values(publication.receipts)){
   // Clinic lab values reach the member as published results (patient_care_results), not as report rows.
   if(isClinicLabReceipt(receipt))continue;
   const report=extractionSchema.safeParse(publication.reports.find(r=>r.id===receipt.reportId)?.reviewed);
   if(!report.success)continue;
   for(const rowIndex of receipt.rows){
    const source=report.data.rows[rowIndex];if(!source)continue;
    const id=`${publication.planId}:${receipt.reportId}:${rowIndex}`;
    const existing=rows.get(id);
    if(existing){if(!existing.notes.includes(receipt.note))existing.notes.push(receipt.note);continue;}
    rows.set(id,{id,planId:publication.planId,publishedAt:publication.publishedAt,reportId:receipt.reportId,rowIndex,source,laboratory:report.data.laboratory,reportDate:report.data.reportDate,notes:[receipt.note]});
   }
  }
 }
 return [...rows.values()];
}
export const currentPublishedReviewSchema=z.object({
 planId:z.uuid(),publishedAt:z.string(),draft:draftSchema,
 sourceRows:z.array(z.object({reportId:z.uuid(),rowIndex:z.number().int().min(0),source:rowSchema,laboratory:z.string().nullable(),reportDate:z.string().nullable(),notes:z.array(z.string())}).strict()),
}).strict().nullable();
export type CurrentPublishedReview=NonNullable<z.infer<typeof currentPublishedReviewSchema>>;
export function withCurrentPublishedReview(plan:CarePlan,publication:CurrentPublishedReview|null):CarePlan{
 return publication?.planId===plan.id?{...plan,publishedReview:{explanation:publication.draft.explanation,instructions:publication.draft.instructions,followUp:publication.draft.followUp}}:plan;
}
export function currentPublishedSourceRows(publication:CurrentPublishedReview|null):PublishedSourceRow[]{
 return publication?publication.sourceRows.map(row=>({...row,id:`${publication.planId}:${row.reportId}:${row.rowIndex}`,planId:publication.planId,publishedAt:publication.publishedAt})):[];
}
