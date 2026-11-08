import {bpCheckReadings,bpQuietNote,bpVeryHigh,BP_REPEAT,type BpEarlier,type BpNumbers,type BpStep} from '@/lib/clinical/rules/bp-check';
import {bpRemeasureLine,bpSoonLine,bpTodayLine,type BpLang} from '@/lib/clinical/rules/bp-words';
import {BATCH_CORRECTION,bpFirstPerson,bpReadings,currentBpClauses} from './bp-parse';
import {ownBpReadings} from './health-answer';
import {normaliseText} from './normalise';
import {asserted,type LatestReading} from './symptoms/red-flags';

/**
 * The one BP check (lib/clinical/rules/bp-check.ts) on a chat or Telegram turn: what the member typed, against what they typed
 * or saved before. Numbers and earlier words only: a symptom in the same message has already taken the 103 route.
 */
type Said={text:string;minutesAgo:number;seq?:number};
type Told={body:string;minutesAgo:number};
/** quietNote: this turn's forward is the doctor's note that a repeat is pending; once per first reading. */
/** A typed very high reading to save as the member's own (zoe_run_bp_typed_save), oldest first. latest: the one this turn answers. */
export type BpTypedSave={seq:number;index:number;systolic:number;diastolic:number;latest:boolean};
export type BpChatTurn={step:BpStep;reading:BpNumbers;source:'typed'|'saved';quietNote:boolean;saves?:BpTypedSave[]};
const LANGS:readonly BpLang[]=['en','hy','ru'];

/** The member's own readings now, clause by clause: "yesterday 150/90, today 185/115" keeps the second. */
function currentReadings(text:string){
 return text.split(/(?<=[.!?։՞？])\s+|\n+/u).flatMap(sentence=>ownBpReadings([currentBpClauses(sentence,true)+(/[?՞？]/u.test(sentence)?'?':'')]));
}
/** A very high pair in these messages is only history, a quotation, or someone else's while the member speaks of themself: no RF-03 from it. */
export function bpCrisisNotCurrent(texts:readonly string[]){
 const others=bpFirstPerson(texts.join(' '));
 return !texts.some(t=>t.split(/(?<=[.!?։՞？])\s+|\n+/u).some(sentence=>bpReadings(normaliseText(currentBpClauses(sentence,others))).some(bpVeryHigh)));
}
type Typed=BpEarlier&{seq?:number;index:number;text:string};
function typedReadings(messages:readonly Said[]):Typed[]{
 return messages.flatMap(m=>currentReadings(m.text).map((r,index)=>({...r,minutesAgo:m.minutesAgo,seq:m.seq,index,text:m.text})));
}
/**
 * Only a plain statement of the member's own reading, now, goes on their record. The reading parser is good enough to answer a
 * member ("measure again") but not to write their chart: another person, a past day or year, or "was" is not saved. The reply
 * still asks for the repeat and the doctor still gets Zoe's summary; nothing is claimed as saved.
 */
const NOT_OWN_NOW_WORDS=['she','he','her','his','him','they','them','their','mother','mom','mum','mama','father','dad','papa','wife','husband','son','daughter',
 'grandmother','grandfather','grandma','grandpa','sister','brother','uncle','aunt','friend','neighbour','neighbor','colleague','patient','ago','yesterday','last','was','were',
 'она','он','его','её','ее','они','их','вчера','назад','был','была','было','были','прошлый','прошлой','прошлом','прошлую',
 'նա','իր','նրա','երեկ','առաջ','էր','էին','անցյալ'];
const NOT_OWN_NOW_STEMS=['grand','мам','мат','пап','отец','отца','жен','муж','сын','дочь','бабушк','дедушк','подруг','друг','сосед','пациент','прошл','раньше',
 'մայր','մայրիկ','հայր','հայրիկ','կին','ամուսին','որդի','դուստր','տատիկ','պապիկ','ընկեր','հիվանդ','նախկին'];
const NOT_OWN_NOW=new RegExp(`(?<![\\p{L}\\p{N}])(?:${NOT_OWN_NOW_WORDS.join('|')})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:${NOT_OWN_NOW_STEMS.join('|')})|(?<![\\d])(?:19|20)\\d\\d(?!\\d)`,'iu');
// A reading goes on the record only when the member says it is theirs (my, I, mine) or sends nothing but the reading and its
// plain words: no "sister", no date, no guess. Anything else is answered but not saved, and nothing is claimed.
const WEEKDAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday','понедельник','вторник','сред','четверг','пятниц','суббот','воскресень','երկուշաբթի','երեքշաբթի','չորեքշաբթի','հինգշաբթի','ուրբաթ','շաբաթ','կիրակի'];
const DATED=new RegExp(`(?<![\\p{L}\\p{N}])(?:${WEEKDAYS.join('|')})|\\b\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\b`,'iu');
const FIRST_PERSON=/(?<![\p{L}\p{N}])(?:my\s+(?:blood\s+pressure|bp|pressure|reading|numbers?)|i\s+(?:measured|got|have|am|just)|mine|(?:моё|мое|мой|мои)\s+(?:давление|ад|показател|цифры)|у\s+меня|я\s+(?:измерил[аи]?|получил[аи]?)|իմ\s+(?:ճնշում|չափում|ցուցանիշ)|ճնշումս(?![\p{L}])|ես\s+(?:չափեցի|ունեմ))/iu;
const PLAIN_WORDS=new Set(['bp','blood','pressure','mmhg','mm','hg','is','are','it','its','it\'s','now','just','today','over','давление','ад','мм','рт','ст','сейчас','сегодня','на','ճնշում','ճնշումը','հիմա','այսօր','է']);
const onlyTheReading=(text:string)=>text.toLowerCase().replace(/[\d/.,:;\-–—()!?։՞]+/gu,' ').split(/\s+/u).filter(Boolean).every(w=>PLAIN_WORDS.has(w));
export const ownReadingNow=(text:string)=>!NOT_OWN_NOW.test(text)&&!DATED.test(text)&&(FIRST_PERSON.test(text)||onlyTheReading(text));
const typedSaves=(typed:Typed[]):BpTypedSave[]=>typed.filter(r=>r.seq!==undefined&&bpVeryHigh(r)&&ownReadingNow(r.text))
 .map(r=>({seq:r.seq!,index:r.index,systolic:r.systolic,diastolic:r.diastolic,latest:r===typed.at(-1)}));
/** Observation eligibility is identical on urgent exits and the ordinary BP reply path. */
export const bpTypedSaves=(messages:readonly Said[]):BpTypedSave[]=>typedSaves(typedReadings(messages));
/**
 * unanswered: the messages Zoe has not answered, newest last. earlier: the ones she has. stored: the latest saved reading. told: her
 * answers. openAlert: an alert is open, so a saved repeat has already gone to the doctor. Null: nothing for this check to say.
 */
export function bpChatTurn(i:{unanswered:readonly Said[];earlier:readonly Said[];stored:LatestReading|undefined;told:readonly Told[];openAlert:boolean;storedSinceMinutes?:number}):BpChatTurn|null{
 const typed=typedReadings(i.unanswered),last=typed.at(-1);
 if(last){
  const before=[...typedReadings(i.earlier),...typed.slice(0,-1),...(i.stored?[i.stored]:[])].map(r=>({...r,minutesAgo:r.minutesAgo-last.minutesAgo}));
  const step=bpCheckReadings(last,before);
  const reading={systolic:last.systolic,diastolic:last.diastolic};
  const saves=typedSaves(typed);
  return step==='routine'?null:{step,reading,source:'typed',saves,quietNote:bpQuietNote(reading,step)&&!before.some(r=>bpVeryHigh(r)&&r.minutesAgo>=0&&r.minutesAgo<=BP_REPEAT.withinMinutes)};
 }
 // A saved reading nobody has repeated: asked once per reading, in place of the same-day warning that came before a repeat.
 const s=i.stored;
 if(!s||i.openAlert||s.minutesAgo<0||s.minutesAgo>24*60||!bpVeryHigh(s))return null;
 const reading={systolic:s.systolic,diastolic:s.diastolic};
 // Only a prompt after this save counts. Equal-minute or unknown ordering cannot spend a new reading.
 const since=i.storedSinceMinutes??s.minutesAgo;
 if(i.told.some(a=>a.minutesAgo<since&&LANGS.some(l=>a.body.includes(bpRemeasureLine(l,reading)))))return null;
 // The save's trigger left the note for a saved reading.
 return {step:'remeasure',reading,source:'saved',quietNote:false};
}

/**
 * The newest current reading of the member's, typed or saved, if it is very high. A typed one counts inside the repeat window, a
 * saved one for a day. Null when a calmer one has come since, or a later message takes it back in words. What a symptom told now counts with.
 */
export function bpCurrentVeryHigh(messages:readonly Said[],stored:LatestReading|undefined):LatestReading{
 const typed=typedReadings(messages).filter(x=>x.minutesAgo<=BP_REPEAT.withinMinutes).at(-1);
 const saved=stored&&stored.minutesAgo>=0&&stored.minutesAgo<=24*60?stored:null;
 const newest=typed&&(!saved||typed.minutesAgo<=saved.minutesAgo)?typed:saved;
 if(!newest||!bpVeryHigh(newest))return null;
 return messages.some(m=>m.minutesAgo<newest.minutesAgo&&BATCH_CORRECTION.test(normaliseText(m.text)))?null:{systolic:newest.systolic,diastolic:newest.diastolic,minutesAgo:newest.minutesAgo};
}
/** Zoe gave the level for a repeat in this conversation, inside the repeat window: it stands until something new comes. */
export const bpLevelGiven=(told:readonly {body:string;minutesAgo:number}[])=>told.some(a=>a.minutesAgo<=BP_REPEAT.withinMinutes&&LANGS.some(l=>a.body.includes(bpSoonLine(l,true))||a.body.includes(bpTodayLine(l,true))));
/** Zoe has asked for a repeat of this reading and it has not come: the reply is not a place to warn about it again. */
export function bpAwaitingRepeat(messages:readonly Said[],stored:LatestReading|undefined,told:readonly Told[],storedSinceMinutes=stored?.minutesAgo??Infinity):boolean{
 const r=bpCurrentVeryHigh(messages,stored);
 const since=r===stored?storedSinceMinutes:r?.minutesAgo??-Infinity;
 return !!r&&told.some(a=>a.minutesAgo<since&&LANGS.some(l=>a.body.includes(bpRemeasureLine(l,r))));
}

// The rule's four symptoms, in English, Armenian, Latin-letter Armenian and Russian. Only these (the stored-reading rule takes any
// sheet): "a cough" after a typed reading must not open 103. asserted() handles the denials.
const BP_SYMPTOM=new RegExp([
 /headache|head (?:hurts|is pounding|aches)|(?:blurr\w*|double|changed|worse|losing my|lost my|can'?t see|spots?).{0,14}(?:vision|sight|eyes?)|(?:vision|sight).{0,14}(?:blurr\w*|double|worse|changed|gone|going|dim)|blurry|seeing spots|chest (?:pain|hurts|pressure|tight\w*)|pain in (?:my|the) chest|weak(?:ness)?(?![a-z])/.source,
 /գլխացավ\p{L}*|գլուխս (?:ցավ|պտտ)\p{L}*|տեսողությ\p{L}*|աչքերս (?:մթն|պղտոր|սևան)\p{L}*|վատ եմ տեսնում|մշուշ\p{L}*|կրծքավանդակ\p{L}* ցավ\p{L}*|կրծք\p{L}* ցավ\p{L}*|կրծքիս ցավ\p{L}*|թուլություն\p{L}*|թուլացել\p{L}*|թուլանում\p{L}*/u.source,
 /gl(?:x|kh)a(?:c|ts)av\w*|gluxs? cav\w*|glukhs? cav\w*|tesoxutyun\w*|tesoghutyun\w*|achqers mt\w*|krcq\w* cav\w*|krtq\w* cav\w*|tulutyun\w*|tulacel\w*/.source,
 /головн\p{L}* бол\p{L}*|голова болит|болит голова|зрени\p{L}*|в глазах|двоится|плохо вижу|пелен\p{L}*|бол\p{L}* в груди|грудь болит|давит в груди|слабост\p{L}*|ослаб\p{L}*/u.source,
].join('|'),'iu');
/** The member says they have one of the rule's symptoms now. */
export const bpSymptomAsserted=(raw:string)=>asserted(normaliseText(raw).replaceAll('’',"'"),BP_SYMPTOM);
