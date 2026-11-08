export type ReportAssociation={requirementId:string;rowIndices:number[];contentRevision:number;actorId:string;actorLabel:string;confirmedAt:string};
export type HistoricalReportAssociation=ReportAssociation&{retiredAt:string;reason:'content-changed'|'unconfirmed'|'removed'|'replaced'};
export type ReportMetadata={contentRevision?:number;associations?:ReportAssociation[];associationHistory?:HistoricalReportAssociation[]};
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value??null;
}
export function sameReportContent(a:unknown,b:unknown) { return JSON.stringify(canonical(a))===JSON.stringify(canonical(b)); }
export function reportContentTransition<T extends {revision:number;state:string;extraction?:unknown;reviewed?:unknown}&ReportMetadata>(old:T,next:T,at:string) {
  const changed=!sameReportContent([old.extraction,old.reviewed],[next.extraction,next.reviewed]);
  const reason=changed?'content-changed':next.state!=='confirmed'?'unconfirmed':null;
  const active=old.associations??[];
  return {...next,revision:old.revision+1,contentRevision:(old.contentRevision??0)+(changed?1:0),
    associations:reason?[]:structuredClone(active),
    associationHistory:[...structuredClone(old.associationHistory??[]),...(reason?active.map(a=>({...structuredClone(a),retiredAt:at,reason})):[])]} as Omit<T,keyof ReportMetadata>&{contentRevision:number;associations:ReportAssociation[];associationHistory:HistoricalReportAssociation[]};
}
/** Member publication retains source provenance but never staff identifiers. */
export function memberReportMetadata(record:Record<string,unknown>) {
  const strip=(value:unknown)=>Array.isArray(value)?value.map(entry=>{
    if(!entry||typeof entry!=='object')return entry;
    return Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='actorId'));
  }):[];
  return {...record,associations:strip(record.associations),associationHistory:strip(record.associationHistory)};
}
