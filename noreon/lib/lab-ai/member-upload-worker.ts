import {createHash} from 'node:crypto';
import {z} from 'zod';
import {measures} from '@/lib/member-history/measures';
import {inspectPdf,LAB_PDF_MAX_BYTES} from './pdf-inspect';
import {normaliseUnit} from './catalogue';
import {clean,extractionSchema,parseDate,storedValue,validateResult,type LabValue} from './extraction';
import {checkIdentity} from './identity';
import {buildSummary,guardNarrative,narrativeFacts,type Narrative} from './summary';
import {extractEstimate,extractInputTokens,narrateEstimate,type LabMediaType} from './provider';
import {DEFER,callModel,labToday,narrateAllowed,type Finish,type LabWorkerDeps} from './worker';

/**
 * A member's own earlier result (Progress > Earlier results), read by the same reader as clinic PDFs:
 * same reservation, caps, trace and fallback (callModel). A PDF gets the clinic file checks; a photo
 * (JPEG or PNG, already redrawn by the member's browser) counts as one page. Values are kept for the
 * member to confirm; identity is checked against the member's own profile, and a mismatch is asked
 * about, not refused. Nothing here logs content.
 */
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const claimedMemberUploadJobSchema=z.object({kind:z.literal('member_upload'),jobId:uuid,leaseToken:uuid,attempt:z.number().int().min(1).max(3),
 file:z.object({documentId:uuid,bucket:z.literal('member-history'),objectKey:z.string().min(1).max(1024),sizeBytes:z.number().int().nonnegative(),sha256:sha,mime:z.enum(['application/pdf','image/jpeg','image/png'])}),
 member:z.object({name:z.string().max(500),birthDate:z.string().nullable()}),
 previous:z.array(z.object({catalogueRef:z.string(),value:z.coerce.number(),unit:z.string().nullable(),collectedOn:z.string().nullable()})).max(60),
});
export type ClaimedMemberUploadJob=z.infer<typeof claimedMemberUploadJobSchema>;

/** Content decides the type, as at upload. */
function sniff(bytes:Uint8Array):LabMediaType|null{
 if(bytes.length>=5&&String.fromCharCode(...bytes.subarray(0,5))==='%PDF-')return 'application/pdf';
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((b,i)=>bytes[i]===b))return 'image/png';
 return null;
}

const CHART_UNIT:Record<string,'mmol/L'|'mg/dL'|'%'>={'mmol/l':'mmol/L','mg/dl':'mg/dL','%':'%'};
const BLOCKING=['mapping_conflict','unmapped','unit_missing','unit_unexpected','implausible','censored','not_numeric','date_future'];
/**
 * The member-history measure a value can be charted as: one of the four lab measures the member can
 * also enter by hand, in a unit and range that measure accepts, with no failed code check. Else null:
 * the value is still shown and answered, just not charted.
 */
export function chartMeasure(v:Pick<LabValue,'catalogueRef'|'value'|'unit'|'checks'>):{measure:'total_cholesterol'|'ldl_c'|'hba1c'|'fasting_glucose';measureUnit:'mmol/L'|'mg/dL'|'%'}|null{
 if(v.value==null||v.checks.some(c=>BLOCKING.includes(c)))return null;
 const key=v.catalogueRef;
 if(key!=='total_cholesterol'&&key!=='ldl_c'&&key!=='hba1c'&&key!=='fasting_glucose')return null;
 const unit=CHART_UNIT[normaliseUnit(v.unit)];
 const accepted=unit?measures[key].units.find(u=>u.unit===unit):undefined;
 if(!unit||!accepted||v.value<accepted.bounds.min||v.value>accepted.bounds.max)return null;
 return {measure:key,measureUnit:unit};
}

export async function runMemberUploadJob(job:ClaimedMemberUploadJob,deps:LabWorkerDeps):Promise<Finish>{
 const today=labToday(deps);
 if(job.file.sizeBytes>LAB_PDF_MAX_BYTES)return {disposition:'rejected',outcome:'file_too_large'};
 if(!deps.route)return {disposition:'defer',outcome:'reading_off'};
 const bytes=await deps.download(job.file.bucket,job.file.objectKey).catch(()=>null);
 if(!bytes)return {disposition:'retry',outcome:'file_unavailable'};
 if(bytes.byteLength!==job.file.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==job.file.sha256)return {disposition:'rejected',outcome:'hash_mismatch'};
 const mediaType=sniff(bytes);
 if(!mediaType||mediaType!==job.file.mime)return {disposition:'rejected',outcome:'not_supported'};
 let pageCount=1;
 if(mediaType==='application/pdf'){const pdf=inspectPdf(bytes);if(!pdf.ok)return {disposition:'rejected',outcome:pdf.reason};pageCount=pdf.pageCount;}
 const called=await callModel(job,deps,'extract',p=>p.extract({pdf:bytes,pageCount,mediaType}),p=>extractEstimate(p.pricing,pageCount),3*extractInputTokens(pageCount));
 if('oversize'in called)return {disposition:'rejected',outcome:'input_oversize'};
 if('refused'in called)return DEFER.has(called.refused)||called.refused==='provider_unavailable'?{disposition:'defer',outcome:called.refused}:{disposition:'retry',outcome:called.refused};
 const {result,provider}=called;
 if(result.kind==='error')return {disposition:'retry',outcome:`provider_${result.errorClass}`};
 if(result.kind==='refusal')return {disposition:'retry',outcome:'provider_refusal'};
 const parsed=extractionSchema.safeParse(result.object);
 if(!parsed.success)return {disposition:'retry',outcome:'invalid_output'};
 const e=parsed.data;
 const identity=checkIdentity(e,{name:job.member.name,birthDate:job.member.birthDate});
 const ctx={pageCount,sampleDate:parseDate(e.sampleDate),labName:clean(e.labName,120),today};
 const values:LabValue[]=e.unreadable||identity.status==='multiple_patients'?[]:e.results.slice(0,200).map(r=>validateResult(r,ctx));
 const base={values,previous:job.previous,visitTests:[],identity:identity.status,pageCount,model:result.responseModel,unreadable:e.unreadable};
 // The narrative is written from code-checked facts only, and only when the sheet is not clearly someone else's.
 let narrative:Narrative|null=null;
 if(values.length&&narrateAllowed(deps)&&(identity.status==='match'||identity.status==='unknown')){
  const facts=narrativeFacts(buildSummary({...base,narrative:null}),values);
  const n=await callModel(job,deps,'summary',p=>p.narrate({facts}),p=>narrateEstimate(p.pricing,facts)).catch(()=>null);
  if(n&&'result'in n&&n.result.kind==='ok')narrative=guardNarrative(n.result.object,facts);
 }
 const summary=identity.status==='multiple_patients'||identity.status==='mismatch'||e.unreadable||!values.length?null:buildSummary({...base,narrative});
 return {disposition:'done',outcome:e.unreadable?'unreadable':identity.status==='multiple_patients'?'multiple_patients':identity.status==='mismatch'?'identity_mismatch':values.length?'extracted':'no_values',
  pageCount,sourceSha256:job.file.sha256,identityStatus:identity.status,identity:identity.detail,
  values:values.map(v=>{const m=chartMeasure(v);return {...storedValue(v),measure:m?.measure??null,measureUnit:m?.measureUnit??null};}),summary,
  provider:provider.providerName,model:provider.model};
}
