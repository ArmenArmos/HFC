import {isUnverifiedBp,unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import {z} from 'zod';
import {TEXT_RULES,SYMPTOM_RED_FLAGS_VERSION,type LatestReading} from './red-flags';
import type {IntakeRecord} from './intake';
import type {SheetQuestion,SymptomSheet} from './sheets';

/**
 * The doctor summary of one symptom intake. Built ONLY from the structured record (answers the
 * deterministic checks accepted, red flags, the stored reading), never free text from the model,
 * so it cannot say anything the member did not say. Free-text answers are the member's own words.
 * The staff app renders it (summaryLines) in English or Armenian; it is stored as this JSON.
 */
export const SUMMARY_VERSION='zoe-symptom-summary-1';
export const intakeEndings=['complete','member_stopped','red_flag','expired','about_someone_else','turn_limit','partial']as const;
export type IntakeEnding=typeof intakeEndings[number];

const display=z.object({en:z.string(),hy:z.string()});
export const symptomSummarySchema=z.strictObject({
 version:z.string(),
 sheet:z.strictObject({id:z.string(),version:z.number().int(),status:z.enum(['draft','signed']),label:display}),
 ending:z.enum(intakeEndings),
 language:z.enum(['en','hy','ru']),
 items:z.array(z.strictObject({id:z.string(),role:z.string(),label:display,
  answer:z.strictObject({kind:z.enum(['yes','no','unknown','choice','scale','text']),value:z.union([z.string(),z.number()]),display}).nullable(),
  redFlagQuestion:z.boolean()})),
 redFlags:z.strictObject({hits:z.array(z.strictObject({id:z.string(),rf:z.string().nullable(),source:z.string()})),textRulesVersion:z.string(),textRulesChecked:z.number().int()}),
 latestReading:z.strictObject({entrySource:z.string().nullable().optional(),systolic:z.number().int(),diastolic:z.number().int(),minutesAgo:z.number().int()}).nullable(),
 /** What the member asked during the intake, in their own words (lead 18 Oct). Absent in older summaries. */
 memberAsked:z.array(z.string().max(300)).max(5).optional(),
});
export type SymptomSummary=z.infer<typeof symptomSummarySchema>;

const YN={yes:{en:'Yes',hy:'Այո'},no:{en:'No',hy:'Ոչ'},unknown:{en:'Not sure',hy:'Վստահ չէ'}};

function answerOf(q:SheetQuestion,v:IntakeRecord['answers'][string]|undefined):SymptomSummary['items'][number]['answer']{
 if(!v)return null;
 if(v.value==='unknown')return {kind:'unknown',value:'unknown',display:YN.unknown};
 switch(q.answer.kind){
  case 'yes_no':return v.value==='yes'||v.value==='no'?{kind:v.value,value:v.value,display:YN[v.value]}:null;
  case 'choice':{const o=q.answer.options.find(x=>x.id===v.value);return o?{kind:'choice',value:o.id,display:{en:o.label.en,hy:o.label.hy}}:null;}
  case 'scale':return typeof v.value==='number'?{kind:'scale',value:v.value,display:{en:`${v.value} of 10`,hy:`${v.value}՝ 10-ից`}}:null;
  // The member's own words, unchanged.
  case 'text':return {kind:'text',value:String(v.value),display:{en:String(v.value),hy:String(v.value)}};
 }
}

export function buildSummary(sheet:SymptomSheet,record:IntakeRecord,opts:{ending:IntakeEnding;language:'en'|'hy'|'ru';latestReading?:LatestReading}):SymptomSummary{
 const r=opts.latestReading??null;
 return symptomSummarySchema.parse({version:SUMMARY_VERSION,sheet:{id:sheet.id,version:sheet.version,status:sheet.status,label:sheet.label},ending:opts.ending,language:opts.language,
  items:sheet.questions.map(q=>({id:q.id,role:q.role,label:q.label,answer:answerOf(q,record.answers[q.id]),redFlagQuestion:!!q.redFlagIfYes})),
  redFlags:{hits:record.redFlags.map(h=>({id:h.id,rf:h.rf,source:h.source})),textRulesVersion:SYMPTOM_RED_FLAGS_VERSION,textRulesChecked:TEXT_RULES.length},
  latestReading:r?{systolic:r.systolic,diastolic:r.diastolic,minutesAgo:r.minutesAgo,...(r.entrySource?{entrySource:r.entrySource}:{})}:null,
  ...(record.memberAsked?.length?{memberAsked:record.memberAsked.map(q=>q.text)}:{})});
}

type L='en'|'hy';
const t=(l:L,en:string,hy:string)=>l==='hy'?hy:en;
const ENDING:Record<IntakeEnding,{en:string;hy:string}>={
 complete:{en:'All sheet questions answered',hy:'Բոլոր հարցերին պատասխանել է'},member_stopped:{en:'Member stopped the questions',hy:'Անդամը դադարեցրել է հարցերը'},
 red_flag:{en:'Stopped for a red flag: member shown the 103 urgent path',hy:'Դադարեցվել է կարմիր դրոշի պատճառով. անդամին ցույց է տրվել 103 շտապ ուղին'},
 expired:{en:'Member stopped replying (12 hours)',hy:'Անդամը դադարել է պատասխանել (12 ժամ)'},
 about_someone_else:{en:'Member said the symptom is someone else’s',hy:'Անդամն ասել է, որ ախտանիշը ուրիշինն է'},turn_limit:{en:'Question limit reached',hy:'Հարցերի սահմանաչափը լրացել է'},
 partial:{en:'Partially answered: Zoe could not continue the questions',hy:'Մասամբ է պատասխանել. Զոյան չկարողացավ շարունակել հարցերը'},
};
const HIT:Record<string,{en:string;hy:string}>={
 thunderclap:{en:'Sudden, worst-ever headache',hy:'Հանկարծակի, կյանքում ամենաուժեղ գլխացավ'},weakness_numbness:{en:'Weakness or numbness',hy:'Թուլություն կամ թմրածություն'},
 speech_trouble:{en:'Trouble speaking',hy:'Խոսելու դժվարություն'},vision_loss:{en:'Loss of vision or double vision',hy:'Տեսողության կորուստ կամ կրկնակի տեսողություն'},
 confusion:{en:'Confusion',hy:'Շփոթվածություն'},fever_stiff_neck:{en:'Fever with stiff neck',hy:'Ջերմություն՝ պարանոցի կարկամությամբ'},head_injury:{en:'Head injury',hy:'Գլխի վնասվածք'},
 fainting:{en:'Fainting',hy:'Ուշագնացություն'},chest_spreads:{en:'Chest discomfort spreading',hy:'Տարածվող անհանգստություն կրծքավանդակում'},chest_pain:{en:'Chest pain or pressure',hy:'Կրծքավանդակի ցավ կամ ճնշում'},
 breathless_at_rest:{en:'Short of breath at rest',hy:'Հանգստի ժամանակ շնչարգելություն'},face_lips_tongue:{en:'Swelling of face, lips or tongue',hy:'Դեմքի, շրթունքների կամ լեզվի այտուց'},
 one_leg_red_painful:{en:'One leg swollen, red or painful',hy:'Մեկ ոտքն այտուցված, կարմիր կամ ցավոտ'},bp_crisis:{en:'Blood pressure 180/110 or more written with a symptom',hy:'Ախտանիշի հետ նշված 180/110 կամ ավելի ճնշում'},
 bp_crisis_reading:{en:'Stored reading 180/110 or more in the last 24 hours, with a symptom',hy:'Վերջին 24 ժամում 180/110 կամ ավելի գրանցված ճնշում՝ ախտանիշի հետ'},
 right_now:{en:'Happening right now',hy:'Հենց հիմա է'},at_rest_now:{en:'Short of breath right now at rest',hy:'Հենց հիմա հանգստի ժամանակ շնչարգելություն'},
 urgent_words:{en:'Urgent words (the urgent word list)',hy:'Շտապ բառեր (շտապ բառացանկ)'},
 model_suspected:{en:'Zoe’s model suspected an emergency (not cleared by any rule)',hy:'Զոյայի մոդելը կասկածել է շտապ վիճակ'},
};
const SOURCE:Record<string,{en:string;hy:string}>={text:{en:'member’s words',hy:'անդամի խոսքեր'},reading:{en:'stored reading',hy:'գրանցված չափում'},answer:{en:'answer',hy:'պատասխան'},model:{en:'model',hy:'մոդել'}};

/** The summary as lines for the staff app and the run record. Draft sheets say so. */
export function summaryLines(s:SymptomSummary,l:L):string[]{
 const answered=s.items.filter(i=>i.answer).length;
 const lines=[`${s.sheet.label[l]} · ${t(l,`${answered} of ${s.items.length} questions answered`,`${s.items.length}-ից ${answered} հարցին պատասխանել է`)} · ${ENDING[s.ending][l]}`];
 if(s.sheet.status==='draft')lines.push(t(l,'Questions from a DRAFT sheet, not yet signed off clinically.','Հարցերը ՆԱԽՆԱԿԱՆ թերթիկից են, դեռ կլինիկորեն հաստատված չեն։'));
 lines.push(s.redFlags.hits.length?`${t(l,'Red flags','Կարմիր դրոշներ')}: ${s.redFlags.hits.map(h=>`${(HIT[h.id]??{en:h.id,hy:h.id})[l]}${h.rf?` (${h.rf})`:''}, ${(SOURCE[h.source]??{en:h.source,hy:h.source})[l]}`).join('; ')}`
  :t(l,'Red flags: none found by the rules or in the answers.','Կարմիր դրոշներ. կանոններով և պատասխաններում չեն գտնվել։'));
 for(const i of s.items)lines.push(`${i.label[l]}: ${i.answer?i.answer.display[l]:t(l,'not answered','չի պատասխանել')}`);
 for(const q of s.memberAsked??[])lines.push(`${t(l,'Member asked','Անդամը հարցրել է')}: «${q}»`);
 if(s.latestReading)lines.push(`${t(l,'Latest stored blood pressure','Վերջին գրանցված ճնշումը')}: ${s.latestReading.systolic}/${s.latestReading.diastolic}${isUnverifiedBp(s.latestReading)?` (${unverifiedBpLabel(l)})`:''} (${Math.round(s.latestReading.minutesAgo/60)} ${t(l,'h ago','ժ առաջ')})`);
 else lines.push(t(l,'No stored blood pressure reading.','Գրանցված ճնշման չափում չկա։'));
 return lines;
}

/** One short line for the Zoe run record (zoe_runs.summary): no answers, no member words. */
export const runSummaryLine=(s:SymptomSummary)=>`Symptom intake (${s.sheet.label.en}, sheet v${s.sheet.version} ${s.sheet.status}): ${s.items.filter(i=>i.answer).length} of ${s.items.length} answered; ${ENDING[s.ending].en.toLowerCase()}; red flags: ${s.redFlags.hits.length?s.redFlags.hits.map(h=>h.id).join(', '):'none found'}.`;
