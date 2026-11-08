import {testById} from '@/lib/clinical/seed/tests';
import {hasTestCoverage,testsNeeded,type FreshTest} from '@/lib/zoe-chat-actions/next-step';
import type {MemberResults} from '@/lib/member-history/lab-results';
import {z} from 'zod';

const receiptSchema=z.object({snapshot:z.object({document:z.object({id:z.uuid()})}),outcome:z.object({document:z.object({docType:z.string(),studyDate:z.iso.date().nullable(),medicineChangedSince:z.union([z.boolean(),z.literal('UNKNOWN')])})})});
type Test={id:string;title:string;method:string};
/** Receipts are most recently saved first, independent of when their cards were opened. A date alone, partial panel, unapproved result or missing
 * medicine-change answer cannot remove a test. Re-evaluate dates rather than trusting saved `fresh`. */
export function freshTestEvidence(tests:readonly Test[],results:MemberResults|null,receipts:readonly unknown[]):FreshTest[]{
 if(!results)return [];
 const latest=new Map<string,z.infer<typeof receiptSchema>>();
 for(const raw of receipts){const p=receiptSchema.safeParse(raw);if(p.success&&!latest.has(p.data.snapshot.document.id))latest.set(p.data.snapshot.document.id,p.data);}
 const saved:FreshTest[]=[];
 for(const test of tests.filter(t=>t.method==='lab')){
  for(const doc of results.documents){
   const facts=latest.get(doc.documentId)?.outcome.document;
   if(doc.state!=='approved'||facts?.docType!=='lab'||!facts.studyDate||facts.medicineChangedSince!==false)continue;
   const keys=results.values.filter(v=>v.documentId===doc.documentId&&v.checked&&v.date===facts.studyDate).map(v=>v.catalogueRef);
   if(hasTestCoverage(testById(test.id)?.catalogueRef,keys))saved.push({testId:test.id,collectedOn:facts.studyDate,medicineChangedSince:false});
  }
 }
 return saved;
}
export function suggestedTests<T extends Test>(tests:readonly T[],saved:readonly FreshTest[],today:string):T[]{
 const rows=testsNeeded(tests.map(t=>({id:t.id,title:t.title,method:t.method as 'lab'|'clinic'|'home-log'})),saved,today).rows;
 const needed=new Set(rows.map(t=>t.id));
 return tests.filter(t=>needed.has(t.id));
}
