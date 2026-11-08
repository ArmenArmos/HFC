import {normaliseText} from './normalise';

/**
 * Key symptom words and their typos (the 103 safety net, urgent-check.ts; Armen 20 Oct). Used by routing.ts (a symptom word
 * never goes to the low tier) and by the pipeline (an unclear word gets one clarifying question). No other Zoe imports, so
 * routing stays free of cycles.
 */
export type SymptomMeaning='toothache'|'fever'|'nausea'|'palpitations'|'heart_pain'|'chest_pain'|'headache'|'dizziness'|'breathless'|'vomiting'|'fainting'|'weakness'|'stomach_ache';
// Key symptom words as members write them (HY, HY in Latin letters, RU, EN). Engineering patterns for spelling, not
// clinical content: what each word means clinically is decided where it was (red flags, lists, the model).
const KEYS:readonly {word:string;meaning:SymptomMeaning}[]=Object.freeze([
 ['սրտխառնոց','nausea'],['սրտխառնուք','nausea'],['սրտխփոց','palpitations'],['սրտաբաբախյուն','palpitations'],['սրտացավ','heart_pain'],['կրծքացավ','chest_pain'],
 ['գլխացավ','headache'],['գլխապտույտ','dizziness'],['շնչահեղձություն','breathless'],['հևոց','breathless'],['փսխում','vomiting'],['ուշագնացություն','fainting'],
 ['թուլություն','weakness'],['փորացավ','stomach_ache'],['ատամնացավ','toothache'],
 ['srtkharnots','nausea'],['srtxarnoc','nausea'],['srtkhpots','palpitations'],['srtxpoc','palpitations'],['glxacav','headache'],['glkhatsav','headache'],['glxaptuyt','dizziness'],['glkhaptuyt','dizziness'],
 ['тошнота','nausea'],['тошнит','nausea'],['сердцебиение','palpitations'],['головокружение','dizziness'],['одышка','breathless'],['слабость','weakness'],['обморок','fainting'],
 ['nausea','nausea'],['toothache','toothache'],['зубная','toothache'],['fever','fever'],['breathe','breathless'],['breathing','breathless'],['temperature','fever'],['ջերմություն','fever'],['температура','fever'],['jermutyun','fever'],['nauseous','nausea'],['palpitations','palpitations'],['dizziness','dizziness'],['headache','headache'],['vomiting','vomiting'],['breathless','breathless'],['fainting','fainting'],
].map(([word,meaning])=>({word:word!,meaning:meaning as SymptomMeaning})));

function distance(a:string,b:string){
 const x=[...a],y=[...b];let prev=Array.from({length:y.length+1},(_,j)=>j);
 for(let i=1;i<=x.length;i++){const cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(prev[j]!+1,cur[j-1]!+1,prev[j-1]!+(x[i-1]===y[j-1]?0:1));prev=cur;}
 return prev[y.length]!;
}
// A word written correctly, with an ending (սրտխառնոցս, тошноту): the key without its last letter (two for long words) starts it.
const stem=(w:string)=>{const c=[...w];return c.slice(0,c.length-(c.length>=8?2:1)).join('');};
// Typos keep the first letter; the longer the key word, the more slips it may carry («սրտխոնց» is three from սրտխառնոց).
const allowed=(key:string)=>{const n=[...key].length;return n>=9?3:n>=7?2:n>=5?1:0;};
// Ordinary words that sit close to a key word.
const NOT_SYMPTOMS=new Set(['սրտանց','սրտանցի','գլխավոր','գլխավորը','գլխավորն','գլխավորապես','glxavor','главное','главный']);
const NOT_SYMPTOM_STEMS=['ստաց','սրտաբան'];
const words=(raw:string)=>new Set((normaliseText(raw).match(/[\p{L}]{5,24}/gu)??[]).filter(w=>!NOT_SYMPTOMS.has(w)&&!NOT_SYMPTOM_STEMS.some(p=>w.startsWith(p))));
function fuzzyMeanings(word:string){
 const chars=[...word],meanings=new Set<SymptomMeaning>();
 for(const k of KEYS){
  const n=[...k.word].length,max=allowed(k.word);
  if(!max||chars.length<n-max)continue;
  // A dropped first letter («eadache», "omiting"; Astra Z103-03): the key without it, written exactly (with any ending).
  if(chars[0]!==[...k.word][0]){if(n>=7&&word.startsWith(stem(k.word.slice([...k.word][0]!.length))))meanings.add(k.meaning);continue;}
  // The word may carry an ending: compare the key with the word's first n-max .. n+max letters, keeping the closest.
  let best=Infinity;for(let m=Math.max(1,n-max);m<=Math.min(chars.length,n+max);m++)best=Math.min(best,distance(chars.slice(0,m).join(''),k.word));
  if(best<=max)meanings.add(k.meaning);
 }
 return meanings;
}

export type SymptomTypo={word:string;meanings:SymptomMeaning[]};
/** The misspelt key symptom words in a message, each with what it may mean (one meaning: a plain typo; two or more: unclear). */
export function symptomTypos(raw:string):SymptomTypo[]{
 const out:SymptomTypo[]=[];
 for(const word of words(raw)){
  if(KEYS.some(k=>word.startsWith(stem(k.word))))continue;
  const meanings=fuzzyMeanings(word);
  if(meanings.size)out.push({word,meanings:[...meanings]});
 }
 return out;
}
/** Whether the message names a key symptom word, spelt right (with any ending) or with typos (routing.ts: never the light tier). */
export const mentionsSymptomWord=(raw:string)=>[...words(raw)].some(w=>KEYS.some(k=>w.startsWith(stem(k.word)))||fuzzyMeanings(w).size>0);
/** The first key symptom word in the message that could mean two different things (Armen's «սրտխոնց»: nausea or the heart). */
export const unclearSymptom=(raw:string)=>symptomTypos(raw).find(t=>t.meanings.length>=2)??null;

/** Every key symptom meaning the message names, spelt right or with typos (the subjects of a message, urgent-check.ts). */
export const symptomMeanings=(raw:string)=>new Set([...words(raw)].flatMap(w=>[...KEYS.filter(k=>w.startsWith(stem(k.word))).map(k=>k.meaning),...fuzzyMeanings(w)]));
