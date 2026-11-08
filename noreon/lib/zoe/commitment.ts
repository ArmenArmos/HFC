import {normaliseText} from './normalise';

/**
 * Response-time commitment predicate (K5; ZOE_DESIGN §5.3, §18.4 and §19.3). A clause is a
 * commitment when it is about the team replying or making contact (first-person team action,
 * a recipient form such as "you'll hear from me", or a reply noun such as "a response") AND it
 * carries a time. Clinical timing for a member action ("measure your BP today") is not a
 * commitment. Denying a promise ("I can't promise when I'll reply") exempts its own clause
 * only; a deadline ("no later than", "won't ... later than") is never a denial. Text inside
 * quotation marks is exempt only when it is an exact substring of a member message.
 */
export const COMMITMENT_VERSION='zoe-commitment-3';

const TIME=/\b(today|tonight|tomorrow|soon|shortly|later|asap|before noon|by noon|after the weekend|every morning|by \d+|end of the day|coming days|coming week|next few days|within the hour|right away|in a (moment|bit|while)|this (week|evening|afternoon|morning)|next (week|day)|within|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|the end of|end of)|no later than|in \d+ (minutes?|hours?|days?)|\d+ hours?)\b|այսօր|վաղը|շուտով|ժամվա ընթացքում|մինչ(?:և|եւ) երեկո|օրից|ժամից|ոչ ուշ|այս շաբաթ|сегодня|завтра|скоро|в течение|не позднее|через \d+|на этой неделе/u;

// First-person team (or the named team) doing the replying or contacting.
const EN_TEAM_SUBJECT=/\b(i|we|i'll|we'll|i'm|we're|i've|we've|the doctor|your doctor|the care team|your care team|the clinic|our team|the team|someone|a nurse|the nurse)\b/u;
const EN_TEAM_ACTION=/\b(reply|replies|respond|responds|answer|answers|get back|call|ring|contact|write back|write to you|text you|message you|look at it|look at this|look into|look at your|review|reviews|ring you|call you|be seen|feedback|see this|see it|see your message|check your|check it|check this|phone|phones|be in touch|get in touch|follow up|hear back)\b/u;
const EN_RECIPIENT=/\bexpect (to hear|feedback|a reply|an answer|a call)\b|\byours will be (seen|read|answered)\b|\bhear from (me|us|the (doctor|clinic|care team|team))\b|\b(you('ll| will)?|you'll) (get|receive|hear|have)\b.{0,30}\b(reply|response|answer|call|message|from (me|us|the (doctor|clinic|care team)))\b|\bexpect\b.{0,20}\b(my|our|a|an|the)\b.{0,15}\b(reply|response|answer|call|assessment|message|update)\b/u;
const EN_REPLY_NOUN=/\b(a|the|my|our|your)? ?(reply|response|answer|assessment|call ?back)\b.{0,25}\b(will|is guaranteed|guaranteed|within|by|no later than|is coming|coming)\b/u;
const EN_DENIAL=/\b(can'?t|cannot|can not|won'?t be able to|unable to|not able to)\b.{0,10}\b(promise|guarantee|say)\b/u;
const DEADLINE=/\b(no later than|later than|not later than)\b|ոչ ուշ|не позднее|не позже/u;

// Armenian: first-person future of reply/call/write/look (կ- prefix, -եմ/-ենք endings), the
// doctor's third-person future, and recipient forms with a reply noun.
const HY_FIRST=/(^|[^\p{L}])կ(պատասխան|զանգ|գր|նայ|կապվ|կապն|հետադարձ)\p{L}*(եմ|ենք)(?!\p{L})/u;
const HY_DOCTOR=/(բժիշկ|խնամքի թիմ|կլինիկա)\p{L}*.{0,30}կ(պատասխան|զանգ|գր|նայ|կապվ|ծանոթան)\p{L}*[իա](?!\p{L})/u;
const HY_RECIPIENT=/(պատասխան|զանգ)\p{L}*.{0,25}(կստան|կուղարկվ|կտրվ|կհասն)\p{L}*|կստան\p{L}*.{0,25}(պատասխան|զանգ)/u;
const HY_DENIAL=/չեմ կարող.{0,10}խոստան|չենք կարող.{0,10}խոստան/u;
// Russian: first-person future of reply/call/write, and "the answer will be ...".
const RU_FIRST=/(^|[^\p{L}])(отвечу|ответим|ответят|ответит|перезвоню|перезвоним|перезвонят|позвоню|позвоним|позвонят|позвонит|напишу|напишем|напишут|свяжусь|свяжемся|свяжутся|посмотрю|посмотрим|посмотрит|посмотрят)(?!\p{L})/u;
const RU_RECIPIENT=/(ответ|звонок)\p{L}*.{0,15}(будет|получите|придет|придёт)|получите.{0,20}(ответ|звонок)/u;
const RU_DENIAL=/не (могу|можем) обещать/u;

const QUOTED=/"([^"]{1,400})"|“([^”]{1,400})”|«([^»]{1,400})»|'([^']{4,400})'/gu;

/** Removes quoted spans that are exact substrings of a member message; others stay and are checked. */
export function stripVerifiedQuotes(text:string,memberTexts:readonly string[]){
 const members=memberTexts.map(normaliseText);
 return text.replace(QUOTED,(whole,...groups)=>{
  const inner=groups.slice(0,4).find(g=>typeof g==='string') as string|undefined;
  return inner&&members.some(m=>m.includes(normaliseText(inner)))?' ':whole;
 });
}

/** Clauses: sentences, then ", but" and semicolons. */
const clauses=(t:string)=>t.split(/[.!?;։\n]+|,\s*(?:but|however|բայց|но)\s+|\s+(?:but|բայց|но)\s+/u).map(s=>s.trim()).filter(Boolean);

// Telling the member to call emergency services is never the team promising contact.
const EMERGENCY_CALL=/\b(call|ring|dial|contact) (103|911|112|an ambulance|the ambulance|emergency services)\b/gu;

function clauseCommits(clause:string){
 const c=clause.replace(EMERGENCY_CALL,' ');
 if(!TIME.test(c))return false;
 const deadline=DEADLINE.test(c);
 const denied=!deadline&&(EN_DENIAL.test(c)||HY_DENIAL.test(c)||RU_DENIAL.test(c));
 if(denied)return false;
 const en=(EN_TEAM_SUBJECT.test(c)&&EN_TEAM_ACTION.test(c))||EN_RECIPIENT.test(c)||EN_REPLY_NOUN.test(c);
 return en||HY_FIRST.test(c)||HY_DOCTOR.test(c)||HY_RECIPIENT.test(c)||RU_FIRST.test(c)||RU_RECIPIENT.test(c);
}

/** True when the text promises when the team will reply or make contact. */
export function hasResponseCommitment(text:string,memberTexts:readonly string[]=[]){
 const t=normaliseText(stripVerifiedQuotes(text,memberTexts)).replaceAll('’',"'");
 return clauses(t).some(clauseCommits);
}
