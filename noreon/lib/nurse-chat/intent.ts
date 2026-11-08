/** Plain words that mean "show me my work" or "find a member", for the nurse chat. Bounded phrase rules, no model:
 * a message that does not match whole stays an ordinary question for Zoe. Used only outside an open conversation
 * and outside the switch to Zoe, so words typed for a member or for Zoe about a member are never taken for a command. */
export type NurseIntent=
 |{kind:'today'}
 |{kind:'priority'}
 |{kind:'tasks';filter:'active'}
 |{kind:'visits'}
 |{kind:'missing-bp'}
 |{kind:'adherence'}
 |{kind:'handoffs'}
 |{kind:'worklist'}
 |{kind:'find';query:string};

const clean=(raw:string)=>raw.normalize('NFKC').toLocaleLowerCase().replace(/[’`]/gu,"'")
 .replace(/^(?:zoe|զոյա|зоя|зоуи)[\s,:]+/u,'').replace(/[\u055b\u055c\u055e]/gu,'').replace(/[?!.։,;:()"«»]+/gu,' ').replace(/\s+/gu,' ').trim();

/** "Who needs me first": the day's list is the answer (urgent alerts, then due work); Zoe reads one member's record, not the nurse's day.
 * A command even in Zoe mode, unlike plain "today", because it can never be a question about the open member. */
const PRIORITY:RegExp[]=[
 /^(?:who|which member) (?:needs (?:me|my attention)|is waiting for me|should i (?:see|call|check|visit)|do i (?:see|call|visit))(?: first| now| most| today| this morning| next| urgently)*$/u,
 /^(?:к кому (?:мне )?(?:идти|пойти|ехать|поехать)|кто (?:меня )?(?:ждёт|ждет|нуждается во мне)|кому я (?:нужна|нужен))(?: первым| первой| сначала| сейчас| сегодня)*$/u,
];
const TODAY:RegExp[]=[
 /^(?:good morning )?(?:(?:what(?:'s| is| s)?|whats) (?:do i have|have i got|is on|is up|on|up)(?: for me| my plate)?|(?:what(?:'s| is| s)?|whats) urgent|anything urgent|urgent(?: first| ones| stuff)?|my day|(?:show|open|see)(?: me)?(?: my)? (?:day|today)|today|my tasks today)(?: today| now| this morning)?$/u,
 /^(?:что (?:у меня )?(?:на )?сегодня|что у меня|что сегодня|что срочн(?:ое|о|ого)(?: сегодня| с утра| сейчас)?|что горит|мой день|сегодня|покажи (?:мой )?(?:день|сегодня)|с чего начать|что мне делать сегодня|срочное)$/u,
 /^(?:բարի լույս )?(?:(?:այսօր|էսօր) )?(?:ինչ ունեմ|ինչ կա)(?: (?:էսօր|այսօր|առաջինը|շտապները|շտապ|ցույց|տուր|ինձ))*$/u,
 /^(?:այսօր|էսօր|շտապները(?: ցույց տուր)?|ինչ շտապ ունեմ|ցույց տուր (?:շտապները|այսօր))$/u,
];
const MISSING_BP:RegExp[]=[
 /^(?:who|which (?:members|patients)|list (?:the )?members who) (?:hasn't|has not|haven't|have not|didn't|did not|hasnt|havent|didnt|hasn't yet) (?:logged|recorded|measured|entered|sent|submitted|taken)(?: any| their| a)? (?:bp|blood pressure)(?: readings?)?(?: this week| today| yet| so far)?$/u,
 /^(?:who has no|which members have no|members without|who is missing)(?: a| any)? (?:bp|blood pressure)(?: readings?| log| values?)?(?: this week| yet| so far)?$/u,
 /^кто (?:не (?:записал|записала|измерил|измерила|внёс|внес|передал|передала|вносил|вносила)|ещё не (?:записал|измерил|внёс)) (?:давление|ад|показания давления)(?: на этой неделе| за неделю| на неделе| эту неделю)?$/u,
 /^(?:у кого нет|у кого не записано) (?:давления|ад|измерений давления)(?: за неделю| на этой неделе| эту неделю)?$/u,
 /^ով չի (?:գրանցել|չափել|ուղարկել) (?:իր )?ճնշում(?:ը|ն)?(?: այս շաբաթ| այս շաբաթվա ընթացքում)?$/u,
];
const ADHERENCE:RegExp[]=[
 /^(?:show )?(?:my )?(?:members'? )?(?:medicine |medication )?adherence(?: this week| last week| for the week)?$/u,
 /^who (?:didn't|did not|hasn't|has not|haven't|have not|hasnt|didnt|havent) (?:take|taken|took|log|logged|record|recorded|report|reported|mark|marked)(?: any| their| the)? (?:medicines?|medications?|meds|pills|tablets|doses?|statins?)(?: this week| yesterday| today| yet)?$/u,
 /^кто не (?:принимал(?:а|и)?|принял(?:а|и)?)(?: свои)? (?:лекарства|таблетки|препараты|дозы)(?:,? а кто (?:просто )?ничего не отметил)?(?:,? не смешивай)?(?: на этой неделе| за неделю)?$/u,
 /^(?:приверженность лечению|приём лекарств|прием лекарств)(?: за неделю| на этой неделе)?$/u,
 /^ով չի (?:ընդունել|խմել|գրանցել) (?:իր )?(?:դեղերը|դեղեր|հաբերը)(?: այս շաբաթ)?$/u,
];
const HANDOFFS:RegExp[]=[
 /^(?:(?:any|are there any|show|show me|check) )?(?:my )?(?:answers?|replies|responses?) (?:from|of) the doctor$/u,
 /^what did the doctor (?:say|decide|answer|reply)(?: (?:about|on|to) (?:my |the )?(?:handoffs?|hand over|hand-over|case|message))?(?: for [\p{L}'-]+(?: [\p{L}'-]+){0,2})?$/u,
 /^(?:did|has) the doctor (?:actually )?(?:see|seen|answer|answered|reply|replied|respond|responded)(?: (?:to )?(?:it|my handoff|the handoff))?(?: or did we just send it)?$/u,
 /^(?:my |show (?:my )?|check (?:my )?)?handoffs?(?: status)?$/u,
 /(?:что врач (?:решил|ответил|сказал)|ответ врача|ответил ли врач|врач ответил|есть ответ от врача)/u,
 /(?:բժշկի պատասխանը|բժիշկը ինչ պատասխանեց|ինչ որոշեց բժիշկը|բժիշկը պատասխանե՞լ է|բժիշկը պատասխանել է)/u,
];
const words=(text:string)=>text.split(' ').length;

/** Digits of the phone number written after the word for a phone ("+374 91-01-1959" is one number), whole as written. A date of birth
 * or any other number elsewhere in the sentence is not the phone. */
function phoneDigits(text:string):string|null{
 const match=/(?:phone|number|телефон\S*|номер\S*|հեռախոս\S*)\D{0,25}?(\+?\d[\d\s().-]{2,}\d)/u.exec(text);
 const digits=match?match[1].replace(/\D/g,''):'';
 return digits.length>=4&&digits.length<=15?digits:null;
}
/** A message that opens as the identification of a member by birth: "find the member born …", "родилась …", "ծնված …". Anything
 * that opens as a question ("what is the risk for someone born …") is not one. */
const BIRTH_OPENER=/^(?:(?:find|open|search(?: for)?|look up|show|найди|найти|открой|открыть|покажи|գտիր|բացիր)\s+)?(?:(?:the )?(?:member|patient|пациента?|пациентку|участника?|անդամին?|հիվանդին?)\s+)?(?:(?:та|тот|ту|того)\s+)?(?:(?:что|кто|который|who)\s+)?(?:with\s+)?(?:(?:was\s+)?born|dob|date of birth|birth date|родил\S*|дата рождения|с датой рождения|ծնված|ծննդյան)/u;

export function nurseIntent(raw:unknown):NurseIntent|null{
 if(typeof raw!=='string'||raw.length>160||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const text=clean(raw);if(!text||words(text)>14)return null;
 if(HANDOFFS.some(pattern=>pattern.test(text))&&!/\d/u.test(text))return {kind:'handoffs'};
 if(ADHERENCE.some(pattern=>pattern.test(text))&&!/\d/u.test(text))return {kind:'adherence'};
 if(words(text)>10)return null;
 // WP T: the prioritised worklist card (a read only).
 if(/^(?:(?:show|open) )?(?:(?:my|the) )?(?:worklist|work list|priority list|risk list)$|^(?:(?:ցույց տուր|բացիր|բացել) )?(?:իմ )?(?:աշխատանքային ցուցակ(?:ը)?|առաջնահերթությունների ցուցակ(?:ը)?)$|^(?:(?:покажи|открой|открыть) )?(?:мой )?(?:рабочий список|список приоритетов)$/u.test(text))return {kind:'worklist'};
 if(PRIORITY.some(pattern=>pattern.test(text)))return {kind:'priority'};
 if(TODAY.some(pattern=>pattern.test(text)))return {kind:'today'};
 if(MISSING_BP.some(pattern=>pattern.test(text)))return {kind:'missing-bp'};
 const digits=phoneDigits(text);
 if(digits&&/(?:find|search|open|show|look up|найди|найти|открой|открыть|покажи|գտիր|գտնել|բացիր|բացել|ցույց)/u.test(text))return {kind:'find',query:digits};
 // A date of birth, written day.month.year or as ISO, with a word for birth. A date with only a find verb ("find the visit on 04/11/2026")
 // is not a member search, and a phone number is never read as a date. The raw text is read because cleaning turns the dots into spaces.
 const date=!/(?:phone|number|телефон|номер|հեռախոս)/u.test(text)?/(?<!\d)(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})(?!\d)/u.exec(raw.normalize('NFKC')):null;
 if(date&&BIRTH_OPENER.test(text))return {kind:'find',query:date[1]};
 if(/\b(?:visits?|appointments?)\b|визит|այց/u.test(text)&&words(text)<=8&&!/\d/u.test(text))return {kind:'visits'};
 if(/\boverdue\b|\blate tasks?\b|просроч|опаздыв|ժամկետանց/u.test(text)&&words(text)<=6)return {kind:'today'};
 if(/^(?:(?:show|open|see|list|all|my|open) )*tasks?$|^(?:мои |все |открыть |покажи )*задачи$|^(?:իմ |բոլոր )*առաջադրանք(?:ները|ներ)?$/u.test(text))return {kind:'tasks',filter:'active'};
 const find=/^(?:find|search(?: for)?|look up|open|найди|найти|открой|открыть|գտիր|գտնել|բացիր|բացել)\s+(?:(?:member|patient|пациента?|участника?|անդամին?|հիվանդին?)\s+)?(.+)$/u.exec(text);
 if(find){
  const query=find[1].trim();
  // "show tasks", "open visits" and the like were handled above; a query must look like a name: letters only, at most three words.
  if(query.length>=2&&query.length<=60&&words(query)<=3&&/^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]*$/u.test(query))return {kind:'find',query};
 }
 return null;
}
