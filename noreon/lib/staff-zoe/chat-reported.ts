import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import type {Fact,Quote,ToolResult} from './contracts';
import {st} from '@/lib/staff/staff-locale-copy';
import type {L} from './contracts';

/** What the member wrote in the chat about her blood pressure and her medicines, read out of the member's own messages by fixed rules
 * (no model). Shown on the nurse's card marked "member reported": it is never a saved reading and never a prescription, and the card
 * says so. Only unflagged member quotes are read; a number is taken only when it looks like a pressure (systolic 70 to 260, diastolic
 * 40 to 150, systolic above diastolic), and a medicine only from a fixed list of heart and pressure medicines, never when the same
 * sentence says she does not take it, stopped it or never took it. */
const PRESSURE=/(?<![\d./:-])(\d{2,3})\s*(?:\/|\\|(?<![\p{L}])(?:на|over)(?![\p{L}]))\s*(\d{2,3})(?![\d/:-]|\.\d)/giu;
const MEDICINES:[string,RegExp][]=[
 ['amlodipine',/amlodipin|амлодипин|ամլոդիպին/iu],['losartan',/losartan|лозартан|լոզարտան/iu],['valsartan',/valsartan|валсартан|վալսարտան/iu],
 ['candesartan',/candesartan|кандесартан/iu],['telmisartan',/telmisartan|телмисартан/iu],['olmesartan',/olmesartan|олмесартан/iu],
 ['perindopril',/perindopril|периндоприл/iu],['ramipril',/ramipril|рамиприл/iu],['lisinopril',/lisinopril|лизиноприл/iu],['enalapril',/enalapril|эналаприл/iu],
 ['bisoprolol',/bisoprolol|бисопролол|բիսոպրոլոլ/iu],['metoprolol',/metoprolol|метопролол/iu],['nebivolol',/nebivolol|небиволол/iu],['carvedilol',/carvedilol|карведилол/iu],
 ['indapamide',/indapamid|индапамид/iu],['hydrochlorothiazide',/hydrochlorothiazide|гидрохлортиазид/iu],['furosemide',/furosemide|фуросемид/iu],['spironolactone',/spironolactone|спиронолактон/iu],
 ['atorvastatin',/atorvastatin|аторвастатин|ատորվաստատին/iu],['rosuvastatin',/rosuvastatin|розувастатин|ռոզուվաստատին/iu],['simvastatin',/simvastatin|симвастатин/iu],['ezetimibe',/ezetimib|эзетимиб/iu],
 ['aspirin',/aspirin|аспирин|ասպիրին/iu],
];
const NEGATION=/\b(?:not|no longer|never|stopped|stop|quit|don'?t|do not|didn'?t|did not|without|except)\b|(?<![\p{L}])не\s+(?:принима|пью|пил|употреб|назнач)|перестал|бросил|(?<![\p{L}])без\s|никогда|չեմ\s+(?:ընդունում|խմում)|դադարեցր|երբեք/iu;
const DOSE=/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:mg|мг|մգ)(?![\p{L}])/iu;

const t=(l:L,en:string,hy:string,ru:string)=>st(l,en,hy,ru);

const LDL=/(?<![\p{L}])(?:ldl|лпнп|լդլ)(?![\p{L}])[^\d]{0,24}(\d{1,2}(?:[.,]\d{1,2})?|\d{2,3})\s*(mmol|ммоль|մմոլ|mg\/dl|мг\/дл)/iu;

export function chatReportedFacts(quotes:readonly Quote[],l:L):{bp:Fact[];medicines:Fact[];ldl:Fact[]}{
 const own=quotes.filter(q=>q.nurseName===undefined&&!q.zoe&&!q.flagged);
 const bp:Fact[]=[],medicines:Fact[]=[],ldl:Fact[]=[],seenMedicine=new Set<string>();
 // Newest first, so the card leads with what she wrote last.
 for(const quote of [...own].sort((a,b)=>(b.at??b.date??'').localeCompare(a.at??a.date??''))){
  for(const match of quote.text.matchAll(PRESSURE)){
   const sbp=Number(match[1]),dbp=Number(match[2]);
   if(sbp<70||sbp>260||dbp<40||dbp>150||sbp-dbp<10)continue;
   if(bp.length<3)bp.push({id:`bp.${100+bp.length}`,label:`${t(l,'Blood pressure from the member\'s chat message','Ճնշում անդամի զրույցի հաղորդագրությունից','Давление из сообщения участника в чате')} (${unverifiedBpLabel(l)})`,value:`${sbp}/${dbp} mmHg`,date:quote.date,mark:'member_reported',href:null,analyte:null});
  }
  const l1=LDL.exec(quote.text);
  if(l1&&ldl.length<2){
   const value=Number(l1[1].replace(',','.')),mg=/mg|мг/i.test(l1[2]);
   // Plausible only: 0.3 to 12 mmol/L, 10 to 450 mg/dL. Anything else is not read.
   if(mg?value>=10&&value<=450:value>=0.3&&value<=12)ldl.push({id:`ldl.${100+ldl.length}`,label:t(l,'LDL from the member\'s chat message (member-reported, not verified)','LDL անդամի զրույցի հաղորդագրությունից (անդամի ասածը, չստուգված)','ЛПНП из сообщения участника в чате (со слов участника, не проверено)'),value:`${value} ${mg?'mg/dL':'mmol/L'}`,date:quote.date,mark:'member_reported',href:null,analyte:null});
  }
  for(const sentence of quote.text.split(/(?<=[.!?։\n])\s*/u)){
   if(NEGATION.test(sentence))continue;
   for(const [name,pattern] of MEDICINES){
    if(!pattern.test(sentence)||seenMedicine.has(name))continue;
    seenMedicine.add(name);
    const dose=DOSE.exec(sentence);
    if(medicines.length<6)medicines.push({id:`adherence.${100+medicines.length}`,label:t(l,'Medicine from the member\'s chat message (member-reported, not a confirmed prescription)','Դեղ անդամի զրույցի հաղորդագրությունից (անդամի ասածը, հաստատված նշանակում չէ)','Лекарство из сообщения участника в чате (со слов участника, не подтверждённое назначение)'),value:`${name}${dose?` ${dose[1].replace(',','.')} mg`:''}`,date:quote.date,mark:'member_reported',href:null,analyte:null});
   }
  }
 }
 return {bp,medicines,ldl};
}

/** Adds the chat facts to a tool card: a card that said "nothing recorded" now shows them; any other state is kept as it was. */
export function withChatFacts(card:ToolResult,facts:readonly Fact[]):ToolResult{
 if(!facts.length)return card;
 return {...card,facts:[...card.facts,...facts],state:card.state==='none'?'ok':card.state};
}

/** Display provenance only, never a safety filter. Parser bounds exclude dates and fractions. */
export function quotesTypedBp(text:string){
 for(const match of text.matchAll(PRESSURE)){
  const systolic=Number(match[1]),diastolic=Number(match[2]);
  if(systolic>=60&&systolic<=300&&diastolic>=30&&diastolic<=200&&systolic>diastolic)return true;
 }
 return false;
}
