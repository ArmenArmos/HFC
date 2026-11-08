import {chatTask,CHAT_TASKS} from '@/lib/chat/tasks';
import type {CardKind} from './registry';

/**
 * Which card a member's typed message asks for, if any. It never decides anything about safety and never reads a
 * message Zoe's pipeline has not cleared: the database offers only the member's newest message whose Zoe run finished
 * as an ordinary chat or logistics answer (_zoe_chat_message_cleared), and re-checks that when the card is opened.
 * The result is an offer the member taps, never an action. Armenian, Russian and English; first match wins, so the
 * more specific asks come first.
 */
const RULES:readonly {kind:CardKind;re:RegExp}[]=[
 {kind:'side_effect',re:/side[\s-]?effects?|կողմնակի|побочн/u},
 {kind:'bp',re:/\b(?:log|record|enter|add|save)\b.*\b(?:blood pressure|bp|reading)\b|ճնշ.*(?:գրանց|գրել|գրիր|գրեք|մուտքագր|պահել|պահիր|պահեք)|(?:գրանց|գրել|գրիր|գրեք|մուտքագր|պահել|պահիր|պահեք).*ճնշ|chnshum.*(?:gran|gri|gre|pah|nsh)|(?:gran|gri[a-z]*|pahi|nsh[a-z]*).*chnshum|давлени.*(?:запис|внести|внесу|сохран|отмет)|(?:запис|внести|внесу|сохран|отмет).*давлени/u},
 {kind:'results',re:/\b(?:my|latest|recent|show|see)\b.*\b(?:results?|labs?|blood tests?)\b|(?:իմ|ցույց|վերջին).*(?:արդյունք|անալիզ)|(?:արդյունք|անալիզ).*(?:իմ|ցույց|վերջին)|(?:мои|покаж|последн).*(?:результат|анализ)|(?:результат|анализ).*(?:мои|покаж|последн)/u},
 {kind:'plan',re:/\b(?:my|show|see)\b.*\bplan\b|(?:իմ|ցույց).*(?:պլան)|պլան.*(?:իմ|ցույց)|(?:мой|покаж).*план|план.*(?:мой|покаж)/u},
 {kind:'visit',re:/\b(?:my|next|upcoming)\b.*\b(?:visit|appointment)\b|\b(?:reschedule|cancel|change)\b.*\b(?:visit|appointment)\b|(?:իմ|հաջորդ|առաջիկա).*այց|այց.*(?:փոխել|չեղարկել|երբ)|(?:мой|следующ|ближайш).*визит|визит.*(?:перенест|отмен|когда)/u},
 {kind:'message',re:/\b(?:message|write to|contact|talk to)\b.*\b(?:care team|doctor|nurse)\b|(?:գրել|կապվել).*(?:բժշկ|բուժքույր|թիմ)|(?:написать|связаться).*(?:врач|медсестр|команд)/u},
 // After the explicit tasks: naming a dose while asking for something else stays that request. Medicine words: the common ones, and the endings of the classes members take, so "I took my atorvastatin" counts.
 {kind:'dose',re:/(?<![a-z])(?:hab|dex|degh)[a-z]*(?![a-z]).*(?<![a-z])(?:xmec\w*|khmec\w*|ynd[a-z]*|nshi|nshek|nshel|grancir|grancek|grancel|grances|moraca\w*)(?![a-z])|(?<![a-z])(?:xmec\w*|khmec\w*|ynd[a-z]*|nshi|nshek|grancir|grancek|grances)(?![a-z]).*(?<![a-z])(?:hab|dex|degh)[a-z]*(?![a-z])|\b(?:log|mark|tick|record)\b.*\b(?:medicines?|medications?|meds?|pills?|tablets?|doses?)\b|\b(?:took|taken|forgot|missed)\b.*\b(?:pills?|tablets?|medicines?|medications?|meds?|doses?|\p{L}+(?:statin|pril|sartan|dipine|olol|timibe|thiazide))\b|(?:դեղ|հաբ).*(?:նշել|ընդուն(?:եցի|ել եմ)|խմ(?:եցի|ել եմ)|մոռաց(?:ա|ել եմ)|բաց(?: եմ)? թող(?:եցի|ել))|(?:նշել|ընդուն(?:եցի|ել եմ)|խմ(?:եցի|ել եմ)|մոռաց(?:ա|ել եմ)|բաց(?: եմ)? թող(?:եցի|ել)|չեմ (?:խմել|ընդունել)).*(?:դեղ|հաբ)|(?:лекарств|таблетк|доз).*(?:отмет|принял|выпил|забыл|пропустил)|(?:отмет|принял|выпил|забыл|пропустил).*(?:лекарств|таблетк|доз)/u},
 // WP F: settings the member manages in the chat, after every task, so a reading, a dose or a message that mentions a
 // carer or a consent stays that task. Nouns only, so "I agree" in a reply never opens the consents card. Offered only
 // where those cards are switched on (cardOffer's settingsKinds).
 {kind:'caregiver',re:/\bcare ?givers?\b|\bcarers?\b|\bwho (?:can )?helps? me\b|խնամող|խնամակալ|опекун|сиделк|ухаживающ/u},
 {kind:'consents',re:/\bconsents?\b|համաձայնություն|согласи[еяй]/u},
  // Last: an explicit task that names LDL ("log my LDL medicine", "message my doctor about LDL") stays that task.
 {kind:'ldl',re:/\bldl\b|\bcholesterol\b.*\bgoal\b|\bat goal\b|ցխլ|լպնպ|лпнп/u},
];

export function cardIntent(text:string):CardKind|null{
 const task=chatTask(text);
 if(task)return CHAT_TASKS[task].kind;
 const t=text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();
 if(!t||t.length>500)return null;
 return RULES.find(r=>r.re.test(t))?.kind??null;
}
