import {pick,type Locale} from '@/lib/locale';

/** The existing source means typed by the member, with no device or clinician verification. A caregiver's typed
 * reading for the member (WP F, 'caregiver_reported') is unverified the same way.
 * Provenance changes display/aggregate eligibility only, never the safety checks. */
export const isUnverifiedBp=(row:{entry_source?:string|null;entrySource?:string|null})=>{
 const source=row.entry_source??row.entrySource;
 return source==='patient_text_entry'||source==='caregiver_reported';
};

/** STAGING hy/ru wording: needs Armen/Yesayi sign-off before go-live. */
export const unverifiedBpLabel=(locale:Locale)=>pick(locale,{
 en:'Member-reported, not verified',hy:'Անդամի հաղորդածը, չստուգված',ru:'Со слов участника, не проверено',
});

/** WP F: a reading an authorised caregiver typed for the member. DRAFT hy/ru wording, same sign-off as above. */
export const caregiverReportedBpLabel=(locale:Locale)=>pick(locale,{
 en:'Caregiver-reported, not verified',hy:'Խնամողի հաղորդածը, չստուգված',ru:'Со слов ухаживающего, не проверено',
});

export function bpObservationCounts(rows:readonly {entry_source?:string|null;entrySource?:string|null}[],locale:Locale){
 const reported=rows.filter(isUnverifiedBp).length,verified=rows.length-reported;
 const counts=pick(locale,{en:`${verified} verified reading${verified===1?'':'s'}`,hy:`${verified} ստուգված չափում`,ru:`${verified} проверенных измерений`});
 return reported?`${counts} · ${reported} ${unverifiedBpLabel(locale).toLocaleLowerCase(locale)}`:counts;
}
