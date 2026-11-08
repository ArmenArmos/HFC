import {normaliseText} from './normalise';
import {CRISIS_TEXT} from './conversation';
import {URGENT_MEDICINE_TEXT,URGENT_TEXT} from './symptoms/intake';
import {DRIVE_TEXT,S100_TEXT,URGENT_CHECK_IN,NO_TRAINING_LINE} from './urgent-followup';
import {URGENT_MEDICINE_STEPS_TEXT} from './health-answer';

/**
 * The persistent 103 window (lead 19 Oct 22:27; go-live robustness R011: 103 on the first message, a receipt on the
 * follow-up). After Zoe has sent the urgent or crisis text, every follow-up message repeats it, no receipt and no model,
 * until the member says the danger has passed (the ambulance came, they are at the hospital) or the window ends,
 * URGENT_WINDOW_MIN after the first urgent text of the current run of them. Deterministic, code only.
 */
export const URGENT_WINDOW_VERSION='zoe-urgent-window-8';
export const URGENT_WINDOW_MIN=120;
/** After a 103 alert Zoe remembers it for a day: short acknowledgements, the alarm note, a clear. The take-now, refusal and driving lines stay in URGENT_WINDOW_MIN. */
export const MONITORED_MIN=24*60;
// Every fixed urgent reply. The refusal (S100) and driving texts match whole (Astra Z360-02; Fable FB-05: their openings
// are plausible model sentences).
const WHOLE=[S100_TEXT,DRIVE_TEXT].flatMap(t=>Object.values(t));
// Free mode's medicine variant (URGENT_MEDICINE_STEPS_TEXT) is listed too: its Russian opening differs ("ничего нового").
const OPENINGS=[URGENT_TEXT,URGENT_MEDICINE_TEXT,URGENT_MEDICINE_STEPS_TEXT,CRISIS_TEXT].flatMap(t=>Object.values(t)).map(t=>t.slice(0,28));
/** Whether a stored Zoe answer is one of the fixed urgent texts (any language; older wordings share the opening). */
export function isUrgentAnswer(body:string):boolean{
 let text=body.trim();
 for(const line of Object.values(URGENT_CHECK_IN))if(text.endsWith(`\n\n${line}`))text=text.slice(0,-line.length-2);
 return OPENINGS.some(o=>text.startsWith(o))||WHOLE.some(t=>text===t||Object.values(NO_TRAINING_LINE).some(line=>text===`${t} ${line}`));
}
// Astra #356 UW-1 (two rounds): an allowlist, not a denylist. Only a short, whole-message affirmative that help has arrived
// or 103 was called ends the window ("I called 103", «Շտապօգնությունը եկավ», «Мы в больнице»); anything else, any
// qualification, question or extra clause, keeps it.
// Who called, in Armenian: the simple past («զանգեցի») and the perfect («զանգել եմ»), I or we; and what was called.
const HY_CALLED='(?:զանգեցի|զանգահարեցի|կանչեցի|կանչեցինք|զանգեցինք|զանգահարեցինք|(?:զանգել|զանգահարել|կանչել) (?:եմ|ենք))';
const HY_HELP='103|103-ին|103-ը|շտապօգնություն(?:ը|ին|ի)?|շտապ օգնություն(?:ը|ին|ի)?|շտապօգնությանը|շտապ օգնությանը';
const LATN_CALLED='(?:zangeci|zangahareci|kancheci|kanceci|kanchecinq|zangecinq|(?:zangel|zangahrel|zangaharel|kanchel|kancel) (?:em|enq))';
const LATN_HELP='103|103-?in|103 in|103-@|shtap ?ognutyun[@ըy]?|shtap ?ognutyan[@ըy]?|shtapognutyun[@ըy]?';
const LEAD='(?:(?:ok|okay|yes|thanks|thank you|լավ|այո|հա|շնորհակալություն|да|хорошо|ок|спасибо|ha|ayo|lav|shnorhakalutyun)[,\\s]+)?';
const PASSED_EXACT=[
 `(?:i|we)(?: have|'ve)? (?:just |already )?called (?:103|an ambulance|the ambulance)(?: (?:now|already|just now))?`,
 `(?:the )?(?:ambulance|paramedics) (?:is here|are here|has arrived|have arrived|arrived|came|has come)(?: (?:now|already))?`,
 `(?:we are|we're|i am|i'm|(?:he|she|mum|mom|dad|my (?:mum|mom|mother|dad|father|husband|wife|son|daughter)) is|(?:he's|she's)) (?:now |already )?(?:at|in) (?:the )?(?:hospital|emergency room|er|a&e)(?: now)?`,
 `(?:արդեն )?${HY_CALLED} (?:${HY_HELP})(?: արդեն)?`,
 // Gohar 20 Oct: «Զանգել եմ 103», and the object first («103 զանգեցի», «Շտապօգնություն կանչել եմ»).
 `(?:արդեն )?(?:${HY_HELP}) (?:արդեն )?${HY_CALLED}(?: արդեն)?`,
 // Armenian in Latin letters («Zangel em 103», «zangeci 103», «shtap ognutyun@ ekav», «hivandanocum enq»).
 `(?:arden )?${LATN_CALLED} (?:${LATN_HELP})(?: arden)?`,`(?:arden )?(?:${LATN_HELP}) (?:arden )?${LATN_CALLED}(?: arden)?`,
 // In the 103 window the call can only be the one Zoe asked for: the bare verb is enough («Զանգեցի», «Զանգել եմ», "I called").
 `(?:արդեն )?${HY_CALLED}(?: արդեն)?`,`(?:arden )?${LATN_CALLED}(?: arden)?`,`(?:i|we)(?: have|'ve)? (?:just |already )?called(?: (?:them|now|already))?`,
 `(?:я |мы )?(?:уже )?(?:вызвал|вызвала|вызвали|позвонил|позвонила|позвонили)(?: уже)?`,
 `(?:shtap ?ognutyun[@ըy]?|shtapognutyun[@ըy]?|brigad[@ըy]?) (?:arden )?(?:ekav|ekel e|ekel a|hasav|hasel e|hasel a|aystegh e|aystex e|arden aystegh e)`,`(?:(?:es|menq|hima) )?(?:arden )?hivandanocum (?:enq|em)(?: arden)?`,
 `(?:շտապօգնությունը|շտապ օգնությունը|բրիգադը) (?:արդեն )?(?:եկավ|եկել է|հասավ|հասել է|այստեղ է)`,
 `(?:(?:ես|մենք|հիմա) )?(?:արդեն )?հիվանդանոցում (?:ենք|եմ)(?: արդեն)?`,
 `(?:я |мы )?(?:уже )?(?:вызвал|вызвала|вызвали|позвонил|позвонила|позвонили)(?: в)? (?:скорую|103)(?: уже)?`,
 `(?:в )?(?:скорую|103) (?:уже )?(?:вызвал|вызвала|вызвали|позвонил|позвонила|позвонили)`,
 `(?:скорая|бригада) (?:приехала|уже здесь|здесь|уже приехала)`,
 `(?:мы|я|мама|папа|муж|жена|сын|дочь|бабушка|дедушка|он|она) (?:уже )?в (?:больнице|при[её]мном покое)`,
];
const PASSED=new RegExp(`^${LEAD}(?:${PASSED_EXACT.join('|')})$`,'u');
/** Whether the member's whole message says, plainly and without qualification, that help has arrived or 103 was called. */
export function dangerPassed(raw:string):boolean{
 if(/[?՞？]/u.test(raw))return false;
 const t=normaliseText(raw).replaceAll('’',"'").replace(/[.!։]+$/u,'').replace(/\s+/gu,' ').trim();
 return PASSED.test(t);
}
/** Open when Zoe's newest answers are urgent texts, the first of them within URGENT_WINDOW_MIN, and the danger has not passed. */
/**
 * sinceMinutes: how long ago the current run of urgent texts began, over the whole conversation (zoe_run_urgent_window;
 * Astra UW-2), null when the newest answer is not urgent. Undefined (local evals, the harness): from the job's answers,
 * which a doctor approval can empty.
 */
/**
 * earlier: the member's other messages in the job. One sent after Zoe's newest urgent text that says help came closes the window
 * for good (Astra, Gohar 20 Oct): in doctor mode the exit gets no reply of Zoe's, so the urgent text stays the newest answer and
 * a later "Thank you" would otherwise reopen it.
 */
/**
 * throughSeq: the newest member message a 103 text of the current run answered (zoe_run_urgent_window; Astra N1-2). When known, an
 * exit closes the window when it came after that message (exact order); otherwise by age, strictly newer than the newest urgent text.
 */
export function urgentWindowOpen(answers:readonly {body:string;minutesAgo:number}[],latestText:string,sinceMinutes?:number|null,earlier:readonly {text:string;minutesAgo:number;seq?:number}[]=[],throughSeq?:number|null):boolean{
 let anchor:number|null=null;
 if(sinceMinutes!==undefined)anchor=sinceMinutes;
 else for(let i=answers.length-1;i>=0&&isUrgentAnswer(answers[i]!.body);i--)anchor=answers[i]!.minutesAgo;
 if(anchor===null||anchor>URGENT_WINDOW_MIN||dangerPassed(latestText))return false;
 const urgentAgo=answers.filter(a=>isUrgentAnswer(a.body)).map(a=>a.minutesAgo);
 const newestUrgent=urgentAgo.length?Math.min(...urgentAgo):anchor;
 // Strictly newer (Astra): ages are whole minutes, so a tie may be an older exit before a newer urgent text; then the window stays.
 return !earlier.some(m=>(throughSeq!=null&&m.seq!==undefined?m.seq>throughSeq:m.minutesAgo<newestUrgent)&&dangerPassed(m.text));
}
