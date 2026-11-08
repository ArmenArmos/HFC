import{observationFields,type CareVisit}from'./visit-evidence-schema';

/**
 * PLACEHOLDER: the nurse visit checklist content waits for decision Q2 (which
 * tests and measurements are required or conditional, waist and/or neck, what
 * each location can do). The clinical lead supplies the table and the clinic's
 * nurse lead approves it. Until then the list is empty and nothing renders.
 * Filling it means setting the status to 'approved' with the source reference;
 * scripts/check-lab-stages.ts asserts the shipped placeholder state.
 */
export const visitChecklistStatus:{state:'awaiting-q2'}|{state:'approved';source:string}={state:'awaiting-q2'};
export type ChecklistItem={id:string;field:typeof observationFields[number];required:boolean;label:{en:string;hy:string}};
export const visitChecklist:readonly ChecklistItem[]=[];

export type ChecklistState='measured'|'unknown'|'not-recorded';
/** Facts only: an item is measured or unknown when that visit holds such an
 * entry. It never infers clinical adequacy or completion. */
export function checklistProgress(items:readonly ChecklistItem[],visit:CareVisit|undefined):{item:ChecklistItem;state:ChecklistState}[]{
 return items.map(item=>{
  const entries=(visit?.entries??[]).filter(entry=>entry.payload.kind==='observation'&&entry.payload.field===item.field);
  const state:ChecklistState=entries.some(entry=>entry.payload.kind==='observation'&&entry.payload.state==='known')?'measured':entries.length?'unknown':'not-recorded';
  return{item,state};
 });
}
