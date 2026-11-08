/** "Draft a handoff for the doctor": a whole-message request, with the member open (Zoe mode). It only prepares a summary for the nurse to edit
 * in the hand-over composer; her send is the confirm step. en/ru/hy, no model. */
const clean=(raw:string)=>raw.normalize('NFKC').toLocaleLowerCase().replace(/[’`]/gu,"'").replace(/[.!?։]+$/u,'').replace(/\s+/gu,' ').trim();
const DRAFT_HANDOFF:RegExp=new RegExp(`^(?:please |zoe,? )*(?:(?:draft|prepare|write|make|create)(?: me)?(?: a| the)? (?:hand ?over|handoff|hand-over)(?: summary)?(?: for the doctor| to the doctor)?|(?:summari[sz]e|summary)(?: this member| the case| the record)? for the doctor|(?:подготовь|составь|сделай|напиши) (?:передачу|сводку)(?: для врача| врачу)?|(?:պատրաստիր|գրիր) (?:փոխանցում|ամփոփում)(?: բժշկի համար)?)$`,'iu');
export type DraftIntent={kind:'draft-handoff'};
export function draftIntent(raw:unknown):DraftIntent|null{
 if(typeof raw!=='string'||raw.length>200||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 return DRAFT_HANDOFF.test(clean(raw))?{kind:'draft-handoff'}:null;
}
