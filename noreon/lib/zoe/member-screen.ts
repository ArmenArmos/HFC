import {stagingPlaceholderActive} from './urgent-staging';
import {urgentDecision} from './urgent-test';
import {textRedFlags} from './symptoms/red-flags';
import type {Locale} from '@/lib/locale';

/**
 * The member Zoe screen while real AI calls are off (legal pending, founder feedback 17 Oct).
 * Everything here is deterministic: quick links, fixed answers and one routing decision for
 * typed text. Nothing in this module or the screen calls a model, the Gateway or the Zoe
 * pipeline; scripts/check-zoe-member-screen.ts fails if an import says otherwise.
 *
 * Typed text goes through the existing urgent-word step (lib/zoe/urgent-test.ts, the same one the
 * Zoe pipeline runs first). Red always wins: any urgent match opens the 103 screen. Anything else
 * is never read as reassurance and goes to the doctor messages flow. While the S1 list is
 * unsigned the matcher reports "skipped", which also goes to the doctor flow, and the screen keeps
 * Call 103 visible at all times.
 */
export const ZOE_TEXT_MAX=2000;
export type ZoeTextRoute='urgent'|'doctor'|'empty';

export function zoeTextRoute(text:string,env:Record<string,string|undefined>=process.env):ZoeTextRoute{
 const trimmed=text.trim();
 if(!trimmed)return 'empty';
 // Over-long text is still screened in full: it is never truncated before the urgent step.
 return urgentDecision(trimmed,env).outcome==='escalate'?'urgent':'doctor';
}

/**
 * While Zoe's symptom intake is switched on: the same deterministic symptom red flags the pipeline
 * runs first (lib/zoe/symptoms/red-flags.ts), on the text being sent. A hit opens the 103 screen at
 * once; the pipeline then also stops any intake and raises the care-team alert. No model.
 */
export const symptomRedFlagRoute=(text:string,intake:{enabled:boolean;active:boolean}|null):boolean=>
 !!intake?.enabled&&!!text.trim()&&textRedFlags([text],{intakeActive:intake.active}).length>0;

/** Staging presentation only. Detection, saved messages and care screening keep their existing rules. */
export const zoeEmergencyCardEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_ZOE_EMERGENCY_CARD==='true';
export type ZoeEmergencyCheck={env:Record<string,string>;intake:{enabled:boolean;active:boolean}|null};
/** Only public matcher switches and two intake booleans cross the client boundary, never the deployment environment. */
export const zoeEmergencyCheck=(intake:ZoeEmergencyCheck['intake'],env:Record<string,string|undefined>=process.env):ZoeEmergencyCheck|null=>
 zoeEmergencyCardEnabled(env)?{intake,env:{NOREON_ZOE_TEST_LEXICON:env.NOREON_ZOE_TEST_LEXICON==='true'?'true':'false',NOREON_ZOE_URGENT_PLACEHOLDER:stagingPlaceholderActive(env)?'true':'false'}}:null;
/** The same no-model checks as the send action, so the browser can show 103 before any IO finishes. */
export const isZoeEmergency=(text:string,check:ZoeEmergencyCheck)=>zoeTextRoute(text,check.env)==='urgent'||symptomRedFlagRoute(text,check.intake);
/** Presentation fallback only: intake can change while a send or its context read is offline. */
export const couldBeZoeEmergency=(text:string,check:ZoeEmergencyCheck)=>
 isZoeEmergency(text,check)||isZoeEmergency(text,{...check,intake:{enabled:true,active:false}})||isZoeEmergency(text,{...check,intake:{enabled:true,active:true}});

/** Where "Write to your doctor" leads, from the member's Telegram link state. */
export type DoctorChannel={mode:'telegram';href:string}|{mode:'connect';href:'/patient/account/telegram'}|{mode:'unavailable';href:'/patient/team?section=contact'};
export function doctorChannel(link:{state:string}|null,botUsername:string|null):DoctorChannel{
 if(link?.state==='linked'&&botUsername)return {mode:'telegram',href:`https://t.me/${botUsername}`};
 if(link?.state==='not_linked')return {mode:'connect',href:'/patient/account/telegram'};
 return {mode:'unavailable',href:'/patient/team?section=contact'};
}

type Copy=Record<Locale,string>;
/**
 * Common questions. Each ANSWER is an existing approved product text, copied verbatim from the
 * screen named in `source`; the check verifies the text is still there. The QUESTIONS are new
 * wording, AWAITING COPY SIGN-OFF with the rest of the Zoe screen copy.
 */
export const ZOE_FAQ:readonly {id:string;question:Copy;answer:Copy;source:string;link?:{href:string;label:Copy}}[]=Object.freeze([
 {id:'emergency',source:'components/patient-care/member-help-content.tsx',
  question:{en:'What should I do in an emergency?',hy:'Ի՞նչ անել շտապ դեպքում։',ru:'Что делать в экстренной ситуации?'},
  answer:{en:'Call 103 for emergency medical help. This app does not notify a doctor or emergency service when you open this page.',hy:'Շտապ բժշկական օգնության համար զանգահարեք 103։ Այս էջը բացելը չի ծանուցում բժշկին կամ շտապ օգնությանը։',ru:'Для экстренной медицинской помощи позвоните 103. Открытие этой страницы не уведомляет врача или службу скорой помощи.'},
  link:{href:'tel:103',label:{en:'Call 103',hy:'Զանգահարել 103',ru:'Позвонить 103'}}},
 {id:'treatment',source:'components/patient-care/member-team-content.tsx',
  question:{en:'Who can change my treatment?',hy:'Ո՞վ կարող է փոխել իմ բուժումը։',ru:'Кто может изменить моё лечение?'},
  answer:{en:'Only your doctor changes treatment. For urgent medical help, call 103.',hy:'Բուժումը փոխում է միայն բժիշկը։ Շտապ օգնության համար զանգահարեք 103։',ru:'Только ваш врач меняет лечение. Для срочной медицинской помощи звоните 103.'}},
 {id:'reading',source:'app/patient/measurements/new/page.tsx',
  question:{en:'How do I record my blood pressure?',hy:'Ինչպե՞ս գրանցել ճնշումը։',ru:'Как записать давление?'},
  answer:{en:'Enter the reading shown on your monitor.',hy:'Մուտքագրեք ձեր սարքի ցույց տված արդյունքը։',ru:'Введите измерение, которое показывает ваш тонометр.'},
  link:{href:'/patient/measurements/new',label:{en:'Record blood pressure',hy:'Գրանցել ճնշումը',ru:'Записать давление'}}},
 {id:'contact',source:'components/patient-care/member-contact.tsx',
  question:{en:'How do I contact Noreon?',hy:'Ինչպե՞ս կապվել Noreon-ի հետ։',ru:'Как связаться с Noreon?'},
  answer:{en:'Messaging your care team in the app is not switched on yet. For urgent medical help, call 103.',hy:'Հավելվածում խնամքի թիմին գրելը դեռ միացված չէ։ Շտապ բժշկական օգնության համար զանգահարեք 103։',ru:'Переписка с вашей медицинской командой в приложении пока не включена. Для срочной медицинской помощи звоните 103.'}},
]);
