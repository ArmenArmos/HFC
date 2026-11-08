import {DRAFT_FIELDS,type DraftField} from './contracts';

export type DraftFieldDisposition='accepted'|'edited'|'rejected'|'not-decided';
export type DraftFieldDecisions=Partial<Record<DraftField,{accepted?:boolean;rejected?:boolean}>>;

/** Derive both the checklist and submitted text from the current editor values. */
export function deriveDraftFields(proposed:Record<DraftField,string>,current:Record<DraftField,string>,decisions:DraftFieldDecisions){
 const fields={} as Record<DraftField,DraftFieldDisposition>;
 const values={} as Record<DraftField,string>;
 const excludedFields:DraftField[]=[];
 for(const key of DRAFT_FIELDS){
  const value=current[key],decision=decisions[key];
  fields[key]=!value.trim()?'rejected':value!==proposed[key]?'edited':decision?.accepted&&!decision.rejected?'accepted':'not-decided';
  values[key]=fields[key]==='rejected'?'':value;
  if(fields[key]==='rejected')excludedFields.push(key);
 }
 return {fields,values,excludedFields};
}
