import {isNumberWord} from '@/lib/zoe/number-words';
import {normaliseText} from '@/lib/zoe/normalise';

/**
 * Spoken numbers to digits, for the voice intent parser only (hy, ru, en). Framework-free and deterministic: a run of
 * number words becomes one integer ("сто сорок пять" -> 145, «հարյուր քառասունհինգի» -> «145-ի», "one forty five" ->
 * 145), so lib/zoe/bp-parse.ts reads the same reading a member would have typed. Anything it cannot read stays a word, and
 * the caller treats an unread number word (isNumberWord) as ambiguous, never as a value.
 */
export const SPOKEN_NUMBERS_VERSION='voice-spoken-numbers-1';

type Kind='unit'|'teen'|'tens'|'hundred'|'zero';
type Word={value:number;kind:Kind};
const table=(entries:Record<string,number>,kind:Kind)=>Object.fromEntries(Object.entries(entries).map(([w,v])=>[w,{value:v,kind}]))as Record<string,Word>;

const EN:Record<string,Word>={
 ...table({zero:0},'zero'),
 ...table({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9},'unit'),
 ...table({ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19},'teen'),
 ...table({twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90},'tens'),
 ...table({hundred:100},'hundred'),
};
const RU:Record<string,Word>={
 ...table({'ноль':0},'zero'),
 ...table({'один':1,'одна':1,'одно':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,'шесть':6,'семь':7,'восемь':8,'девять':9},'unit'),
 ...table({'десять':10,'одиннадцать':11,'двенадцать':12,'тринадцать':13,'четырнадцать':14,'пятнадцать':15,'шестнадцать':16,'семнадцать':17,'восемнадцать':18,'девятнадцать':19},'teen'),
 ...table({'двадцать':20,'тридцать':30,'сорок':40,'пятьдесят':50,'шестьдесят':60,'семьдесят':70,'восемьдесят':80,'девяносто':90},'tens'),
 ...table({'сто':100,'двести':200,'триста':300},'hundred'),
};
const HY_UNITS:Record<string,number>={'մեկ':1,'երկու':2,'երկուս':2,'երեք':3,'չորս':4,'հինգ':5,'վեց':6,'յոթ':7,'յոթը':7,'ութ':8,'ութը':8,'ինը':9,'իննը':9,'ինն':9};
const HY_TENS:Record<string,number>={'քսան':20,'երեսուն':30,'քառասուն':40,'հիսուն':50,'վաթսուն':60,'յոթանասուն':70,'ութսուն':80,'իննսուն':90};
const HY:Record<string,Word>={
 ...table({'զրո':0},'zero'),
 ...table(HY_UNITS,'unit'),
 ...table({'տասը':10,'տաս':10,'տասն':10,'տասնմեկ':11,'տասներկու':12,'տասներեք':13,'տասնչորս':14,'տասնհինգ':15,'տասնվեց':16,'տասնյոթ':17,'տասնութ':18,'տասնինը':19,'տասնիննը':19},'teen'),
 ...table(HY_TENS,'tens'),
 ...table({'հարյուր':100},'hundred'),
};
/** Armenian case endings a number takes in a reading («145-ի 92», «ութին»): kept so the parser sees the same separator. */
const HY_SUFFIXES=['ից','ին','ի','ը']as const;

function hyWord(raw:string):{word:Word;suffix:string}|null{
 const direct=HY[raw];
 if(direct)return {word:direct,suffix:''};
 // Fused tens and unit («քառասունհինգ»), or a tens with a case ending («ութսունի»).
 for(const suffix of ['',...HY_SUFFIXES]){
  if(suffix&&!raw.endsWith(suffix))continue;
  const stem=suffix?raw.slice(0,-suffix.length):raw;
  if(!stem)continue;
  const plain=HY[stem];
  if(plain&&suffix)return {word:plain,suffix:suffix==='ը'?'':`-${suffix}`};
  for(const [tens,value] of Object.entries(HY_TENS)){
   if(!stem.startsWith(tens)||stem===tens)continue;
   const unit=HY_UNITS[stem.slice(tens.length)];
   if(unit!==undefined)return {word:{value:value+unit,kind:'tens'},suffix:suffix&&suffix!=='ը'?`-${suffix}`:''};
  }
 }
 return null;
}

function lookup(token:string):{word:Word;suffix:string;fusedUnit:boolean}|null{
 const en=EN[token]??RU[token];
 if(en)return {word:en,suffix:'',fusedUnit:false};
 const hy=hyWord(token);
 if(!hy)return null;
 // A fused Armenian tens+unit («քառասունհինգ») is complete: no unit may follow it in the same number.
 return {...hy,fusedUnit:hy.word.kind==='tens'&&hy.word.value%10!==0};
}

/** Whether a word continues the number being read. */
function accepts(state:{total:number;current:number;last:Kind|null;fused:boolean},next:Word,colloquial:boolean):boolean{
 const {last}=state;
 if(last===null)return true;
 if(next.kind==='zero')return false;
 if(next.kind==='hundred')return last==='unit'&&state.current<10&&state.total===0;
 if(last==='hundred')return true;
 if(last==='tens')return next.kind==='unit'&&!state.fused&&state.current%10===0;
 // "one forty five": a leading one or two followed by tens or teens is the colloquial hundreds.
 if(last==='unit'&&colloquial&&state.total===0&&state.current<=2&&(next.kind==='tens'||next.kind==='teen'))return true;
 return false;
}

/**
 * Replaces every run of spoken number words with its digits. The text is first normalised (lib/zoe/normalise.ts), so the
 * caller works on the same folded text the other guards read. Hyphenated English ("forty-five") is split; "and" inside
 * "one hundred and five" is consumed.
 */
export function digitsFromSpoken(input:string):string{
 const text=normaliseText(input).replace(/(?<=\p{L})-(?=\p{L})/gu,' ');
 const parts=text.split(/(\s+)/u);
 const out:string[]=[];
 type Run={total:number;current:number;last:Kind|null;fused:boolean;suffix:string};
 let run:Run|null=null,gap='';
 const flush=()=>{
  if(run)out.push(String(run.total+run.current)+run.suffix);
  run=null;
  if(gap)out.push(gap);
  gap='';
 };
 for(const part of parts){
  if(part==='')continue;
  if(/^\s+$/u.test(part)){if(run)gap=part;else out.push(part);continue;}
  // Trailing punctuation stays; the word is read without it.
  const match=/^(.*?)([.,;:!?»”"')]*)$/u.exec(part)!;
  const token=match[1]!,tail=match[2]!;
  if(run&&(token==='and'||token==='и')&&run.last==='hundred'&&!tail)continue;
  const found=token?lookup(token):null;
  if(!found){flush();out.push(part);continue;}
  if(run&&(run.suffix||!accepts(run,found.word,EN[token]!==undefined)))flush();
  gap='';
  const r:Run=run??{total:0,current:0,last:null,fused:false,suffix:''};
  run=r;
  const w=found.word;
  if(w.kind==='hundred'){r.total+=(r.current||1)*w.value;r.current=0;}
  else if(r.last==='unit'&&(w.kind==='tens'||w.kind==='teen')&&r.total===0&&r.current<=2){r.total=r.current*100;r.current=w.value;}
  else r.current+=w.value;
  r.last=w.kind;r.fused=found.fusedUnit;
  if(found.suffix)r.suffix=found.suffix;
  if(tail){flush();out.push(tail);}
 }
 flush();
 return out.join('').replace(/[ \t]+/gu,' ').trim();
}

/** A number word the reader could not turn into digits: the utterance stays ambiguous, never a value. */
export const leftoverNumberWords=(digits:string)=>digits.split(/[^\p{L}]+/u).filter(word=>word&&isNumberWord(word));
