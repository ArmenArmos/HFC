import type {Locale} from '@/lib/locale';
import {can,type AppRole} from '@/lib/rbac/roles';
import {BATCH_OTHER_PERSON,bpReadings,currentBpClauses} from '@/lib/zoe/bp-parse';
import {confirmationAnswer} from './confirm';
import {digitsFromSpoken,leftoverNumberWords} from './spoken-numbers';

/**
 * Voice to action, deterministic and framework-free (WP V). The demo's four model tools (log_bp_reading, alert_care_team,
 * set_reminder, show_ldl_progress) are not given to any model: this parser maps a finished spoken turn onto one typed
 * action, and the action may only OPEN a card. Every write still needs the member's (or clinician's) explicit
 * confirmation on that card, by tap or by a spoken yes bound to the card's nonce, through the command the tap uses.
 *
 * Rules: urgency is never decided here (the caller screens every transcript for emergencies first, and "contact the care
 * team" opens the ordinary request path); numbers come from lib/zoe/bp-parse.ts after spoken numbers are read as digits;
 * anything ambiguous (two readings, a pair without a separator, a number word left unread, a question, someone else's
 * reading, an earlier reading, a 12-hour time without morning or evening) is {kind:'none'} and stays an ordinary message.
 * Staff utterances never open a member by name: only fixed worklist phrases match.
 */
export const VOICE_INTENT_VERSION='voice-intent-1';

export type MemberVoiceAction=
 |{kind:'log_bp';systolic:number;diastolic:number;pulse:number|null}
 |{kind:'confirm_dose';when:'morning'|'evening'|'now'}
 |{kind:'set_reminder';time:string}
 |{kind:'show_ldl'}
 |{kind:'show_bp_trend'}
 |{kind:'contact_care_team'};
export type StaffVoiceAction=
 |{kind:'open_worklist'}
 |{kind:'open_alerts'}
 |{kind:'acknowledge_alert'}
 |{kind:'open_plan_approval'}
 |{kind:'open_target'}
 |{kind:'open_operations'}
 |{kind:'open_voice_settings'};
export type VoiceAction=MemberVoiceAction|StaffVoiceAction|{kind:'confirm'}|{kind:'cancel'}|{kind:'none'};
export type VoiceActionKind=VoiceAction['kind'];

const NONE:VoiceAction={kind:'none'};
const MEMBER_ROLES:readonly AppRole[]=['patient','caregiver'];
export const isMemberRole=(role:AppRole)=>MEMBER_ROLES.includes(role);

const has=(re:RegExp,t:string)=>re.test(t);
const QUESTION=/(?<![\p{L}])(?:is (?:it|that|this)|what|why|how (?:much|high|low)|should|normal|too (?:high|low)|ли|нормально|много|опасно|почему|что делать|ինչ|ինչու|արդյոք|նորմալ|շատ է|բարձր է|վտանգավոր)(?![\p{L}])/u;
const PRESSURE=/(?<![\p{L}])(?:bp|blood pressure|pressure|давлени\p{L}*|ад|ճնշ\p{L}*|զճ)(?![\p{L}])/u;
const PULSE=/(?<![\p{L}])(?:pulse|heart rate|пульс\p{L}*|(?:անոթա)?զարկ\p{L}*|սրտի զարկ\p{L}*)[\s:,-]*(?:is |was |է |был |-?ը )?(\d{2,3})(?![\d\p{L}])/u;
const LOG_VERB=/(?<![\p{L}])(?:log|record|save|enter|add|note|запиши\p{L}*|сохрани\p{L}*|внеси\p{L}*|отметь|գրանց\p{L}*|պահպան\p{L}*|գրիր|գրեք|նշիր)(?![\p{L}])/u;
// Someone else's reading, beyond bp-parse's list: Armenian kin words with any ending («մայրիկիս», «ամուսնուս»), Russian and English kin.
const OTHER_PERSON=/(?<![\p{L}])(?:մայրիկ\p{L}*|մամայ\p{L}*|մամա\p{L}*|մոր\p{L}*|հայրիկ\p{L}*|հոր\p{L}*|պապայ\p{L}*|ամուսն\p{L}*|ամուսին\p{L}*|կնոջ\p{L}*|տղայ\p{L}*|աղջկ\p{L}*|քրոջ\p{L}*|քույր\p{L}*|եղբոր\p{L}*|եղբայր\p{L}*|տատիկ\p{L}*|պապիկ\p{L}*|հարևան\p{L}*|ընկեր\p{L}*|мам\p{L}*|пап\p{L}*|муж\p{L}*|жен\p{L}*|сын\p{L}*|доч\p{L}*|брат\p{L}*|сестр\p{L}*|бабушк\p{L}*|дедушк\p{L}*|сосед\p{L}*|mother|mom|mum|father|dad|husband|wife|son|daughter|brother|sister|grandma|grandpa|neighbou?r|friend)(?![\p{L}])/u;
const PAST=/(?<![\p{L}])(?:yesterday|last (?:night|week|month)|ago|вчера|позавчера|назад|на прошлой|երեկ\p{L}*|նախորդ|անցյալ\p{L}*|առաջ)(?![\p{L}])/u;

const TOOK=/(?<![\p{L}])(?:took|taken|have taken|i've taken|выпил\p{L}*|принял\p{L}*|խմեցի|խմել եմ|ընդունեցի|ընդունել եմ)(?![\p{L}])/u;
const MEDICINE=/(?<![\p{L}])(?:pills?|tablets?|medicines?|medications?|meds|doses?|таблетк\p{L}*|лекарств\p{L}*|доз\p{L}*|դեղ\p{L}*|հաբ\p{L}*)(?![\p{L}])/u;
const DOSE_NEGATION=/(?<![\p{L}])(?:not|didn't|did not|haven't|have not|forgot|missed|skip\p{L}*|не|забыл\p{L}*|пропустил\p{L}*|չեմ|չխմեցի|չընդունեցի|չեմ խմել|մոռաց\p{L}*|բաց եմ թողել|բաց թողեցի)(?![\p{L}])/u;
const MORNING=/(?<![\p{L}])(?:morning|a\.?m\.?|утр\p{L}*|утром|առավոտ\p{L}*)(?![\p{L}])/u;
const EVENING=/(?<![\p{L}])(?:evening|night|tonight|p\.?m\.?|вечер\p{L}*|вечером|ноч\p{L}*|երեկո\p{L}*|գիշեր\p{L}*)(?![\p{L}])/u;

const REMIND=/(?<![\p{L}])(?:remind\p{L}*|напомни\p{L}*|напоминани\p{L}*|հիշեցր\p{L}*|հիշեցում\p{L}*|հիշեցն\p{L}*)(?![\p{L}])/u;
const LDL=/(?<![\p{L}])(?:ldl|cholesterol|холестерин\p{L}*|лпнп|խոլեստերին\p{L}*|ցխլ)(?![\p{L}])/u;
const SHOW=/(?<![\p{L}])(?:show|see|display|chart|graph|progress|trend|my|покажи\p{L}*|показать|график\p{L}*|динамик\p{L}*|мо[йияе]|ցույց|գրաֆիկ\p{L}*|իմ|ցուցադր\p{L}*)(?![\p{L}])/u;
const TREND=/(?<![\p{L}])(?:chart|graph|trend|history|week|weekly|readings|график\p{L}*|динамик\p{L}*|недел\p{L}*|истори\p{L}*|գրաֆիկ\p{L}*|շաբաթ\p{L}*|պատմություն\p{L}*|չափումներ\p{L}*)(?![\p{L}])/u;
const CONTACT=/(?<![\p{L}])(?:contact|call|message|talk to|speak to|connect me|write to|связ\p{L}*|позвон\p{L}*|напиш\p{L}*|написать|соедин\p{L}*|կապ\p{L}*|զանգ\p{L}*|գրել|գրեմ|խոսել)(?![\p{L}])/u;
const CARE_TEAM=/(?<![\p{L}])(?:nurse|doctor|care team|медсестр\p{L}*|врач\p{L}*|команд\p{L}*|բուժքր\p{L}*|բուժքույր\p{L}*|բժշկ\p{L}*|բժիշկ\p{L}*|թիմ\p{L}*)(?![\p{L}])/u;

/** A reminder time, 24-hour. 12-hour hours without a part of the day are ambiguous and give null. */
export function spokenTime(t:string):string|null{
 const clock=/(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/u.exec(t);
 let hour:number,minute=0;
 if(clock){hour=Number(clock[1]);minute=Number(clock[2]);}
 else{
  const at=/(?<![\p{L}\d])(?:at|в|ժամը|ժամ)\s*(\d{1,2})(?:-?\s?(?:ին|ի|ն))?(?!\d)|(?<!\d)(\d{1,2})\s*(?:o'?clock|pm|am|p\.m\.|a\.m\.|час\p{L}*|-?\s?ին)(?![\p{L}\d])/u.exec(t);
  if(!at)return null;
  hour=Number(at[1]??at[2]);
 }
 if(!Number.isInteger(hour)||hour>23)return null;
 const evening=EVENING.test(t),morning=MORNING.test(t);
 if(hour<=12&&!clock){
  if(evening===morning)return null;
  if(evening&&hour<12)hour+=12;
  if(morning&&hour===12)hour=0;
 }else if(clock&&hour<12&&evening&&!morning)hour+=12;
 return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}

/** One reading of this member, now, said plainly; otherwise null (ambiguous). */
function reading(original:string,t:string):{systolic:number;diastolic:number;pulse:number|null}|null{
 if(/[?？՞]/u.test(original)||has(QUESTION,t)||has(BATCH_OTHER_PERSON,t)||has(OTHER_PERSON,t)||has(PAST,t))return null;
 if(leftoverNumberWords(t).length)return null;
 const pulseMatch=PULSE.exec(t);
 const withoutPulse=pulseMatch?t.slice(0,pulseMatch.index)+' '+t.slice(pulseMatch.index+pulseMatch[0].length):t;
 const found=bpReadings(currentBpClauses(withoutPulse,true));
 if(found.length!==1)return null;
 // Every number must belong to the reading or the pulse: a third number makes the utterance ambiguous.
 const numbers=withoutPulse.match(/\d+/gu)??[];
 const r=found[0]!;
 if(numbers.length!==2)return null;
 if(!has(PRESSURE,t)&&!has(LOG_VERB,t)&&withoutPulse.replace(/[\d\s/\\-]|over|на|ի|ին/gu,'').length>12)return null;
 const pulse=pulseMatch?Number(pulseMatch[1]):null;
 if(pulse!==null&&(pulse<20||pulse>250))return null;
 return {systolic:r.systolic,diastolic:r.diastolic,pulse};
}

function memberIntent(original:string,t:string,role:AppRole):VoiceAction{
 if(has(REMIND,t)){
  if(role!=='patient')return NONE;
  const time=spokenTime(t);
  return time?{kind:'set_reminder',time}:NONE;
 }
 const bp=reading(original,t);
 if(bp)return can(role,'bp.log_own')||can(role,'bp.log_delegated')?{kind:'log_bp',...bp}:NONE;
 if(has(TOOK,t)&&has(MEDICINE,t)){
  if(has(DOSE_NEGATION,t)||/[?？՞]/u.test(original)||!(can(role,'dose.confirm_own')||can(role,'dose.confirm_delegated')))return NONE;
  return {kind:'confirm_dose',when:has(MORNING,t)&&!has(EVENING,t)?'morning':has(EVENING,t)&&!has(MORNING,t)?'evening':'now'};
 }
 if(has(LDL,t)&&has(SHOW,t))return {kind:'show_ldl'};
 if(has(PRESSURE,t)&&has(TREND,t)&&has(SHOW,t)&&!/\d/u.test(t))return {kind:'show_bp_trend'};
 if(has(CONTACT,t)&&has(CARE_TEAM,t)&&!/[?？՞]/u.test(original))return {kind:'contact_care_team'};
 return NONE;
}

const STAFF_RULES:readonly {kind:StaffVoiceAction['kind'];re:RegExp;allowed:(role:AppRole)=>boolean}[]=[
 {kind:'acknowledge_alert',re:/(?<![\p{L}])(?:acknowledge|ack|подтверд\p{L}*|հաստատ\p{L}*)(?![\p{L}]).*(?<![\p{L}])(?:alerts?|оповещени\p{L}*|тревог\p{L}*|ահազանգ\p{L}*)(?![\p{L}])/u,allowed:role=>can(role,'alert.acknowledge')},
 {kind:'open_plan_approval',re:/(?<![\p{L}])(?:approve|утверд\p{L}*|հաստատ\p{L}*)(?![\p{L}]).*(?<![\p{L}])(?:plans?|план\p{L}*|պլան\p{L}*)(?![\p{L}])/u,allowed:role=>can(role,'plan.approve')},
 {kind:'open_target',re:/(?<![\p{L}])(?:set|change|установ\p{L}*|измен\p{L}*|սահման\p{L}*|փոխ\p{L}*|նշանակ\p{L}*)(?![\p{L}]).*(?<![\p{L}])(?:targets?|goal|цел\p{L}*|թիրախ\p{L}*)(?![\p{L}])/u,allowed:role=>can(role,'target.set')},
 {kind:'open_voice_settings',re:/(?<![\p{L}])(?:voice|голос\p{L}*|ձայն\p{L}*)(?![\p{L}]).*(?<![\p{L}])(?:settings|настройк\p{L}*|կարգավորում\p{L}*)(?![\p{L}])/u,allowed:role=>role==='noreon_admin'&&can(role,'voice.settings_manage')},
 {kind:'open_alerts',re:/(?<![\p{L}])(?:alerts?|urgent|оповещени\p{L}*|тревог\p{L}*|срочн\p{L}*|ահազանգ\p{L}*|շտապ)(?![\p{L}])/u,allowed:role=>can(role,'alert.acknowledge')||can(role,'alert.receive')&&!isMemberRole(role)},
 {kind:'open_operations',re:/(?<![\p{L}])(?:operations|waiting|bookings|schedule|дела|ожида\p{L}*|запис\p{L}*|расписани\p{L}*|գործեր\p{L}*|սպաս\p{L}*|ամրագր\p{L}*|ժամանակացույց\p{L}*)(?![\p{L}])/u,allowed:role=>can(role,'schedule.manage')&&(role==='care_coordinator'||role==='clinic_admin'||role==='noreon_admin')},
 {kind:'open_worklist',re:/(?<![\p{L}])(?:worklist|work list|my list|queue|tasks|today|список\p{L}*|очеред\p{L}*|задач\p{L}*|сегодня|ցուցակ\p{L}*|հերթ\p{L}*|առաջադրանք\p{L}*|այսօր)(?![\p{L}])/u,allowed:role=>!isMemberRole(role)},
];

/**
 * The typed action for one finished spoken turn. locale is the reader's language; the parser reads all three because a
 * member may answer in another language. role is the speaker's application role (lib/rbac), which bounds what may open.
 */
export function voiceIntent(transcript:string,locale:Locale,role:AppRole):VoiceAction{
 if(typeof transcript!=='string')return NONE;
 const original=transcript.trim();
 if(!original||original.length>300)return NONE;
 const answer=confirmationAnswer(original,locale);
 if(answer)return {kind:answer};
 const t=digitsFromSpoken(original);
 if(isMemberRole(role))return memberIntent(original,t,role);
 const rule=STAFF_RULES.find(r=>r.re.test(t));
 return rule&&rule.allowed(role)?{kind:rule.kind}:NONE;
}

/** Intents that open a card a spoken yes may then confirm (the others are read-only or navigate). */
export const CONFIRMABLE_INTENTS=['log_bp','set_reminder']as const satisfies readonly VoiceActionKind[];
