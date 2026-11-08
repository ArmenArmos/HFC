import {extractionSchema} from '@/lib/reports/schema';
import type {CaseEvidence} from './case-summary';
export type EvidenceReport={id?:string;revision?:number;contentRevision?:number;state:string;reviewed:unknown};
export type ReportSource={reportId:string;contentRevision:number;rowIndex:number;page:number};
export function reportEvidence(reports:EvidenceReport[]) {
  const entries=reports.flatMap(report=>{
    if(report.state!=='confirmed'||!report.id||!/^[a-zA-Z0-9_-]{1,48}$/.test(report.id)) return [];
    const parsed=extractionSchema.safeParse(report.reviewed);
    if(!parsed.success) return [];
    const contentRevision=report.contentRevision??0;
    if(!Number.isSafeInteger(contentRevision)||contentRevision<0) return [];
    const reportDate=parsed.data.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.reportDate) && Number.isFinite(Date.parse(parsed.data.reportDate)) && new Date(parsed.data.reportDate).toISOString().slice(0,10)===parsed.data.reportDate ? parsed.data.reportDate : null;
    return parsed.data.rows.map((row,rowIndex)=>({
      evidence:{id:`report-${report.id}-v${contentRevision}-row${rowIndex}`,name:row.name,literal:row.literal,unit:row.unit,reference:row.reference,page:row.page,uncertain:row.uncertain,reportDate} satisfies CaseEvidence['reportRows'][number],
      source:{reportId:report.id!,contentRevision,rowIndex,page:row.page} satisfies ReportSource,
    }));
  }).sort((a,b)=>(b.evidence.reportDate??'').localeCompare(a.evidence.reportDate??'')||a.source.reportId.localeCompare(b.source.reportId)||a.source.contentRevision-b.source.contentRevision||a.source.rowIndex-b.source.rowIndex);
  return {rows:entries.map(e=>e.evidence),sources:Object.fromEntries(entries.map(e=>[e.evidence.id,e.source]))};
}
