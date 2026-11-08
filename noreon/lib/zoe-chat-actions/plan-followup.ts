import {evaluateAdherence,postApprovalLabs} from '@/lib/clinical/zones/evaluate';
import {taskFromZone} from '@/lib/care-queue/contracts';
import {z} from 'zod';

export const adherenceEpisode=z.strictObject({episode:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),missedMeasurements:z.number().int().nonnegative(),missedDoseDays:z.number().int().nonnegative(),wantsToStopStatin:z.boolean()});
export const stopIntent=z.strictObject({id:z.uuid(),name:z.string(),episode:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)});
export type StopIntent=z.infer<typeof stopIntent>;
export const adherenceContext=z.strictObject({episodes:z.array(adherenceEpisode),stops:z.array(stopIntent)});
/** Explicit generic names only. Brands and broad 'lipid_lowering' classes stay unknown. */
export const explicitStatin=(name:string)=>/^(?:atorvastatin|rosuvastatin|simvastatin|pravastatin|pitavastatin|fluvastatin|аторвастатин|розувастатин|симвастатин|правастатин|питавастатин|флувастатин|ատորվաստատին|ռոզուվաստատին)$/iu.test(name.trim());
export function adherenceTasks(memberId:string,episode:z.infer<typeof adherenceEpisode>,at:string){
 const result=evaluateAdherence(episode);
 // The mandatory stop reply says both nurse and doctor. Preserve the nurse rule and copy that same review to the doctor.
 if(episode.wantsToStopStatin)result.queues=['nurse','physician'];
 return taskFromZone(result,{memberId,sourceRef:episode.episode,at,redFlagsStatus:'unknown',suggestedAction:episode.wantsToStopStatin?'review_stop_request':null,summary:{missedMeasurements:episode.missedMeasurements,missedDoseDays:episode.missedDoseDays,wantsToStopStatin:episode.wantsToStopStatin}});
}
export const labPublication=z.strictObject({memberId:z.uuid(),planId:z.uuid(),publishedOn:z.string(),changes:z.array(z.strictObject({drugClass:z.string().nullable()}))});
const drugClass=z.enum(['ace_inhibitor','arb','diuretic','statin','ezetimibe']);
export function followupLabTasks(publication:z.infer<typeof labPublication>){
 const changes=publication.changes.flatMap(c=>{const parsed=drugClass.safeParse(c.drugClass);return parsed.success?[{drugClass:parsed.data,on:publication.publishedOn}]:[];});
 const windows=postApprovalLabs(changes);
 // One organizational task per test window, even if two changed medicines share it.
 const distinct=windows.filter((w,i)=>windows.findIndex(x=>x.fromOn===w.fromOn&&x.toOn===w.toOn)===i);
 return {unknownDrugClasses:publication.changes.length-changes.length,tasks:distinct.map(w=>({
  memberId:publication.memberId,queue:'admin' as const,zone:null,reason:'followup_labs_due',ruleVersion:w.ruleVersion,redFlagsStatus:null,
  suggestedAction:`book_labs_${w.fromOn}_${w.toOn}`,summary:{},slaDeadline:null,sourceRef:`labs:${publication.planId}:${w.fromOn}:${w.toOn}`,
 }))};
}
