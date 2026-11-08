import {extractionSchema} from '@/lib/reports/schema';
import type {EvidenceReport} from './report-evidence';
export type ReportAdvisory='name-missing'|'name-differs'|'date-missing'|'possible-duplicate';
const nameKey=(name:string)=>name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
function duplicateKey(report:EvidenceReport) {
  if(report.state!=='confirmed')return null;
  const parsed=extractionSchema.safeParse(report.reviewed);
  if(!parsed.success||!parsed.data.rows.length)return null;
  return JSON.stringify({date:parsed.data.reportDate,rows:parsed.data.rows.map(({name,literal,unit,reference,page,uncertain})=>({name,literal,unit,reference,page,uncertain}))});
}
export function reportAdvisories(report:EvidenceReport,memberName:string,others:EvidenceReport[]):ReportAdvisory[] {
  const parsed=extractionSchema.safeParse(report.reviewed);
  if(!parsed.success)return [];
  const result:ReportAdvisory[]=[];
  if(!parsed.data.personName?.trim())result.push('name-missing');
  else if(memberName.trim()&&nameKey(parsed.data.personName)!==nameKey(memberName))result.push('name-differs');
  if(!parsed.data.reportDate)result.push('date-missing');
  const key=duplicateKey(report);
  if(key&&others.some(r=>r.id!==report.id&&duplicateKey(r)===key))result.push('possible-duplicate');
  return result;
}
