import type {Answer,AnswerContent,Fact,Quote,ToolResult} from './contracts';

/**
 * The code check on every answer (risk R1, FABLE_PLAN §5). The model returns ids, so a line can only be a fact's own label
 * and value. This check proves it at the last moment, on what is about to be stored and shown: every line is word for word a
 * fact read in this turn, and every number in it, each reading pair included, is in the structured tool output.
 * The member's words are not in that set: they reach the screen only as a verbatim quote, labelled as theirs, so a number in a
 * member message can never validate a line. A date's parts are not numbers either: a day cannot license a dose.
 */
export const CHECK_VERSION='staff-zoe-check-3';
export type CheckProblem={code:'unknown_fact'|'unknown_quote'|'not_from_fact'|'unverified_number'|'unverified_pair';detail:string};
export type CheckResult={ok:boolean;problems:CheckProblem[];lines:number;numbers:number};

const digits=(s:string)=>s.replace(/\p{Nd}/gu,c=>{const v=c.codePointAt(0)!;for(const z of [0x30,0x660,0x6f0,0x966,0xff10])if(v>=z&&v<z+10)return String(v-z);return c;});
/** One spelling for one value: 4,5 and 4.50 are 4.5. */
export const canon=(n:string)=>{const v=Number(n.replace(',','.'));return Number.isFinite(v)?String(v):n;};
const PAIR=/(?<![\p{N}.,/])(\d{2,3})\s*\/\s*(\d{2,3})(?![\p{N}/])/gu;
const NUMBER=/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{N}])|(?<=[\p{L}])\d+(?:[.,]\d+)?(?![\p{N}])/gu;

export const factLine=(f:Pick<Fact,'label'|'value'>)=>`${f.label}: ${f.value}`;
function numbersOf(text:string){
 const t=digits(text),pairs=new Set<string>(),numbers=new Set<string>();
 for(const m of t.matchAll(PAIR))pairs.add(`${m[1]}/${m[2]}`);
 for(const m of t.replace(PAIR,' ').matchAll(NUMBER))numbers.add(canon(m[0]));
 return {pairs,numbers};
}

/** Facts and quotes of one turn, by id. Member text is deliberately in its own map. */
export function turnIndex(results:readonly ToolResult[]){
 return {facts:new Map<string,Fact>(results.flatMap(r=>r.facts.map(f=>[f.id,f]as const))),quotes:new Map<string,Quote>(results.flatMap(r=>r.quotes.map(q=>[q.id,q]as const)))};
}
export function checkSelection(a:Answer,index:ReturnType<typeof turnIndex>):CheckProblem[]{
 return [...a.facts.filter(id=>!index.facts.has(id)).map(id=>({code:'unknown_fact'as const,detail:id})),...a.quotes.filter(id=>!index.quotes.has(id)).map(id=>({code:'unknown_quote'as const,detail:id}))];
}
/** The rendered answer against the tool output. A failure here is a bug or tampering: the words are then not shown. */
export function checkRendered(say:AnswerContent['say'],results:readonly ToolResult[]):CheckResult{
 const problems:CheckProblem[]=[];let numbers=0;
 const facts=results.flatMap(r=>r.facts);
 const allowed=numbersOf(facts.map(factLine).join('\n'));
 const lines=new Set(facts.map(factLine));
 for(const l of say){
  if(!lines.has(l.text)||!l.facts.length)problems.push({code:'not_from_fact',detail:l.text.slice(0,60)});
  const n=numbersOf(l.text);
  for(const p of n.pairs){numbers++;if(!allowed.pairs.has(p))problems.push({code:'unverified_pair',detail:p});}
  for(const v of n.numbers){numbers++;if(!allowed.numbers.has(v))problems.push({code:'unverified_number',detail:v});}
 }
 return {ok:problems.length===0,problems,lines:say.length,numbers};
}
