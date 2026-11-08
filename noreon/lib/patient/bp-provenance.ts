import {pick,type Locale} from '@/lib/locale';

/** The existing source means typed by the member, with no device or clinician verification.
 * Provenance changes display/aggregate eligibility only, never the safety checks. */
export const isUnverifiedBp=(row:{entry_source?:string|null;entrySource?:string|null})=>
 (row.entry_source??row.entrySource)==='patient_text_entry';

/** STAGING hy/ru wording: needs Armen/Yesayi sign-off before go-live. */
export const unverifiedBpLabel=(locale:Locale)=>pick(locale,{
 en:'Member-reported, not verified',hy:'Անդամի հաղորդածը, չստուգված',ru:'Со слов участника, не проверено',
});

export function bpObservationCounts(rows:readonly {entry_source?:string|null;entrySource?:string|null}[],locale:Locale){
 const reported=rows.filter(isUnverifiedBp).length,verified=rows.length-reported;
 const counts=pick(locale,{en:`${verified} verified reading${verified===1?'':'s'}`,hy:`${verified} ստուգված չափում`,ru:`${verified} проверенных измерений`});
 return reported?`${counts} · ${reported} ${unverifiedBpLabel(locale).toLocaleLowerCase(locale)}`:counts;
}
