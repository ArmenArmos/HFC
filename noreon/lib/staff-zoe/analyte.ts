import {LAB_ANALYTES} from '@/lib/lab-ai/catalogue';
import type {Fact} from './contracts';

/**
 * Which lab value a question or a fact is about. When a question names one, the answer may hold only facts of that identity,
 * and a name with no such fact reads as not known (Astra, 30 Oct: a creatinine line was accepted for a potassium question).
 * The lab catalogue's aliases, plus staff words and qualified names it lacks, so "direct bilirubin" is not total bilirubin.
 * A question naming no known value is held to the same rule: lab facts need a general lab or summary question, and a name
 * this list does not know ("troponin") reads as not known rather than taking whatever fact was chosen.
 */
export const EXTRA:readonly {key:string;aliases:string[]}[]=[
 {key:'potassium',aliases:['potassium','կալիում','калий']},{key:'sodium',aliases:['sodium','նատրիում','натрий']},
 {key:'calcium',aliases:['calcium','կալցիում','кальций']},{key:'magnesium',aliases:['magnesium','մագնեզիում','магний']},
 {key:'ldl_c',aliases:['ցխլ','лпнп']},{key:'ck',aliases:['ck','creatine kinase','cpk','креатинкиназа','кфк','կրեատինկինազ']},{key:'ck_mb',aliases:['ck-mb','ck mb','ckmb','кфк-мб','кк-мб']},
 {key:'bilirubin_direct',aliases:['direct bilirubin','conjugated bilirubin','ուղղակի բիլիռուբին','прямой билирубин','билирубин прямой']},
 {key:'bilirubin_indirect',aliases:['indirect bilirubin','unconjugated bilirubin','անուղղակի բիլիռուբին','непрямой билирубин','билирубин непрямой']},
 {key:'urine_creatinine',aliases:['urine creatinine','urinary creatinine','креатинин мочи']},
 {key:'urine_glucose',aliases:['urine glucose','urinary glucose','глюкоза мочи']},
 {key:'free_t3',aliases:['free t3','ft3','ազատ t3','свободный т3','т3 свободный']},
];
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
/** Armenian and Russian endings change each word of a name: its stem takes up to three more letters. Short words stay exact. */
function word(w:string,phrase:boolean){
 if(/\p{Script=Armenian}/u.test(w)&&[...w].length>=4)return `${esc(w)}\\p{L}{0,3}`;
 if(/\p{Script=Cyrillic}/u.test(w)&&[...w].length>=5)return `${esc(w.replace(phrase?/(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|[йаяоеиыь])$/u:/[йаяоеиыь]$/u,''))}\\p{L}{0,3}`;
 return esc(w);
}
const pattern=(alias:string)=>alias.split(' ').map((w,_i,all)=>word(w,all.length>1)).join('\\s+');
const TERMS=[...LAB_ANALYTES.flatMap(a=>a.aliases.map(alias=>({alias,key:a.key}))),...EXTRA.flatMap(a=>a.aliases.map(alias=>({alias,key:a.key})))]
 .sort((a,b)=>b.alias.length-a.alias.length)
 .map(t=>({key:t.key,re:new RegExp(`(?<![\\p{L}\\p{N}-])(?:${pattern(t.alias)})(?![\\p{L}\\p{N}])`,'giu')}));

/** Longest name first, and a matched name is used up: "LDL cholesterol" is LDL, not LDL and cholesterol. */
export function namedAnalytes(text:string):string[]{
 let t=text.normalize('NFC').toLowerCase();const out=new Set<string>();
 for(const {key,re} of TERMS)t=t.replace(re,()=>{out.add(key);return ' ';});
 return [...out];
}
/** A short name for a line of the app. */
export function analyteName(key:string){const n=LAB_ANALYTES.find(a=>a.key===key)?.label??EXTRA.find(a=>a.key===key)?.aliases[0]??key;return n.length<=4?n.toUpperCase():n;}
export const analyteOf=(name:string)=>namedAnalytes(name)[0]??null;

/** Words of a general lab question. Anything else left in the question may be a name this list does not know. */
const GENERAL=/(?<![\p{L}\p{N}])(?:any|all|abnormal|flagged|reviewed|unreviewed|out of range|not|latest|last|recent|new|show|me|the|her|his|their|this|member|lab|labs|laboratory|result|results|test|tests|blood|work|what|which|are|is|were|has|have|been|there|of|on|for|please|did|come|back|все|всё|последн\p{L}*|новые|свежие|покажи|анализ\p{L}*|результат\p{L}*|какие|какой|есть|ли|его|её|ее|отклонени\p{L}*|проверенн\p{L}*|վերջին|բոլոր|ցույց|տուր|լաբորատոր\p{L}*|արդյունք\p{L}*|անալիզ\p{L}*|նրա|ինչ|կա՞|կա|որոնք|ի՞նչ|թեստ\p{L}*)(?![\p{L}\p{N}])/giu;
export const generalLabQuestion=(text:string)=>/\p{L}/u.test(text)&&!text.normalize('NFC').toLowerCase().replace(GENERAL,' ').replace(/[^\p{L}\p{N}]+/gu,'').length;

export type LabScope={named:readonly string[];
 /** A summary or a general lab question: any lab fact may answer it. */general:boolean;
 /** The question is about the LDL record: its facts may answer it. */ldl:boolean};
/** The chosen facts this question may show, and what stays unanswered. A fact that is no lab value is free unless a value was named. */
export function guardAnalytes(facts:readonly Fact[],scope:LabScope){
 if(scope.general&&!scope.named.length)return {facts:[...facts],dropped:[],unanswered:[]};
 if(scope.named.length){
  const kept=facts.filter(f=>f.analyte!==null&&scope.named.includes(f.analyte));
  return {facts:kept,dropped:facts.filter(f=>!kept.includes(f)).map(f=>f.id),unanswered:scope.named.filter(n=>!kept.some(f=>f.analyte===n))};
 }
 const kept=facts.filter(f=>f.analyte===null||(scope.ldl&&f.analyte==='ldl_c'));
 const dropped=facts.filter(f=>!kept.includes(f)).map(f=>f.id);
 return {facts:kept,dropped,unanswered:dropped.length?['unrecognised']:[]};
}
