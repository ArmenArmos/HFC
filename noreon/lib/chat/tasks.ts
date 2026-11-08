import type {PatientLocale} from '@/lib/patient/copy';

/** Shared task wording and routing. Suggestions and typed text use this same vocabulary.
 * These are requests to OPEN a task, never confirmation of its clinical action.
 * New member-facing wording is staging copy pending language approval.
 */
export const CHAT_TASKS = {
 dose: {kind:'dose', text:{en:'I took my medicines',hy:'Ես ընդունեցի դեղերս',ru:'Я принял лекарства'}},
 bp: {kind:'bp', text:{en:'I want to record my blood pressure',hy:'Ուզում եմ գրանցել ճնշումս',ru:'Я хочу записать давление'}},
 proposal: {kind:'visit', text:{en:'I want to answer my visit proposal',hy:'Ուզում եմ պատասխանել իմ այցի առաջարկին',ru:'Я хочу ответить на предложение визита'}},
 visit: {kind:'visit', text:{en:'Help me book my visit',hy:'Օգնեք ինձ ամրագրել իմ այցը',ru:'Помогите мне записаться на визит'}},
 plan: {kind:'plan', text:{en:'I want to read my plan',hy:'Ուզում եմ կարդալ իմ պլանը',ru:'Я хочу прочитать мой план'}},
 results: {kind:'results', text:{en:'I want to see my results',hy:'Ուզում եմ տեսնել իմ արդյունքները',ru:'Я хочу посмотреть мои результаты'}},
 message: {kind:'message', text:{en:'I want to reply to my doctor',hy:'Ուզում եմ պատասխանել իմ բժշկին',ru:'Я хочу ответить моему врачу'}},
} as const;
export type ChatTask = keyof typeof CHAT_TASKS;
const normalise = (text:string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim().replace(/[.։]+$/u,'');
/** Whole messages only: extra symptoms, questions, numbers or invisible characters stay with Zoe. */
export function chatTask(text:string):ChatTask|null {
 const t=normalise(text);
 return (Object.keys(CHAT_TASKS) as ChatTask[]).find(key=>Object.values(CHAT_TASKS[key].text).some(value=>normalise(value)===t))??null;
}
export const TASK_REPLY:Record<PatientLocale,string>={
 en:'You can do that on the card here.',hy:'Կարող եք դա անել այստեղի քարտով։',ru:'Вы можете сделать это на карточке здесь.',
};
