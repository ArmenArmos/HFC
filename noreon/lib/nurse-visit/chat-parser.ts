import type {Locale} from '@/lib/locale';
import type {NurseVisitItem,NurseVisitMarkCommand} from './schema';
import {collectionStatus} from './collection';
import {measurementRangeError,visitTestTitle,itemTitle} from './copy';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
export type ParsedVisitMeasurement={values:NurseVisitMarkCommand['values'];error:string|null};
/** Structured visit readings only. This parser never adds an item or interprets a clinical result. */
export function parseVisitMeasurement(item:NurseVisitItem,text:string,locale:Locale):ParsedVisitMeasurement{
 if(item.kind!=='measurement')return {values:null,error:null};
 const invalid=()=>({values:null,error:measurementRangeError(item.field,locale)});
 if(item.field==='bp'){
  const parts=text.trim().match(/^(\d+)\s*\/\s*(\d+)(?:\s+(\d+))?$/);if(!parts)return invalid();
  const systolic=Number(parts[1]),diastolic=Number(parts[2]),pulse=parts[3]===undefined?null:Number(parts[3]);
  if(!Number.isInteger(systolic)||!Number.isInteger(diastolic)||(pulse!==null&&!Number.isInteger(pulse))||systolic<60||systolic>300||diastolic<30||diastolic>200||systolic<=diastolic||(pulse!==null&&(pulse<20||pulse>250)))return invalid();
  return {values:{systolic,diastolic,pulse},error:null};
 }
 const number=text.trim().replace(',','.');
 const value=Number(number),[lo,hi]=item.field==='weight'?[20,400]:[30,250];
 if(number===''||!Number.isFinite(value)||value<lo||value>hi)return invalid();
 return {values:{value},error:null};
}

export type VisitShortcutDraft={
 confirmed?:boolean|null;
 arrived:boolean|null;
 measurements:Record<string,string>;
 notes?:Record<string,string>;
 replace?:string[];
 marks:{item:string;done:boolean|null;note:string}[];
 samples:{testId:string;status:'collected'|'not-collected'|'issue'|'pending';reason:string;needsReason?:boolean}[];
 collectionIssue?:'unresolved'|'conflicting';
 collectionException?:boolean;
 untouched:string[];
};
const normalized=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[.!։]+$/u,'').trim();
type Sample=Extract<NurseVisitItem,{kind:'sample'}>;
// Historical catalogue wording remains an alias after the catalogue title changes.
const lipidAliases=['Lipid panel','Լիպիդային վահանակ','Липидная панель'];
const catalogueAliases=(test:typeof TEST_CATALOGUE[number])=>[test.id,...Object.values(test.name),...[test.catalogueRef].flat()].filter((s):s is string=>typeof s==='string');
const sampleAliases=(item:Sample)=>[item.testId,item.title,...(['en','hy','ru'] as const).map(l=>visitTestTitle(item,l)),...TEST_CATALOGUE.filter(t=>t.id===item.testId).flatMap(catalogueAliases),...(item.testId.startsWith('hba1c')?['HbA1c']:[]),...(item.testId==='lipid-panel'||item.testId==='ldl-retest-lipid-panel'?lipidAliases:[])].map(normalized);
const visitTestAliases=(items:readonly NurseVisitItem[])=>[...lipidAliases,...TEST_CATALOGUE.filter(t=>t.method==='blood_draw'||t.method==='urine_sample').flatMap(catalogueAliases),...items.filter((i):i is Sample=>i.kind==='sample').flatMap(sampleAliases)].map(normalized);
/** Catalogue names and recorded aliases in any UI language, even when the test is not ordered. */
export function hasVisitTestName(items:readonly NurseVisitItem[],text:string){
 // Conservative substring matching also catches attached Armenian suffixes.
 const words=normalized(text);return visitTestAliases(items).some(alias=>words.includes(alias));
}
/** A bare test name is a list entry, not an explanation. */
export function isVisitTestName(items:readonly NurseVisitItem[],text:string){return visitTestAliases(items).includes(normalized(text));}
/** Advisory only. Free text can have unknown scope even when none of these words match. */
export function exceptionReasonNeedsCheck(items:readonly NurseVisitItem[],reason:string){
 return hasVisitTestName(items,reason)||/(?:^|[^\p{L}\p{N}])(?:not|no|unable|cannot|can't|couldn't|couldn’t|broken|broke|fail[\p{L}]*|lost|spill[\p{L}]*|не|нет|невозмож[\p{L}]*|нельзя|неуда[\p{L}]*|слома[\p{L}]*|разби[\p{L}]*|потер[\p{L}]*|проли[\p{L}]*|չ[\p{L}]*|կոտր[\p{L}]*|կորել[\p{L}]*|կորավ|թափ[\p{L}]*|անհնար[\p{L}]*|ձախող[\p{L}]*)(?=$|[^\p{L}\p{N}])/iu.test(reason);
}
const bulkWords='(?:all samples (?:taken|collected)|samples collected|(?:все )?(?:образцы|пробы) (?:взяты|собраны)|(?:բոլոր )?նմուշները (?:վերցված|հավաքված) են)';
const bulk=new RegExp(`^${bulkWords}$`,'iu');
const bulkPrefix=new RegExp(`^(${bulkWords})(?=\\s|:|[-–—])\\s*(.+)$`,'iu');
const exceptionQualifier=/(?:^|[^\p{L}\p{N}])(?:except|but|without|excluding|besides|other than|apart from|кроме|за исключением|без|но|исключая|բացի|բացառությամբ|առանց|բայց)(?=$|[^\p{L}\p{N}])/iu;
const qualifier=new RegExp(`${exceptionQualifier.source}|(?:^|[^\\p{L}\\p{N}])(?:not|не)(?=$|[^\\p{L}\\p{N}])|(?:^|[^\\p{L}\\p{N}])չ[\\p{L}]*`,'iu');
/** Only a complete list of uniquely matched names is an explicit exception. */
function exceptionTests(samples:readonly Sample[],text:string):string[]|null{
 let rest=normalized(text);const ids:string[]=[];
 while(rest){
  const matches=samples.flatMap(item=>sampleAliases(item).filter(alias=>rest===alias||rest.startsWith(`${alias} `)).map(alias=>({id:item.testId,alias}))).sort((a,b)=>b.alias.length-a.alias.length);
  const longest=matches[0];if(!longest||matches.some(m=>m.alias===longest.alias&&m.id!==longest.id)||ids.includes(longest.id))return null;
  ids.push(longest.id);rest=rest.slice(longest.alias.length).trim();
  if(!rest)return ids;
  const join=/^(?:and|и|և|եւ)\s+(.+)$/iu.exec(rest);if(!join)return null;rest=join[1];
 }
 return null;
}
/** Bounded clauses, never clinical interpretation. Unknown/ambiguous clauses remain visible and untouched.
 * The result is a local draft only: no action, RPC, model, default reading or invented visit item. */
export function parseVisitShortcut(items:readonly NurseVisitItem[],text:string,locale:Locale):VisitShortcutDraft{
 const draft:VisitShortcutDraft={arrived:null,measurements:{},marks:[],samples:[],untouched:[]};
 // Split sentence-ending bulk clauses without splitting decimal values or mmHg units.
 const sentences=text.replace(new RegExp(`[.!]\\s+(?=${bulkWords}(?:[.!։]|\\s|$))`,'giu'),'; ');
 const clauses=sentences.split(/,(?!\d)|[;\n։]|(?:\s*[-–—]\s*|\s+(?:(?:but|но|բայց)\s+)?)(?=(?:except|кроме|բացի)(?:\s|$))/iu).map(s=>s.trim()).filter(Boolean).flatMap(raw=>{
  // A bulk prefix never consumes an unknown suffix as part of its meaning.
  const prefix=!bulk.test(normalized(raw))?bulkPrefix.exec(raw):null;
  return prefix?[prefix[1],prefix[2]]:[raw];
 });
 // Keep only an immediately following pulse clause with its labelled or numeric BP.
 // Do not rewrite unrelated clauses or the nurse's exception reason.
 for(let index=1;index<clauses.length;index++){
  if(/^(?:pulse|пульс|զարկերակ)(?:\s|[:=])/iu.test(clauses[index])&&/^(?:(?:bp|blood pressure|ад|давление|ճնշում(?:ը)?)(?:\s|[:=])|\d+\s*\/)/iu.test(clauses[index-1])){
   clauses[index-1]+=', '+clauses[index];clauses.splice(index,1);index--;
  }
 }
 const samples=items.filter((i):i is Extract<NurseVisitItem,{kind:'sample'}>=>i.kind==='sample');
 let collection:{index:number;exceptions:string[]|null;next:number;reason:string}|null=null;
 const collectionClauses:string[]=[];
 const resolvedExceptions=new Set<number>();
 const seen=new Set<string>();
 const originals=new Map<string,string>();
 for(const [index,raw] of clauses.entries()){
  const clause=normalized(raw);
  const exception=/^(?:[-–—]\s*)?(?:(?:but|но|բայց)\s+)?(?:except|кроме|բացի)(?:\s+(.*))?$/iu.exec(clause);
  if(exception){
   const ids=exceptionTests(samples,exception[1]??'');
   if(!collection||collection.index!==index-1||collection.exceptions!==null||!ids){draft.collectionIssue??='unresolved';draft.untouched.push(raw);}
   else {collection.exceptions=ids;collection.next=index+1;resolvedExceptions.add(index);collectionClauses.push(raw);}
   continue;
  }
  if(/^(?:(?:i have |i )?arrived|(?:я )?(?:прибыла|прибыл|на месте)|(?:ես )?(?:ժամանել եմ|հասել եմ|եկել եմ))$/iu.test(clause)){draft.arrived=true;continue;}
  // A complete numeric BP uses the same bounded value parser as a labelled BP.
  const measurementClause=/^\d+\s*\//u.test(clause)?`BP ${clause}`:clause;
  const measure=/^(bp|blood pressure|ад|давление|ճնշում(?:ը)?|(?:body )?weight|вес|масса тела|(?:մարմնի )?քաշ(?:ը)?|waist(?: circumference)?|талия|обхват талии|գոտկատեղ(?:ը|ի շրջագիծ)?)\s*[:=]?\s*(.*)$/iu.exec(measurementClause);
  if(measure){
   const field=/^(bp|blood pressure|ад|давление|ճնշում(?:ը)?)$/iu.test(measure[1])?'bp':/^(?:body weight|weight|вес|масса тела|(?:մարմնի )?քաշ(?:ը)?)$/iu.test(measure[1])?'weight':'waist';
   const item=items.find(i=>i.kind==='measurement'&&i.field===field);
   // A typed compound update cannot replace an already saved item. Keep it visible,
   // outside the write draft, rather than leaving an invisible Confirm blocker.
   if(!item||item.mark){draft.untouched.push(raw);continue;}
   // Consume the entire value with only the units belonging to that field.
   const value=field==='bp'
    ?/^(\d+\s*\/\s*\d+)(?:\s*(?:mmhg|мм\s+рт\.\s*ст\.?|մմ\s+ս\.ս\.?))?(?:(?:\s*,\s*(?=(?:pulse|пульс|զարկերակ)(?:\s|[:=]))|\s+(?:(?:and|и|և|եւ)\s+(?=(?:pulse|пульс|զարկերակ)(?:\s|[:=])))?)(?:(?:pulse|пульс|զարկերակ)\s*[:=]?\s*)?(\d+)(?:\s*(?:bpm|уд\/мин|զարկ))?)?$/iu.exec(measure[2])
    :(field==='weight'?/^(\d+(?:[.,]\d+)?)\s*(?:kg|кг|կգ)?$/iu:/^(\d+(?:[.,]\d+)?)\s*(?:cm|см|սմ)?$/iu).exec(measure[2]);
   const words=value?`${value[1]}${field==='bp'&&value[2]?` ${value[2]}`:''}`:'';
   const parsed=value?parseVisitMeasurement(item,words,locale):{values:null,error:'invalid'};
   draft.measurements[item.key]=seen.has(item.key)||parsed.error?'':field==='bp'?words.trim().replace(/\s*\/\s*/u,'/').replace(/\s+/gu,' '):String(Number(words.replace(',','.')));
   if(seen.has(item.key)){
    const original=originals.get(item.key)!;
    if(!draft.untouched.includes(original))draft.untouched.push(original);
   }else originals.set(item.key,raw);
   if(seen.has(item.key)||parsed.error)draft.untouched.push(raw);
   seen.add(item.key);continue;
  }
  const all=bulk.test(clause);
  if(all){
   collectionClauses.push(raw);
   if(collection)draft.collectionIssue='conflicting';
   else collection={index,exceptions:null,next:-1,reason:''};
   continue;
  }
  const mark=/^(?:done|выполнено|արված է)\s*[:=]?\s+(.+)$/iu.exec(clause);
  const marked=mark?items.filter(i=>(i.kind==='check'||i.kind==='device')&&!i.mark&&normalized(itemTitle(i,locale))===normalized(mark[1])):[];
  if(marked.length===1){draft.marks.push({item:marked[0].key,done:true,note:''});continue;}
  // Only the clause immediately after an associated exception can supply its reason.
  // Recognised visit commands above keep their own meaning instead of becoming reasons.
  if(collection?.exceptions&&index===collection.next){
   const ids=exceptionTests(samples,raw.replace(/^(?:and|и|և|եւ)\s+/iu,''));
   if(ids&&!ids.some(id=>collection!.exceptions!.includes(id))){collection.exceptions.push(...ids);collection.next=index+1;resolvedExceptions.add(index);collectionClauses.push(raw);}
   // Keep the reason verbatim without inferring its scope. Other samples still need
   // the nurse's own choice. Bare test names and exception markers stay unresolved.
   else if(!isVisitTestName(items,raw)&&!exceptionQualifier.test(raw)){
    collection.reason=raw;collection.next=-1;resolvedExceptions.add(index);collectionClauses.push(raw);
   }else {draft.collectionIssue??='unresolved';draft.untouched.push(raw);}
  }else draft.untouched.push(raw);
 }
 if(collection){
  // Bulk collection requires a complete account of the whole message, not a growing
  // dictionary of exception phrasings. Names/qualifiers in other commands also block it.
  if(draft.untouched.length||clauses.some((raw,index)=>!resolvedExceptions.has(index)&&(hasVisitTestName(items,raw)||qualifier.test(raw))))draft.collectionIssue??='unresolved';
  const reason=collection.reason;
  if(draft.collectionIssue)draft.untouched.push(...collectionClauses);
  else {
   draft.collectionException=collection.exceptions!==null;
   draft.samples=samples.filter(i=>collectionStatus(i)==='pending').map(item=>{
    const excluded=collection!.exceptions?.includes(item.testId);
    return {testId:item.testId,status:excluded?(reason?'not-collected':'pending'):collection.exceptions?'pending':'collected',reason:excluded?reason:'',...(excluded&&!reason?{needsReason:true}:{})};
   });
  }
 }
 return draft;
}
