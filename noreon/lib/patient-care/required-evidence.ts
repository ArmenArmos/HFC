import {z} from 'zod';
/** Sources the assigned doctor can confirm a required clinic or home test from (20261031123000), as a confirmation
 * holds them. The database decides what counts and refuses the rest; nothing here calculates or judges a value. */
const investigation=z.object({id:z.uuid(),testId:z.string(),performedOn:z.string(),result:z.enum(['normal','abnormal']),finding:z.string().nullable(),source:z.string(),recordedByName:z.string(),recordedAt:z.string()});
const reading=z.object({id:z.uuid(),systolic:z.number(),diastolic:z.number(),pulse:z.number().nullable()});
const week=z.object({id:z.uuid(),startsOn:z.string(),days:z.number(),readingsPerSlot:z.number(),readings:z.array(reading.extend({day:z.number(),slot:z.enum(['morning','evening']),measuredAt:z.string()}))});
const staffReading=reading.extend({measuredAt:z.string(),takenBy:z.string(),takenByRole:z.string()});
const bodyMeasures=z.object({id:z.uuid(),observedAt:z.string(),takenBy:z.string(),takenByRole:z.string(),observations:z.array(z.object({field:z.string(),value:z.number(),unit:z.string(),observedAt:z.string()}))});
export type InvestigationRecord=z.infer<typeof investigation>;
export type WeekSource=z.infer<typeof week>;
export type StaffReadingSource=z.infer<typeof staffReading>;
export type BodyMeasuresSource=z.infer<typeof bodyMeasures>;
export const INVESTIGATION_TESTS=['ecg-12-lead','echocardiogram','holter'] as const;
const INVESTIGATIONS:readonly string[]=INVESTIGATION_TESTS;
export const isInvestigationTest=(id:string)=>INVESTIGATIONS.includes(id);
export const requiredEvidenceSourcesSchema=z.object({version:z.literal('required-evidence-sources-v1'),sources:z.object({
 'ecg-12-lead':z.array(investigation),echocardiogram:z.array(investigation),holter:z.array(investigation),'bp-home-log':z.array(week),'bp-visit':z.array(staffReading),anthropometry:z.array(bodyMeasures)})});
export type RequiredEvidenceSources=z.infer<typeof requiredEvidenceSourcesSchema>['sources'];
/** The tests that have an evidence path. publish_patient_clinical_plan keeps its own list and refuses any other. */
export const hasEvidencePath=(id:string):id is keyof RequiredEvidenceSources=>isInvestigationTest(id)||id==='bp-home-log'||id==='bp-visit'||id==='anthropometry';
type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
/** Null means unreadable, never "no evidence". The database enforces the assigned doctor. */
export async function readRequiredEvidenceSources(client:Rpc,memberId:string):Promise<RequiredEvidenceSources|null>{
 if(!z.uuid().safeParse(memberId).success)return null;
 try{const r=await client.rpc('doctor_required_evidence_sources',{p_user_id:memberId});if(r.error)return null;const p=requiredEvidenceSourcesSchema.safeParse(r.data);return p.success?p.data.sources:null;}catch{return null;}
}
