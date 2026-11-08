import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {LAB_ANALYTES} from '@/lib/lab-ai/catalogue';
import {EXTRA} from '@/lib/staff-zoe/analyte';

/** Missing catalogue rows only. Identity aliases, never thresholds or interpretations.
 * K/Na names already appear in analyte-names and staff-zoe/analyte; urinalysis and
 * NT-proBNP are named by TEST_CATALOGUE. Keep additions here; SQL is generated below. */
export const REQUIRED_LAB_EXTRA_ROWS=[
 {key:'ldl_c',row:'LDL-C',aliases:['LDL cholesterol (LDL-C)','LDL-cholesterol','LDL cholesterol (calculated)','cholesterol LDL']},
 {key:'hdl_c',row:'HDL-C',aliases:['HDL cholesterol (HDL-C)','HDL-cholesterol']},
 {key:'total_cholesterol',row:'Ընդհանուր խոլեստերին',aliases:['Total cholesterol (TC)','cholesterol total']},
 {key:'potassium',row:'Կալիում (K⁺)',aliases:['Կալիում (K⁺)','potassium','kalium','k+','k','կալիում','калий']},
 {key:'sodium',row:'Նատրիում (Na⁺)',aliases:['Նատրիում (Na⁺)','sodium','natrium','na+','na','նատրիում','натрий']},
 {key:'urinalysis',row:'Միզի ընդհանուր',aliases:['urinalysis','urine analysis','Միզի ընդհանուր','Մեզի ընդհանուր հետազոտություն','общий анализ мочи']},
 {key:'red_blood_cells',row:'Արյան ընդհանուր + լեյկոֆորմուլա',aliases:['red blood cells','rbc']},
 {key:'nt_probnp',row:'NT-proBNP',aliases:['nt-probnp','nt probnp']},
] as const;

export const foldLabName=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}()/+.\-]+/gu,' ').replace(/\s+/g,' ').trim();
/** Completeness is explicit, never inferred from shared row membership.
 * Sources: TEST_CATALOGUE catalogueRef/name/whatItTells, LAB_ANALYTES row/key.
 * CBC's differential and urinalysis's infection signs are not enumerated by the
 * catalogue. Keep their known components for missing-value feedback, but refuse
 * receipts until the clinical catalogue defines the complete set. */
export const REQUIRED_LAB_PANELS:Record<string,{components:readonly string[];undefinedReason?:string}>={
 // tests.ts:87-92, 195, 224, 255, 285, 317, 352, 380, 436, 464.
 'tsh':{components:['tsh']},
 'nt-probnp':{components:['nt_probnp']},
 'insulin-homa':{components:['insulin','homa_ir']},
 'lipid-panel':{components:['total_cholesterol','hdl_c','ldl_c','triglycerides']},
 'apob':{components:['apob']},
 'lpa':{components:['lpa']},
 'hba1c':{components:['hba1c']},
 'hba1c-glucose':{components:['hba1c','fasting_glucose']},
 'creatinine-egfr':{components:['creatinine','egfr']},
 'urine-acr':{components:['uacr']},
 'potassium':{components:['potassium']},
 'sodium':{components:['sodium']},
 // tests.ts:478,492: haemoglobin, red/white cells, platelets, plus differential.
 'cbc-hb':{components:['hemoglobin','red_blood_cells','wbc','platelets'],undefinedReason:'The catalogue does not define the differential components.'},
 // tests.ts:394: blood, protein, sugar and signs of infection, without a component set.
 'urinalysis':{components:[],undefinedReason:'The catalogue does not define the complete urinalysis components.'},
};
export const requiredLabMapping={
 panels:REQUIRED_LAB_PANELS,
 aliases:[...LAB_ANALYTES,...EXTRA,...REQUIRED_LAB_EXTRA_ROWS].flatMap(a=>a.aliases.map(alias=>({key:a.key,alias:foldLabName(alias)}))).sort((a,b)=>b.alias.length-a.alias.length),
 groups:Object.fromEntries(TEST_CATALOGUE.filter(t=>['blood_draw','urine_sample'].includes(t.method)).map(t=>{
  const refs=t.catalogueRef==null?[]:Array.isArray(t.catalogueRef)?t.catalogueRef:[t.catalogueRef];
  return [t.id,refs.map(row=>[...LAB_ANALYTES,...REQUIRED_LAB_EXTRA_ROWS].filter(a=>a.row===row).map(a=>a.key))];
 })),
};
// Required evidence needs an exact identity alias: urine potassium and TSH
// receptor antibodies must not supply potassium and TSH.
export function requiredLabAnalyte(name:string):string|null{
 const folded=foldLabName(name);
 return requiredLabMapping.aliases.find(a=>folded===a.alias)?.key??null;
}
export function requiredLabValues<T extends {name:string}>(testId:string,values:readonly T[]):T[]{
 const keys=Object.hasOwn(requiredLabMapping.groups,testId)?requiredLabMapping.groups[testId].flat():[];
 return values.filter(v=>keys.includes(requiredLabAnalyte(v.name)??''));
}
/** Known missing components are useful even when the full definition is unavailable. */
export function missingRequiredLabComponents(testId:string,values:readonly {name:string}[]):string[]{
 const found=new Set(values.map(v=>requiredLabAnalyte(v.name)));
 return (requiredLabMapping.panels[testId]?.components??[]).filter(key=>!found.has(key));
}
export function coversRequiredLabTest(testId:string,values:readonly {name:string}[]):boolean{
 const panel=requiredLabMapping.panels[testId];
 return Object.hasOwn(requiredLabMapping.panels,testId)&&!!panel&&!panel.undefinedReason&&panel.components.length>0&&missingRequiredLabComponents(testId,values).length===0;
}
const yerevanDay=(instant:string)=>new Date(Date.parse(instant)+4*60*60*1000).toISOString().slice(0,10);
/** Investigation evidence uses the questionnaire's Yerevan calendar day as its earliest date. */
export function labDateEligible(collectedOn:string,questionnaireAt:string|null|undefined,now=new Date()):boolean{
 if(!questionnaireAt||!Number.isFinite(Date.parse(questionnaireAt))||!/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)||!Number.isFinite(Date.parse(collectedOn)))return false;
 return collectedOn>=yerevanDay(questionnaireAt)&&collectedOn<=yerevanDay(now.toISOString());
}
