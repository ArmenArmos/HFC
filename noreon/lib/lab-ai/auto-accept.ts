import {analyteByKey,matchAnalyte,normaliseUnit,toCanonical,type Analyte} from './catalogue';
import {parseDate,type LabValue} from './extraction';
import type {IdentityStatus} from './identity';

export const AUTO_ACCEPT_VERSION='lab-auto-accept-v2';
/** Inclusive auto-confirmation windows in canonical units. Measurement sanity, never clinical cuts.
 * Pending Armen's sign-off before real members. SQL carries the same table and accepted units.
 */
export const PLAUSIBLE:Record<string,readonly [number,number]>={
 total_cholesterol:[1,20], // mmol/l
 hdl_c:[0.1,5], // mmol/l
 ldl_c:[0.1,15], // mmol/l
 non_hdl_c:[0.1,20], // mmol/l
 triglycerides:[0.1,50], // mmol/l
 apob:[0.1,5], // g/l
 lpa:[0,1000], // nmol/l (no mass-to-molar conversion)
 hba1c:[3,20], // %
 fasting_glucose:[1,60], // mmol/l
 insulin:[0.1,1000], // uiu/ml
 homa_ir:[0,100], // dimensionless
 c_peptide:[0,50], // ng/ml
 creatinine:[10,3000], // umol/l
 egfr:[1,200], // ml/min/1.73m2
 uacr:[0,5000], // mg/mmol
 urea:[0.5,100], // mmol/l
 alt:[1,10000], // u/l
 ast:[1,10000], // u/l
 ggt:[1,10000], // u/l
 alp:[1,10000], // u/l
 bilirubin_total:[0.5,1000], // umol/l
 hemoglobin:[20,250], // g/l
 wbc:[0.1,500], // 10^9/l
 platelets:[1,3000], // 10^9/l
 ferritin:[1,100000], // ng/ml
 esr:[0,200], // mm/h
 crp:[0,500], // mg/l
 fibrinogen:[0.1,15], // g/l
 tsh:[0.001,500], // miu/l
 free_t4:[1,200], // pmol/l
 anti_tpo:[0,10000], // iu/ml
 uric_acid:[30,2000], // umol/l
 homocysteine:[1,500], // umol/l
 vitamin_d:[1,300], // ng/ml
 vitamin_b12:[10,5000], // pg/ml
 folate:[0.5,100], // ng/ml
};

/** Inclusive windows for the number as printed. Inverse images of PLAUSIBLE under the
 * catalogue conversions, rounded outward to six decimals. Canonical bounds still apply too.
 * Pending Armen's sign-off; SQL stores these alongside each unit's scale and offset.
 */
export const PRINTED_PLAUSIBLE:Record<string,Record<string,readonly [number,number]>>={
 total_cholesterol:{"mmol/l":[1.0,20.0],"mg/dl":[38.66976,773.395205]},
 hdl_c:{"mmol/l":[0.1,5.0],"mg/dl":[3.866976,193.348802]},
 ldl_c:{"mmol/l":[0.1,15.0],"mg/dl":[3.866976,580.046404]},
 non_hdl_c:{"mmol/l":[0.1,20.0],"mg/dl":[3.866976,773.395205]},
 triglycerides:{"mmol/l":[0.1,50.0],"mg/dl":[8.857395,4428.697963]},
 apob:{"g/l":[0.1,5.0],"mg/dl":[10.0,500.0]},
 lpa:{"nmol/l":[0.0,1000.0]},
 hba1c:{"%":[3.0,20.0],"mmol/mol":[9.269785,195.102755]},
 fasting_glucose:{"mmol/l":[1.0,60.0],"mg/dl":[18.018018,1081.081082]},
 insulin:{"uiu/ml":[0.1,1000.0],"mu/l":[0.1,1000.0],"pmol/l":[0.6,6000.0]},
 homa_ir:{"":[0.0,100.0]},
 c_peptide:{"ng/ml":[0.0,50.0],"nmol/l":[0.0,16.55]},
 creatinine:{"umol/l":[10.0,3000.0],"mg/dl":[0.113122,33.936652]},
 egfr:{"ml/min/1.73m2":[1.0,200.0],"ml/min":[1.0,200.0]},
 uacr:{"mg/mmol":[0.0,5000.0],"mg/g":[0.0,44247.787611]},
 urea:{"mmol/l":[0.5,100.0],"mg/dl":[3.003003,600.600601]},
 alt:{"u/l":[1.0,10000.0]},
 ast:{"u/l":[1.0,10000.0]},
 ggt:{"u/l":[1.0,10000.0]},
 alp:{"u/l":[1.0,10000.0]},
 bilirubin_total:{"umol/l":[0.5,1000.0],"mg/dl":[0.029239,58.479533]},
 hemoglobin:{"g/l":[20.0,250.0],"g/dl":[2.0,25.0]},
 wbc:{"10^9/l":[0.1,500.0],"10^3/ul":[0.1,500.0]},
 platelets:{"10^9/l":[1.0,3000.0],"10^3/ul":[1.0,3000.0]},
 ferritin:{"ng/ml":[1.0,100000.0],"ug/l":[1.0,100000.0]},
 esr:{"mm/h":[0.0,200.0]},
 crp:{"mg/l":[0.0,500.0],"mg/dl":[0.0,50.0]},
 fibrinogen:{"g/l":[0.1,15.0],"mg/dl":[10.0,1500.0]},
 tsh:{"miu/l":[0.001,500.0],"uiu/ml":[0.001,500.0]},
 free_t4:{"pmol/l":[1.0,200.0],"ng/dl":[0.0777,15.540016]},
 anti_tpo:{"iu/ml":[0.0,10000.0],"u/ml":[0.0,10000.0]},
 uric_acid:{"umol/l":[30.0,2000.0],"mg/dl":[0.504371,33.624748]},
 homocysteine:{"umol/l":[1.0,500.0]},
 vitamin_d:{"ng/ml":[1.0,300.0],"nmol/l":[2.5,750.0]},
 vitamin_b12:{"pg/ml":[10.0,5000.0],"pmol/l":[7.380073,3690.036901]},
 folate:{"ng/ml":[0.5,100.0],"nmol/l":[1.133786,226.75737]},
};

// Read whole unit tokens, never suffixes such as g/l inside mg/l or mmol/l inside mmol/mol.
// NFKC and normaliseUnit handle the same spelling variants as the extracted unit.
const SOURCE_UNIT=String.raw`(?:(?:[x×*]?\s*10\s*(?:\^|e)?\s*[39]|[\p{L}]+)\s*/\s*[\p{L}]+(?:\s*/\s*1[.,]73(?:\s*m(?:2|\^2)?)?)?(?:\s+hb)?|%)`;
// SQL is the source of truth. One optional flag, then one complete reference at most.
const SOURCE_WORD_END=String.raw`(?![\p{L}\p{N}])`;
const SOURCE_FLAG=String.raw`(?:hh|ll|h|l|high|low|выше|ниже|բարձր|ցածր|↑|↓|\*)${SOURCE_WORD_END}`;
const SOURCE_REFERENCE=new RegExp(String.raw`^(?:reference|ref|normal|range|норма|референсные\s+значения|референс|նորմ|հղումային)${SOURCE_WORD_END}\s*:?\s*`,'u');
const SOURCE_NUMBER=String.raw`[0-9]+(?:[.,][0-9]+)?`;
const SOURCE_REFERENCE_VALUE=new RegExp(String.raw`^(?:[<>≤≥]\s*${SOURCE_NUMBER}|${SOURCE_NUMBER}\s*[-–—]\s*${SOURCE_NUMBER})(?: ?(${SOURCE_UNIT})(?![\p{L}\p{N}/^]))?$`,'u');
const sourceReferenceKey=(s:string)=>s.replace(/\s+/gu,'').replace(/[–—]/gu,'-').replace(/,/g,'.');
function sourceUnitCorroborated(v:LabValue,a:Analyte,unit:string):boolean{
 if(!unit||!v.snippet)return false;
 const snippet=v.snippet.normalize('NFKC').toLowerCase();
 const tokenEnd=String.raw`(?![\p{L}\p{N}/^])`;
 for(const m of snippet.matchAll(new RegExp(String.raw`(?<![\p{L}/^])(${SOURCE_UNIT})${tokenEnd}`,'gu'))){
  const found=normaliseUnit(m[1]);
  if(Object.hasOwn(a.units,found)&&found!==unit)return false;
 }
 // Skip the printed test name, which can itself contain digits (HbA1c, B12, T4).
 const name=v.testName.normalize('NFKC').toLowerCase();
 const nameAt=name?snippet.indexOf(name):-1;
 const result=nameAt<0?snippet:snippet.slice(nameAt+name.length);
 const number=/[0-9]+(?:[.,][0-9]+)?/.exec(result);
 if(!number||number[0].replace(',','.')!==v.valueText.trim().replace(',','.'))return false;
 const before=result.slice(0,number.index);
 // Only whitespace and the column separators ; and | may precede the result.
 // Words, operators, decimal fragments and :/=/- separators all block confirmation.
 if(!/^[\s;|]*$/u.test(before))return false;
 const after=result.slice(number.index+number[0].length);
 const printedUnit=new RegExp(String.raw`^ ?(${SOURCE_UNIT})${tokenEnd}`,'u').exec(after);
 if(!printedUnit||normaliseUnit(printedUnit[1])!==unit)return false;
 let tail=after.slice(printedUnit[0].length).trim();
 // A range directly following the unit cannot be a result, even with a status flag later.
 if(/^\s*(?:[-–—]|to|до|մինչև)\s*[0-9]/u.test(tail))return false;
 const flag=new RegExp(`^${SOURCE_FLAG}`,'u').exec(tail);
 if(flag)tail=tail.slice(flag[0].length).trim();
 if(!tail)return true;
 // An unlabelled table column must be exactly the recorded numeric reference,
 // optionally followed by the same unit. Matching prose never opens this path.
 const ownReference=(v.refText??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
 const tableReference=tail.replace(/\s+/gu,' ');
 const tableBounds=SOURCE_REFERENCE_VALUE.exec(tableReference);
 if(ownReference&&SOURCE_REFERENCE_VALUE.test(ownReference)&&tableBounds&&
  (!tableBounds[1]||normaliseUnit(tableBounds[1])===unit)){
  const key=sourceReferenceKey(ownReference);
  if(sourceReferenceKey(tableReference)===key||
   (tableBounds[1]&&sourceReferenceKey(tableReference.slice(0,-tableBounds[1].length))===key))return true;
 }
 // Retain column separators before a reference, never after its closing bracket.
 tail=tail.replace(/^[\s,;:|]+/u,'');
 const bracket=/^(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$/u.exec(tail);
 let reference=bracket?(bracket[1]??bracket[2]).trim():tail;
 const label=SOURCE_REFERENCE.exec(reference);
 if(!bracket&&!label)return false;
 if(label)reference=reference.slice(label[0].length);
 const bounds=SOURCE_REFERENCE_VALUE.exec(reference);
 return bounds!==null&&(!bounds[1]||normaliseUnit(bounds[1])===unit);
}

/** Existing attention is generated for clinical significance, not model confidence. Keep those alerts.
 * Only an explained clinical mark is allowed; an unexplained mark/rule remains with the doctor.
 * The extractor records no numeric confidence. Every failed code check blocks confirmation.
 */
export function clinicalAttentionOnly(v:LabValue):boolean{
 if(v.attention===null)return v.attentionRule===null;
 if(v.attention==='threshold')return v.attentionRule===({hba1c:'THRESHOLD.hba1cUrgent',ldl_c:'THRESHOLD.phase2LdlHigh',total_cholesterol:'THRESHOLD.phase2TotalCholesterolHigh'} as Record<string,string>)[v.catalogueRef??''];
 if(v.attentionRule!==null)return false;
 if(v.attention==='lab_critical')return v.labFlag==='critical';
 return v.attention==='needs_doctor'&&(['high','low','abnormal'].includes(v.labFlag??'')||
  (v.value!==null&&((v.refLow!==null&&v.value<v.refLow)||(v.refHigh!==null&&v.value>v.refHigh))));
}

export type AutoAcceptReason='identity'|'mapping'|'checks'|'attention'|'value'|'date'|'plausibility';
/** All decisions are code-owned and checked again by SQL. Missing upload metadata fails closed. */
export function autoAcceptBlock(v:LabValue,identity:IdentityStatus,uploadedOn:string,today=uploadedOn):AutoAcceptReason|null{
 if(identity!=='match')return 'identity';
 if(!v.catalogueRef||matchAnalyte(v.testName)!==v.catalogueRef)return 'mapping';
 if(v.checks.length)return 'checks';
 if(!clinicalAttentionOnly(v))return 'attention';
 if(v.value===null||!Number.isFinite(v.value)||!/^\d{1,9}(?:[.,]\d{1,6})?$/.test(v.valueText.trim())||Number(v.valueText.trim().replace(',','.'))!==v.value)return 'value';
 const analyte=analyteByKey(v.catalogueRef);
 const canonical=analyte?toCanonical(analyte,v.value,v.unit??''):null;
 if(canonical===null||!Number.isFinite(canonical))return 'mapping';
 const unit=normaliseUnit(v.unit);
 if(!analyte||!sourceUnitCorroborated(v,analyte,unit))return 'mapping';
 const printed=PRINTED_PLAUSIBLE[v.catalogueRef]?.[unit];
 if(!printed||v.value<printed[0]||v.value>printed[1])return 'plausibility';
 const bounds=PLAUSIBLE[v.catalogueRef];
 if(!bounds||canonical<bounds[0]||canonical>bounds[1])return 'plausibility';
 if(!v.collectedOn||parseDate(v.collectedOn)!==v.collectedOn||parseDate(uploadedOn)!==uploadedOn||parseDate(today)!==today||
  v.collectedOn>today||v.collectedOn>uploadedOn||uploadedOn>today||Date.parse(uploadedOn)-Date.parse(v.collectedOn)>400*86_400_000)return 'date';
 return null;
}
export const autoAcceptable=(v:LabValue,identity:IdentityStatus,uploadedOn:string,today=uploadedOn)=>autoAcceptBlock(v,identity,uploadedOn,today)===null;
