import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {matchAnalyte,normaliseUnit} from '@/lib/lab-ai/catalogue';
import {analyteByKey} from '@/lib/lab-ai/catalogue';
import {extractionSchema,parseDate,parseRange,parseValue,validateResult,type Extraction,type LabValue} from '@/lib/lab-ai/extraction';
import {checkIdentity} from '@/lib/lab-ai/identity';

/**
 * Scores saved model readings against the corpus ground truth, through the PRODUCTION checks:
 * the strict schema, validateResult (mapping, unit, plausibility, dates) and checkIdentity. A field
 * counts only if what the worker would keep is right.
 *
 *   node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/ai-eval-labs/lab-score.ts \
 *     --corpus <dir> --runs <dir> --label baseline [--md out.md]
 */
const args=process.argv.slice(2);
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const corpus=opt('--corpus')??'../output/ai-eval-labs-2026-10-19/corpus',runs=opt('--runs')??'../output/ai-eval-labs-2026-10-19/runs',label=opt('--label')??'baseline';
const TODAY='2026-10-19';

type ExpValue={analyte:string;key:string;valueText:string;unit:string|null;referenceRange:string|null;flag:string|null;collectedOn:string;page:number;previous?:boolean};
type Truth={id:string;title:string;lang:string;layout:string;kind:'pdf'|'photo';pages:number;source?:string;member:{name:string;birthDate:string};
 expect:{unreadable:boolean;resultsEmpty:boolean;identity:string;patients:number;sampleDate:string;values:ExpValue[];forbidden:string[];tags:string[];hard?:boolean}};

const num=(s:string|null|undefined)=>{if(s==null)return null;const p=parseValue(s);if(p.value!=null)return p.value;const m=/[<>≤≥]\s*(-?\d+(?:[.,]\d+)?)/.exec(s);return m?Number(m[1]!.replace(',','.')):null;};
const sameValue=(a:string,b:string)=>{
 const ca=/^[<>≤≥]/.test(a.trim()),cb=/^[<>≤≥]/.test(b.trim());
 if(ca!==cb)return false;
 const x=num(a),y=num(b);return x!=null&&y!=null&&Math.abs(x-y)<1e-9&&(!ca||a.trim()[0]===b.trim()[0]);
};
const fold=(s:string|null)=>(s??'').normalize('NFKC').toLowerCase().replace(/,/g,'.').replace(/\s+/g,'');
const sameRange=(a:string|null,b:string|null)=>{
 if(!a&&!b)return true;if(!a||!b)return false;
 const x=parseRange(a),y=parseRange(b);
 if(y)return !!x&&x.low===y.low&&x.high===y.high;
 return fold(a)===fold(b)||fold(a).includes(fold(b))||fold(b).includes(fold(a));
};
const sameUnit=(a:string|null,b:string|null)=>normaliseUnit(a)===normaliseUnit(b);

export type DocScore={id:string;model:string;kind:string;lang:string;tags:string[];ok:boolean;schemaOk:boolean;expected:number;found:number;mapped:number;valueOk:number;unitOk:number;rangeOk:number;
 flagPrinted:number;flagOk:number;flagInvented:number;usable:number;usableExpected:number;converted:number;dateOk:number;datedExpected:number;
 invented:string[];forbiddenTaken:string[];dateConfusion:number;identity:string;identityExpected:string;identityOk:boolean;patientsSeen:number;sampleDateOk:boolean;
 unreadable:boolean|null;emptyOk:boolean|null;misses:string[];checks:Record<string,number>;inputTokens:number;outputTokens:number;usd:number|null;latencyMs:number;retries:number;thinking:number};

export function scoreDoc(t:Truth,raw:{ok:boolean;object:unknown;model:string;inputTokens:number;outputTokens:number;gatewayUsd:number|null;latencyMs:number;schemaRetries:number;thinkingTokens:number}):DocScore{
 const exp=t.expect.values;
 const base:DocScore={id:t.id,model:raw.model,kind:t.kind,lang:t.lang,tags:t.expect.tags,ok:raw.ok,schemaOk:false,expected:exp.filter(v=>v.analyte!=='other'&&!v.previous).length,found:0,mapped:0,valueOk:0,unitOk:0,rangeOk:0,
  flagPrinted:0,flagOk:0,flagInvented:0,usable:0,usableExpected:0,converted:0,dateOk:0,datedExpected:0,invented:[],forbiddenTaken:[],dateConfusion:0,identity:'none',identityExpected:t.expect.identity,identityOk:false,
  patientsSeen:0,sampleDateOk:false,unreadable:null,emptyOk:null,misses:[],checks:{},inputTokens:raw.inputTokens,outputTokens:raw.outputTokens,usd:raw.gatewayUsd,latencyMs:raw.latencyMs,retries:raw.schemaRetries,thinking:raw.thinkingTokens};
 const parsed=extractionSchema.safeParse(raw.object);
 if(!raw.ok||!parsed.success)return base;
 const e:Extraction=parsed.data;base.schemaOk=true;
 const sampleDate=parseDate(e.sampleDate);
 const vals:(LabValue&{raw:Extraction['results'][number]})[]=e.results.map(r=>({...validateResult(r,{pageCount:t.pages,sampleDate,labName:e.labName,today:TODAY}),raw:r}));
 for(const v of vals)for(const c of v.checks)base.checks[c]=(base.checks[c]??0)+1;
 const used=new Set<number>();
 const keyOf=(v:typeof vals[number])=>v.catalogueRef??matchAnalyte(v.testName)??(v.raw.analyte==='other'?null:v.raw.analyte);
 for(const x of exp.filter(v=>v.analyte!=='other')){
  // Candidates: same analyte (by any mapping), same date; for an analyte printed twice (two units), the one in this unit.
  const cands=vals.map((v,i)=>({v,i})).filter(({v,i})=>!used.has(i)&&keyOf(v)===x.key);
  const dated=cands.filter(({v})=>(v.collectedOn??sampleDate)===x.collectedOn);
  const pool=(dated.length?dated:cands);
  const pick=pool.find(({v})=>sameValue(v.valueText,x.valueText)&&sameUnit(v.unit,x.unit))??pool.find(({v})=>sameValue(v.valueText,x.valueText))??pool.find(({v})=>sameUnit(v.unit,x.unit))??pool[0];
  if(x.previous)base.datedExpected++;
  const a=analyteByKey(x.key);const unitAccepted=!!a&&normaliseUnit(x.unit)in a.units&&num(x.valueText)!=null&&!/^[<>]/.test(x.valueText);
  if(unitAccepted&&!x.previous)base.usableExpected++;
  // Earlier results printed on the sheet are optional: reporting them with their own date is right, leaving them out is safe.
  if(x.previous){if(pick&&(pick.v.collectedOn??sampleDate)===x.collectedOn&&sameValue(pick.v.valueText,x.valueText)){used.add(pick.i);base.dateOk++;}continue;}
  if(!pick){base.misses.push(x.key);continue;}
  used.add(pick.i);const v=pick.v;
  base.found++;
  if(v.catalogueRef===x.key)base.mapped++;
  const valueOk=sameValue(v.valueText,x.valueText);if(valueOk)base.valueOk++;else base.misses.push(`${x.key}:value ${v.valueText}≠${x.valueText}`);
  const unitOk=sameUnit(v.unit,x.unit);if(unitOk)base.unitOk++;else base.misses.push(`${x.key}:unit ${v.unit}≠${x.unit}`);
  if(!unitOk&&!valueOk)base.converted++;
  if(sameRange(v.raw.referenceRange,x.referenceRange))base.rangeOk++;else base.misses.push(`${x.key}:range ${v.raw.referenceRange}≠${x.referenceRange}`);
  if(x.flag){base.flagPrinted++;if(v.labFlag===x.flag)base.flagOk++;else base.misses.push(`${x.key}:flag ${v.labFlag}≠${x.flag}`);}
  else if(v.labFlag&&v.labFlag!=='normal'&&!x.previous)base.flagInvented++;
  if(unitAccepted&&v.catalogueRef===x.key&&v.canonical!=null&&valueOk)base.usable++;
 }
 // Anything left over: a printed non-catalogue row, or a value the sheet does not hold for this person and date.
 const printed=exp.map(x=>x.valueText);
 for(const [i,v] of vals.entries()){
  if(used.has(i))continue;
  const isPrinted=printed.some(p=>sameValue(v.valueText,p));
  const forbidden=t.expect.forbidden.find(f=>sameValue(v.valueText,f));
  // A second patient's values are expected in the reading: checkIdentity then keeps none of them.
  if(forbidden&&!isPrinted&&t.expect.identity==='multiple_patients')continue;
  if(forbidden&&!isPrinted)base.forbiddenTaken.push(`${v.testName}=${v.valueText}`);
  else if(!isPrinted)base.invented.push(`${v.testName}=${v.valueText}`);
  else{
   // A previous-column value reported as if it were the current sample.
   const prev=exp.find(x=>x.previous&&sameValue(v.valueText,x.valueText)&&keyOf(v)===x.key);
   if(prev&&(v.collectedOn??sampleDate)!==prev.collectedOn)base.dateConfusion++;
  }
 }
 if(t.expect.resultsEmpty){base.emptyOk=e.results.length===0;for(const v of vals)if(!base.forbiddenTaken.includes(`${v.testName}=${v.valueText}`)&&!base.invented.includes(`${v.testName}=${v.valueText}`))base.invented.push(`${v.testName}=${v.valueText}`);}
 base.unreadable=e.unreadable;
 const id=checkIdentity(e,t.member);base.identity=id.status;base.patientsSeen=id.detail.patientsSeen;
 const want=t.expect.identity==='match_human'?'match':t.expect.identity;
 base.identityOk=t.expect.resultsEmpty?true:id.status===want;
 // A cumulative table prints dates per column and no single sample date: null is right if every value carries its date.
 base.sampleDateOk=t.expect.resultsEmpty?true:sampleDate===t.expect.sampleDate||(t.layout==='E'&&sampleDate==null&&vals.every(v=>v.collectedOn));
 return base;
}

const pct=(a:number,b:number)=>b?`${(100*a/b).toFixed(1)}%`:'–';
export function aggregate(s:DocScore[]){
 const sum=(f:(d:DocScore)=>number)=>s.reduce((n,d)=>n+f(d),0);
 const exp=sum(d=>d.expected);
 return {docs:s.length,schemaOk:sum(d=>+d.schemaOk),expected:exp,found:sum(d=>d.found),valueOk:sum(d=>d.valueOk),unitOk:sum(d=>d.unitOk),rangeOk:sum(d=>d.rangeOk),mapped:sum(d=>d.mapped),
  flagPrinted:sum(d=>d.flagPrinted),flagOk:sum(d=>d.flagOk),flagInvented:sum(d=>d.flagInvented),usable:sum(d=>d.usable),usableExpected:sum(d=>d.usableExpected),converted:sum(d=>d.converted),
  datedExpected:sum(d=>d.datedExpected),dateOk:sum(d=>d.dateOk),dateConfusion:sum(d=>d.dateConfusion),invented:sum(d=>d.invented.length),inventedDocs:s.filter(d=>d.invented.length).length,
  forbidden:sum(d=>d.forbiddenTaken.length),forbiddenDocs:s.filter(d=>d.forbiddenTaken.length).length,identityOk:sum(d=>+d.identityOk),sampleDateOk:sum(d=>+d.sampleDateOk),
  usd:sum(d=>d.usd??0),latencyMs:sum(d=>d.latencyMs),retries:sum(d=>d.retries),inputTokens:sum(d=>d.inputTokens),outputTokens:sum(d=>d.outputTokens),thinking:sum(d=>d.thinking)};
}
export function row(name:string,a:ReturnType<typeof aggregate>){
 return `| ${name} | ${a.docs} | ${pct(a.schemaOk,a.docs)} | ${pct(a.valueOk,a.expected)} | ${pct(a.unitOk,a.found)} | ${pct(a.rangeOk,a.found)} | ${pct(a.flagOk,a.flagPrinted)} | ${pct(a.usable,a.usableExpected)} | ${a.converted} | ${a.invented} (${a.inventedDocs}) | ${a.forbidden} (${a.forbiddenDocs}) | ${a.dateConfusion} | ${pct(a.dateOk,a.datedExpected)} | ${pct(a.identityOk,a.docs)} | ${pct(a.sampleDateOk,a.docs)} | $${(a.usd/Math.max(a.docs,1)).toFixed(4)} | ${(a.latencyMs/Math.max(a.docs,1)/1000).toFixed(1)} s |`;
}
export const HEAD='| Model | Docs | Schema ok | Value right | Unit right | Range right | Flag right | Usable (prod) | Unit converted | Invented (docs) | Distractor taken (docs) | Previous as current | Earlier values kept with date | Identity right | Sample date right | Gateway $/doc | Latency/doc |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

if(import.meta.url===`file://${process.argv[1]}`||process.argv[1]?.endsWith('lab-score.ts')){
 const truths=new Map(readdirSync(corpus).filter(f=>f.endsWith('.json')).map(f=>{const t=JSON.parse(readFileSync(join(corpus,f),'utf8')) as Truth;return [t.id,t];}));
 const dir=join(runs,label);
 const all:DocScore[]=[];
 for(const model of readdirSync(dir).filter(m=>!m.startsWith('_')&&!m.endsWith('.json')&&!m.endsWith('.md'))){
  for(const f of readdirSync(join(dir,model)).filter(f=>f.endsWith('.json'))){
   const raw=JSON.parse(readFileSync(join(dir,model,f),'utf8'));const t=truths.get(raw.id);if(!t)continue;
   all.push(scoreDoc(t,{...raw,model}));
  }
 }
 const models=[...new Set(all.map(d=>d.model))].sort();
 const lines=[`# Lab reading eval: ${label}`,'',`Scored ${new Date().toISOString()} against ${truths.size} ground-truth documents, through the production schema, validateResult and checkIdentity.`,'','## All documents','',HEAD];
 for(const m of models)lines.push(row(m,aggregate(all.filter(d=>d.model===m))));
 for(const [title,f] of [['PDFs',(d:DocScore)=>d.kind==='pdf'],['Phone photos',(d:DocScore)=>d.kind==='photo'],['Armenian',(d:DocScore)=>d.lang==='hy'],['Russian',(d:DocScore)=>d.lang==='ru'],['English',(d:DocScore)=>d.lang==='en']] as const){
  lines.push('',`## ${title}`,'',HEAD);for(const m of models)lines.push(row(m,aggregate(all.filter(d=>d.model===m&&f(d)))));
 }
 lines.push('','## Per document (value right / expected; problems)','','| Doc | '+models.join(' | ')+' |','|---|'+models.map(()=>'---|').join(''));
 for(const id of [...new Set(all.map(d=>d.id))].sort()){
  const cell=(m:string)=>{const d=all.find(x=>x.id===id&&x.model===m);if(!d)return '–';if(!d.schemaOk)return '**schema fail**';
   const p=[...d.misses.slice(0,4),...d.invented.slice(0,2).map(x=>`INVENTED ${x}`),...d.forbiddenTaken.slice(0,2).map(x=>`DISTRACTOR ${x}`),...(d.dateConfusion?[`prev-as-current ×${d.dateConfusion}`]:[]),
    ...(!d.identityOk?[`identity ${d.identity}≠${d.identityExpected}`]:[]),...(!d.sampleDateOk?['sample date']:[]),...(d.emptyOk===false?['results not empty']:[])];
   return `${d.valueOk}/${d.expected}${p.length?' · '+p.join('; ').replace(/\|/g,'/'):''}`;};
  lines.push(`| ${id} | ${models.map(cell).join(' | ')} |`);
 }
 writeFileSync(join(dir,'_scores.json'),JSON.stringify(all,null,1));
 writeFileSync(opt('--md')??join(dir,'_scores.md'),lines.join('\n')+'\n');
 console.log(lines.slice(0,6+models.length).join('\n'));
}
