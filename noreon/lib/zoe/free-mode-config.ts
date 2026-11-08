/**
 * Zoe free mode: the clinical defaults that Armen may change (lead 19 Oct: "keep each configurable where cheap"; Zoe spec v1
 * §15: clinical rules change only through Armen or Yesayi). Sources, in order of authority: Armen's clinical dialogue dataset
 * v2.0, Zoe specification v1 (output/zoe-health-answers/ZOE_SPEC_v1_2026-10-19.md, draft for sign-off), then guidelines.
 * Rows marked `proposed` fill gaps the dataset leaves and are PENDING ARMEN (spec §16 decisions 6, 7, 8, 28, 29).
 */
import {THRESHOLD} from '@/lib/clinical/rules/thresholds';

export const FREE_MODE_CONFIG_VERSION='zoe-free-config-8';

type Row={value:string;source:'dataset'|'proposed'};
/** Armen, answers 11 and 12 (2 Nov): multiples of the lab's own upper limit. The rows of criticalLabs and the prompt's words both read these. */
const ALT_TIMES={soon:3,today:5},CK_TIMES={withSymptoms:5,today:10};
const ALT=/(?<![\p{L}])(?:alt|alat|sgpt|алт|алат|ալտ)(?![\p{L}])|alanine|аланин|ալանին/iu;
const CK=/(?<![\p{L}])(?:ck|cpk|кк|кфк|կկ)(?![\p{L}])(?!\s*-?\s*(?:mb|мв))|creatine (?:phospho)?kinase|креатин(?:фосфо)?киназ|կրեատին(?:ֆոսֆո)?կինազ/iu;
/** Spec §8 thresholds, as the prompt states them (the deterministic floors below use the numeric ones). */
export const SPEC_THRESHOLDS:Readonly<Record<string,Row>>=Object.freeze({
 bpVeryHigh:{value:'BP of 180/110 or more: 5 minutes of rest and a repeat before any alert; on repeat, 180/120 or more same day without symptoms, below that the doctor within 48 hours; any symptom 103',source:'proposed'},
 bpPregnancy:{value:'pregnancy after 20 weeks, new BP of 140/90 or more: same day without symptoms; with raised BP, any of headache, vision change, upper abdominal pain, sudden swelling or shortness of breath: 103 or the maternity unit',source:'proposed'},
 bpLow:{value:'systolic below 90, or a new systolic below 100 on BP medicines, with dizziness on standing or near-fainting: same day; with fainting plus injury, chest pain, confusion or cold clammy skin: 103; long-standing without symptoms: self-care',source:'proposed'},
 pulseSafetyNet:{value:'a resting pulse of 130 or more, or below 40 awake in a non-athlete, confirmed after 5 minutes of rest: same day; otherwise symptoms decide',source:'proposed'},
 glucoseHigh:{value:'glucose of 13.9 mmol/L (250 mg/dL) or more with thirst, frequent urination or weight loss: same day; two symptom-free readings: contact the doctor within 24 hours; vomiting, abdominal pain, deep breathing or drowsiness at any glucose: 103',source:'dataset'},
 sglt2:{value:'illness, poor intake, nausea or vomiting on an SGLT2 inhibitor at any glucose: same day (ketone check)',source:'dataset'},
 hypoConscious:{value:'glucose below 3.9 mmol/L, conscious and able to swallow: 15 to 20 g of fast carbohydrate, recheck after 15 minutes, repeat once, then a snack; the doctor is told if below 3.0 or if help was needed',source:'proposed'},
 criticalLabs:{value:'potassium of 6.0 or more or 2.8 or less; sodium of 125 or less or 155 or more; laboratory glucose of 2.8 or less or 22 or more; haemoglobin of 70 g/L or less; platelets of 20 or less; corrected calcium of 3.0 or more; INR of 5 or more on warfarin; eGFR fall of more than 25%; any troponin above the reference: same day (103 with symptoms)',source:'proposed'},
 hfWeight:{value:'heart-failure weight gain over 2 kg in 3 days, rising ankle swelling or more pillows: same day',source:'dataset'},
 tsh:{value:'TSH 4.5 to 10 with normal free T4: planned, repeat in 6 to 8 weeks; TSH over 10, or low free T4 with symptoms, or below 0.1: the doctor in the coming days',source:'dataset'},
 enzymesToday:{value:`ALT over ${ALT_TIMES.today} times the lab's upper limit; CK over ${CK_TIMES.today} times it, or over ${CK_TIMES.withSymptoms} times with muscle symptoms (a statin is paused only on the doctor's advice)`,source:'dataset'},
 enzymesSoon:{value:`ALT over ${ALT_TIMES.soon} times the lab's upper limit`,source:'dataset'},
 altStatin:{value:'ALT/AST up to about 3 times the upper limit on a statin without symptoms: the doctor in the coming days, do not stop the statin; jaundice, dark urine or severe right upper abdominal pain: same day',source:'dataset'},
});

export const FREE_MODE_CONFIG=Object.freeze({
 /** Dataset S005/S006 (spec §8): the one BP rule's doctor-today cut (lib/clinical/rules/bp-check.ts). The pipeline reaches it through bp-chat.ts, on a repeat. */
 bpSameDay:{systolic:THRESHOLD.bpDoctorTodaySystolic,diastolic:THRESHOLD.bpDoctorTodayDiastolic},
 /** Task 14 (Armen, 2 Nov): a level comes down inside a chat only below this reading, and falling (health-answer.ts LEVEL_DOWN). */
 levelDownBp:{systolic:180,diastolic:110},
 /** Dataset S020 (spec §8): triglycerides of 10 mmol/L or more are same-day even without symptoms. */
 triglyceridesSameDayMmol:10,
 /** Dataset S056 (spec §8): a glucose of 13.9 mmol/L (250 mg/dL) or more with thirst, frequent urination or weight loss is same-day. */
 glucoseSameDayMmol:13.9,
 /** STAGING, pending Armen sign-off: own pulse below 50 with dizziness, lightheadedness or weakness in the same message is same-day. */
 slowPulseBpm:50,
 /** Spec v1.1 Appendix A Level 2 (Armen 20 Oct; same-day-floors.ts): potassium of 6.0 mmol/L or more, or 2.8 or less, is same-day. */
 potassiumHighMmol:6.0,
 potassiumLowMmol:2.8,
 /** Armen, 2 Nov (Task 9; same-day-floors.ts): over 20 weeks of pregnancy, a new BP of 140/90 or more is same-day. */
 pregnancyBpSystolic:140,
 pregnancyBpDiastolic:90,
 /** Spec v1.1 Appendix A Level 2 (dataset S041): with heart failure, a weight gain of 2 kg or more in 3 days or fewer is same-day. */
 hfWeightGainKg:2,
 hfWeightGainDays:3,
 /** Spec §8 proposed rows (pending Armen) folded into the same-day prompt line. */
 thresholdsProse:[SPEC_THRESHOLDS.bpLow!.value,SPEC_THRESHOLDS.pulseSafetyNet!.value,SPEC_THRESHOLDS.glucoseHigh!.value,SPEC_THRESHOLDS.sglt2!.value,SPEC_THRESHOLDS.criticalLabs!.value,SPEC_THRESHOLDS.enzymesToday!.value,SPEC_THRESHOLDS.bpPregnancy!.value].join('; '),
 /** Spec §10.2: forwarded to the doctor without asking (besides 103 and red flags, which take their own path). */
 autoForwardReasons:['same_day','refused_103','stopped_medicine','self_sourced_medicine','serious_side_effect','possible_cancer_sign','cancer_history_new_symptom',
  'hypo_below_3_or_help','pregnancy_on_medicine','critical_lab','self_harm','member_request','zoe_could_not_answer']as readonly string[],
 /** Spec §10.2: every same-day level is forwarded without asking. */
 autoForwardUrgencies:['same_day']as readonly string[],
 /** Armen's 20 decisions, task 3 (coach-first): a coming-days reply always leaves a quiet note in the doctor's queue, never a care alert. */
 quietForwardUrgencies:['doctor_soon']as readonly string[],
 /** SPEC_THRESHOLDS.criticalLabs as numbers, for a result the model no longer reads until the doctor has reviewed it (task 12; same-day-floors.ts).
  * Potassium, troponin and triglycerides have their own floors. The eGFR fall needs an earlier value, so it is not here. overHigh is strict and needs the row's upper limit.
  * Same-day unless level says otherwise; muscleSymptoms needs them in the member's messages; statinLine adds the statin sentence. */
 criticalLabs:[
  {marker:/sodium|натри|նատրիում/iu,unit:/mmol|meq|ммоль/iu,atMost:125,atLeast:155},
  {marker:/glucose|глюкоз|գլյուկոզ/iu,unit:/mmol|ммоль/iu,atMost:2.8,atLeast:22},
  {marker:/h(?:a)?emoglobin|гемоглобин|հեմոգլոբին/iu,unit:/^(?:g|г)\/(?:l|л)$/iu,atMost:70},
  {marker:/platelet|тромбоцит|թրոմբոցիտ/iu,unit:/(?:)/u,atMost:20},
  {marker:/calcium|кальци|կալցիում/iu,unit:/mmol|ммоль/iu,atLeast:3},
  {marker:/(?<![\p{L}])(?:inr|мно)(?![\p{L}])/iu,unit:/(?:)/u,atLeast:5},
  {marker:ALT,unit:/(?:)/u,overHigh:ALT_TIMES.soon,level:'doctor_soon'},
  {marker:ALT,unit:/(?:)/u,overHigh:ALT_TIMES.today},
  {marker:CK,unit:/(?:)/u,overHigh:CK_TIMES.withSymptoms,muscleSymptoms:true,statinLine:true},
  {marker:CK,unit:/(?:)/u,overHigh:CK_TIMES.today},
 ]as readonly {marker:RegExp;unit:RegExp;atMost?:number;atLeast?:number;overHigh?:number;level?:'doctor_soon';muscleSymptoms?:boolean;statinLine?:boolean}[],
 /** Spec §4 / §16 decision 1: the dataset's three areas; outside them general information only, unless it is an emergency. */
 scopeAreas:'heart and blood vessels (blood pressure, cholesterol, rhythm, heart failure), endocrine and metabolism (diabetes, thyroid, weight, liver fat, adrenal, bone and vitamin D), and cancer screening and cancer warning signs',
 /** Spec §12 / §16 decision 2: one short introduction per conversation, and whenever asked. */
 introduceOnce:true,
 /** Questionnaire disputes still await clinical review. Warning repetition follows the
  * full-warning-once rule in the conversation prompt and pipeline (Armen, 31 Oct). */
 pendingClinical:{
  /** Question 5: a questionnaire condition the member disputes still counts for the level until a doctor confirms. */
  disputedConditionCounts:true as boolean,
 },
 /** Spec §11 / §16 decision 22: Emotional Support Hotline (STAGING: verify hours and staffing before go-live). */
 crisisLine:'0800 00 900',
});
