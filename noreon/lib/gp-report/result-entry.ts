import {z} from 'zod';

export const resultEntryFields=['score2_percent','potassium','ecg_lvh','ecg_ischaemia','echo_done','ahi'] as const;
export type ResultEntryField=typeof resultEntryFields[number];
/** Input sanity only. Clinical thresholds belong to the engine. */
export const resultEntrySchema=z.object({
 memberId:z.uuid(),field:z.enum(resultEntryFields),value:z.union([z.number().finite(),z.enum(['yes','no']),z.null()]),
 observedOn:z.iso.date(),submissionId:z.uuid(),
}).superRefine((entry,ctx)=>{
 if(entry.value===null)return;
 const bounds:Partial<Record<ResultEntryField,[number,number]>>={score2_percent:[0,100],potassium:[1,12],ahi:[0,200]};
 const range=bounds[entry.field];
 if(range?(typeof entry.value!=='number'||entry.value<range[0]||entry.value>range[1]):typeof entry.value!=='string')ctx.addIssue({code:'custom',path:['value'],message:'Invalid entry'});
});
export type SaveResultEntryResult={status:'saved'|'off'|'access'|'invalid'|'outcome-unknown'};
