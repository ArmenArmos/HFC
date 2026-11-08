import {z} from 'zod';
import {CHAT_TASKS,type ChatTask} from './tasks';

/** Facts, not records or predictions from a model. A future predictor can keep this boundary. */
export const suggestionStateSchema=z.object({
 locale:z.enum(['hy','en','ru']),consent:z.boolean(),emergency:z.boolean(),safetyHold:z.boolean(),
 medicineDue:z.boolean(),bpDue:z.boolean(),visitProposal:z.boolean(),visitToBook:z.boolean(),
 planToRead:z.boolean(),resultsToRead:z.boolean(),doctorReply:z.boolean(),
});
export type SuggestionState=z.infer<typeof suggestionStateSchema>;
export type ChatSuggestion={id:ChatTask;text:string};
/** Time-sensitive tasks first; no fallback chips just to fill the row. Unknown safety means none. */
export function suggestionsFor(state:SuggestionState|null|undefined):ChatSuggestion[]{
 if(!state?.consent||state.emergency||state.safetyHold)return [];
 const candidates: [ChatTask,boolean][]=[
  ['dose',state.medicineDue],['bp',state.bpDue],['proposal',state.visitProposal],
  ['message',state.doctorReply],['visit',state.visitToBook&&!state.visitProposal],
  ['results',state.resultsToRead],['plan',state.planToRead],
 ];
 return candidates.filter(([,likely])=>likely).slice(0,3).map(([id])=>({id,text:CHAT_TASKS[id].text[state.locale]}));
}
