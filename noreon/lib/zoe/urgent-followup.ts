import {isQuestion} from './conversation';
import {normaliseText} from './normalise';
import {textRedFlags} from './symptoms/red-flags';
import type {ReplyLanguage} from './provider';

/**
 * After a 103 message (Zoe spec v1 §12 "Refusal of 103 (S100 model)"; dataset S006, S100; go-live rubric P07/P08): the member's
 * next message in the urgent window is answered, not just repeated. A refusal or a wait plan gets the S100 response (restate
 * once, involve the person nearby, minimum safety steps, no medicine, stay in the conversation); a question about driving or
 * going alone gets an explicit no. Fixed text, no model. STAGING WORDING pending Armen and Tatevik.
 */
export const URGENT_FOLLOWUP_VERSION='zoe-urgent-followup-5';
// Explicit: still a refusal or a wait plan when phrased as a question ("Can I wait until morning?"). The text is normalised, so «և» is written «եւ».
const REFUSE=/(?<![\p{L}])(?:can i (?:just )?wait|можно подождать|կարո՞?ղ եմ սպասել|won'?t call|will not call|not call(?:ing)?|don'?t want to call|no ambulance|not an emergency|(?:wait|hold on)(?: until| till)? (?:the )?(?:morning|tomorrow)|i'?ll wait|don'?t want to bother|չեմ կանչի|չեմ զանգի|չեմ ուզում կանչել|կսպասեմ|մինչեւ առավոտ|սպասել մինչեւ վաղը|չեմ ուզում անհանգստացնել|не буду вызывать|не хочу вызывать|не буду звонить|подожду|до утра|подождать до завтра|не хочу беспокоить)(?![\p{L}])/u;
// Vague: only as a statement ("Can I go to the gym tomorrow?" is not a refusal).
const REFUSE_VAGUE=/(?<![\p{L}])(?:tomorrow|i feel (?:fine|ok|okay|better)|i'?m (?:fine|ok|okay)|վաղը|լավ եմ|завтра|мне уже лучше|я в порядке)(?![\p{L}])/u;
const DRIVE=/(?<![\p{L}])(?:drive|driving|my car|taxi|go (?:there )?(?:myself|alone|by myself|on my own|independently)|take myself|(?:сам(?:а)?|самостоятельно) (?:поеду|доеду|доберусь|пойду)|(?:поеду|доеду|доберусь|пойду) (?:сам(?:а)?|самостоятельно)|за рул[её]м|на такси|на машине|մեքենայով|(?:ինքս|ինքնուրույն|մենակ) (?:գնամ|կգնամ|կքշեմ)|(?:inqs|inks|inqnuruyn|inknuruyn|menak) (?:gnam|kgnam|kqshem)|տաքսի|քշեմ)(?![\p{L}])/u;

// An action question, not an urgency rule. The unchanged red-flag engine must already recognise the reported faint.
const TRAINING=/(?<![\p{L}])(?:train\w*|exercis\w*|sport\w*|gym|մարզ\p{L}*|marz\w*|тренир\p{L}*|спорт\p{L}*)(?![\p{L}])/u;
export const trainingAfterFaint=(texts:readonly string[],latest:string)=>TRAINING.test(normaliseText(latest))&&
 textRedFlags(texts,{intakeActive:false}).some(h=>h.id==='fainting');
/** S035. UNAPPROVED WORDING for Armen: no training until cardiology assessment. */
export const NO_TRAINING_LINE:Record<ReplyLanguage,string>={
 en:'Do not train again until a cardiology assessment.',
 hy:'Մի վերսկսեք մարզումները մինչև սրտաբանական գնահատումը։',
 ru:'Не возобновляйте тренировки до кардиологического обследования.',
};

export const S100_TEXT:Record<ReplyLanguage,string>={
 en:"I hear you, and I won't pressure you. There is no safe way to wait with these symptoms: they need 103 now. Please tell someone near you right now and let them stay with you, keep the door unlocked, don't drive, and don't take any medicine unless the ambulance team says so. Please call 103 now; I'm still here.",
 hy:'Հասկանում եմ ձեզ և չեմ ճնշի։ Այս ախտանիշներով սպասելու անվտանգ ձև չկա. անհրաժեշտ է 103 հիմա։ Խնդրում եմ, հենց հիմա ասեք կողքի մարդուն, թող մնա ձեզ հետ, դուռը մի փակեք, մեքենա մի վարեք և ոչ մի դեղ մի ընդունեք, եթե շտապօգնության բրիգադը չասի։ Խնդրում եմ, զանգահարեք 103 հիմա, ես այստեղ եմ։',
 ru:'Я вас слышу и не буду давить. С такими симптомами безопасно ждать нельзя: нужно 103 сейчас. Пожалуйста, прямо сейчас скажите кому-то рядом и попросите остаться с вами, не запирайте дверь, не садитесь за руль и не принимайте лекарств, пока бригада скорой не скажет. Позвоните 103 сейчас, я здесь.',
};
export const DRIVE_TEXT:Record<ReplyLanguage,string>={
 en:"Please don't drive yourself or go alone. Call 103 now: the ambulance team can start help on the way. Don't take any medicine unless they tell you to, and keep someone with you.",
 hy:'Խնդրում եմ, ինքներդ մեքենա մի վարեք և մենակ մի գնացեք։ Զանգահարեք 103 հիմա. շտապօգնության բրիգադը կարող է օգնել դեռ ճանապարհին։ Ոչ մի դեղ մի ընդունեք, եթե նրանք չասեն, և թող ինչ-որ մեկը մնա ձեզ հետ։',
 ru:'Пожалуйста, не садитесь за руль и не езжайте одни. Позвоните 103 сейчас: бригада скорой может начать помощь уже в пути. Не принимайте лекарств, пока они не скажут, и пусть кто-то будет рядом.',
};
// "I called 103, can I drink coffee?" (Armen's QA, 3 Nov): the member says the ambulance WAS called (now) and asks about eating or drinking. A fixed answer instead of the generic
// careful line. It gives NO fasting advice of its own (Astra: "don't eat or drink" is wrong for low blood sugar): the 103 team decides, and no new medicine.
// A WHITELIST, not a blacklist: the whole message must be exactly "<I called 103 / the ambulance is coming><separator> <can I eat / drink / have some water ...>", short, nothing else. A
// negated, past, conditional or longer message (a driving request, a relative, a time, a second clause) matches nothing and keeps the ordinary path. The pipeline adds two blockers:
// a medicine question (the medicine answer is in charge) and any low-sugar, glucose or diabetes mention in the chat (the existing low-sugar guidance stays in charge).
// STAGING WORDING pending Armen and Tatevik. The text is normalised, «և» is «եւ».
const CALL_PART:RegExp[]=[
 /^(?:i(?:'ve| have)? (?:just )?(?:called|phoned|rung|rang) (?:103|an ambulance|the ambulance)|(?:i'm|i am) calling 103|the ambulance is (?:coming|on (?:its|the) way))[,.;!]? /u,
 /^(?:я )?(?:вызвала|вызвал|позвонила|позвонил|набрала|набрал) (?:в )?(?:103|скорую|скорой)[,.;!]? |^скорая (?:едет|выехала)[,.;!]? /u,
 /^(?:զանգել եմ|զանգեցի|զանգում եմ) 103[,.։;!]? |^շտապօգնությունը (?:ճանապարհին է|գալիս է)[,.։;!]? /u,
];
const ASK_PART:RegExp[]=[
 /^(?:can|may|could) i (?:eat|drink|smoke|have (?:some |a |any )?(?:water|coffee|tea|food))(?: [a-z]+){0,2}[?.!]*$/u,
 /^(?:можно|могу ли я|мне можно) (?:выпить|попить|поесть|пить|есть|покурить|курить)(?: [а-яё]+){0,2}[?.!]*$/u,
 /^(?:իսկ )?(?:[\p{L}]+ )?(?:կարելի՞? է|կարո՞?ղ եմ|կարող եմ) (?:[\p{L}]+ )?(?:խմել|ուտել|ծխել)[?.։!]*$/u,
];
// Words that make the existing low-sugar guidance the right answer; the pipeline also passes `sugar` from the full low-sugar detector.
const GLUCOSE=/(?<![\p{L}])(?:glucose|sugar|diabet\p{L}*|insulin|hypo\p{L}*|low blood|глюкоз\p{L}*|сахар\p{L}*|диабет\p{L}*|инсулин\p{L}*|гипо\p{L}*|շաքար\p{L}*|դիաբետ\p{L}*|ինսուլին\p{L}*|գլյուկոզ\p{L}*|shakar\p{L}*|glyukoz\p{L}*|insulin\p{L}*)(?![\p{L}])/u;
export type CalledBlockers={context?:readonly string[];medicine?:boolean;sugar?:boolean;/** A severe allergic reaction earlier in the chat (the urgent text with the prescribed adrenaline-pen exception stays in charge). */special?:boolean;/** A PDE5 inhibitor with a nitrate in the chat: the nitrate warning stays in charge. */pde5?:boolean};
export const calledAndAsksToEatOrDrink=(raw:string,blockers:CalledBlockers={})=>{
 if(blockers.medicine||blockers.sugar||blockers.special||blockers.pde5||!isQuestion(raw))return false;
 const t=normaliseText(raw).replaceAll('’',"'").replace(/\s+/gu,' ').trim();
 const matched=CALL_PART.some(call=>{const m=call.exec(t);return m!==null&&ASK_PART.some(ask=>ask.test(t.slice(m[0].length)));});
 return matched&&![raw,...(blockers.context??[])].some(x=>GLUCOSE.test(normaliseText(x)));
};
// The lead-in only. The pipeline appends the ordinary urgent text after it (urgentText: the steps, the medicine rule and every condition-specific guidance the chat has earned, such as
// the adrenaline-pen exception or the nitrate warning), so this answer never replaces any of it (Astra rounds 2 to 4).
export const CALLED_EAT_DRINK_TEXT:Record<ReplyLanguage,string>={
 en:"Good that you called 103. The ambulance team will tell you what you can eat or drink now, so please ask them.",
 hy:'Լավ է, որ զանգել եք 103։ Ինչ կարելի է ուտել կամ խմել հիմա, կասի շտապօգնության բրիգադը, խնդրում եմ, հարցրեք նրանց։',
 ru:'Хорошо, что вы позвонили 103. Что можно есть или пить сейчас, скажет бригада скорой, пожалуйста, спросите у них.',
};
// Phones type the curly apostrophe ("I won’t call").
const followUpText=(raw:string)=>normaliseText(raw).replaceAll('’',"'");
/** The fixed follow-up for the newest message in an urgent window, or null for the ordinary urgent text. */
export function urgentFollowUp(raw:string,l:ReplyLanguage,excludeQuestions=false,called:CalledBlockers={}):string|null{
 const t=followUpText(raw);
 if(DRIVE.test(t))return DRIVE_TEXT[l];
 if(calledAndAsksToEatOrDrink(raw,called))return CALLED_EAT_DRINK_TEXT[l];
 if(REFUSE.test(t)||(!excludeQuestions||!isQuestion(raw))&&REFUSE_VAGUE.test(t))return S100_TEXT[l];
 return null;
}
/** A plain refusal or wait plan, never a vague word such as "tomorrow" or "I feel fine". */
export const refuses103=(raw:string)=>REFUSE.test(followUpText(raw));

/** Conversation-only continuations; the deterministic urgent checks run before these. */
export const URGENT_CHECK_IN:Record<ReplyLanguage,string>={
 en:'When you can, tell me: did you call 103, or are you OK now?',
 hy:'Երբ կարողանաք, գրեք ինձ. զանգե՞լ եք 103, թե՞ հիմա լավ եք։',
 ru:'Когда сможете, напишите: вы позвонили 103 или вам уже лучше?',
};
export const URGENT_ACK:Record<ReplyLanguage,string>={
 en:"OK, I'm here.",hy:'Լավ, ես այստեղ եմ։',ru:'Хорошо, я здесь.',
};
export const URGENT_TAKE_NOW:Record<ReplyLanguage,string>={
 en:"Please don't take anything new until the ambulance team or your doctor says so.",
 hy:'Խնդրում եմ, ոչ մի նոր դեղ մի ընդունեք, քանի դեռ շտապօգնության բրիգադը կամ ձեր բժիշկը չի ասել։',
 ru:'Пожалуйста, не принимайте ничего нового, пока бригада скорой или ваш врач не скажут.',
};
export const urgentAcknowledgement=(raw:string)=>/^(?:thanks|thank you|ok(?:ay)?(?:[, ]+calling)?|շնորհակալություն|շնորհակալ եմ|լավ(?:[, ]+(?:զանգում եմ|զանգեցի))?|հա|спасибо|хорошо(?:[, ]+звоню)?|ок(?:[, ]+звоню)?)[.!։\s]*$/u.test(normaliseText(raw));
// A medicine mention or a missed-dose statement alone is not a take-now question.
export function asksToTakeNow(raw:string):boolean{
 if(!isQuestion(raw))return false;
 const t=followUpText(raw);
 const action=/(?<![\p{L}])(?:take|taking|try|drink|выпить|принять|принимать|խմել|ընդունել|խմեմ|ընդունեմ)(?![\p{L}])/u;
 const request=/(?<![\p{L}])(?:(?:can|could|may|should|shall|do) i|is it (?:ok|okay|safe) (?:for me )?to|կարող եմ|կարելի է|կարելի|можно|могу (?:ли )?я|мне (?:можно|стоит)|стоит ли мне)(?![\p{L}])/u;
 const directQuestion=/(?<![\p{L}])(?:խմեմ|ընդունեմ)(?![\p{L}])|^(?:принять|выпить)(?![\p{L}])/u.test(t);
 return (request.test(t)||directQuestion)&&action.test(t);
}
const TAKE_STATED=/(?<![\p{L}])(?:i'?m taking|i am taking|i'?ll take|will take|going to take|принимаю|приму|выпью|խմում եմ|եմ խմում|եմ ընդունում|կխմեմ|կընդունեմ)(?![\p{L}])/u;
const TAKE_ANY=/(?<![\p{L}])(?:something|anything|a pill|a tablet|что-нибудь|таблетку|մի հաբ)(?![\p{L}])/u;
/** During an open alarm: a take-now question (a medicine or "something"), or a stated present or future take of a named medicine. */
export function takesSomethingNow(raw:string,mentionsMedicine:(text:string)=>boolean):boolean{
 const t=followUpText(raw),medicine=mentionsMedicine(raw);
 return asksToTakeNow(raw)&&(medicine||TAKE_ANY.test(t))||medicine&&TAKE_STATED.test(t);
}

// Roo631 item 2: a positive medicine-change request during 103 advice needs the existing handoff caution as well.
// This adds no stop recommendation and no new urgency decision. Other objects (quit smoking) do not qualify.
const MEDICINE_CHANGE=/(?<![\p{L}])(?:stop\p{L}*|quit\p{L}*|cancel\p{L}*|skip\p{L}*|paus\p{L}*|chang\p{L}*|come off|won'?t take|not take|don'?t want to take|do not want to take|no longer need|do not need|прекра[тщ]\p{L}*|переста\p{L}*|бро[сш]\p{L}*|отмен\p{L}*|пропус\p{L}*|измен\p{L}*|не (?:буду )?(?:принимать|пить|нужны)|больше не нужны|դադարեցն\p{L}*|կդադարեցն\p{L}*|թողնել|փոխել|բաց թողնել|չխմել|չեմ (?:խմելու|խմում|ուզում)|պետք չեն)(?![\p{L}])/u;
const MEDICINE_OBJECT=/(?:medicine|medication|tablet|pill|meds|դեղ|հաբ|лекарств|таблет|препарат)/u;
export function urgentMedicineChange(raw:string,mentionsMedicine:(text:string)=>boolean):boolean{
 const t=followUpText(raw);
 return MEDICINE_CHANGE.test(t)&&(MEDICINE_OBJECT.test(t)||mentionsMedicine(raw));
}
