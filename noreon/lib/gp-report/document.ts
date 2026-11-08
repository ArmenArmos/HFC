import type {GpReport,Row} from './builder';
import {cat,dayTime,join,l,type L} from './format';

/** Who approved a version, from gp_report_versions. Absent means a draft. */
export type GpApproval={version:number;approvedAt:string;approvedByName:string};
export type Lang='en'|'hy';
export type Block=
 |{type:'title'|'meta'|'h1'|'h2'|'p'|'small';text:string}
 |{type:'table';head:[string,string,string];rows:[string,string,string][];widths:[number,number,number]}
 |{type:'pagebreak'};

const titles={
 title:l('Noreon hypertension report for primary care','Նորեոն Հելթ հիպերտենզիայի հաշվետվություն առաջնային օղակի բժշկի համար'),
 priority:l('Priority and immediate action','Առաջնահերթություն և անհապաղ գործողություն'),
 assessment:l('Clinical assessment for GP review','Բժշկի վերանայմանը ներկայացվող գնահատում'),
 bp:l('Blood pressure and control','Զարկերակային ճնշում և վերահսկում'),
 history:l('History and cardiovascular risk','Անամնեզ և սիրտանոթային ռիսկ'),
 meds:l('Current medicines and adherence','Ընթացիկ դեղեր և բուժման ընդունում'),
 investigations:l('Investigations and proposed action plan','Հետազոտություններ և առաջարկվող գործողություններ'),
 labs:l('Laboratory findings and trends','Լաբորատոր արդյունքներ և դինամիկա'),
 ecg:l('12 lead ECG assessment','12 արտածումով ԷՍԳ գնահատում'),
 proposals:l('Prioritised proposals for the GP','Բժշկին առաջարկվող առաջնահերթ քայլեր'),
 followUp:l('Follow-up and escalation','Հետագա հսկողություն և ահազանգ'),
};
const heads={
 bp:[l('Measure and source','Չափում և աղբյուր'),l('Current result and period','Վերջին արդյունք և շրջան'),l('Previous result and period','Նախորդ արդյունք և շրջան')],
 meds:[l('Medicine and class','Դեղ և դաս'),l('Recorded dose and schedule','Գրանցված դեղաչափ և ռեժիմ'),l('Source and treatment issue','Աղբյուր և խնդիր')],
 labs:[l('Test and units','Թեստ և միավոր'),l('Latest result and date','Վերջին արդյունք և օր'),l('Previous result and date','Նախորդ արդյունք և օր')],
 proposals:[l('When and owner','Ժամկետ'),l('Proposed action and reason','Առաջարկ և պատճառ'),l('Completion or review','Կատարում կամ վերանայում')],
};
// Column widths from the template's table grids (twentieths of a point).
const widths={bp:[2160,4176,4032],meds:[2376,3528,4464],labs:[2304,4608,3456],proposals:[2016,5760,2592]} as const;
const DISCLAIMER=l('AI proposals support GP judgement and are not a prescription. Full readings, laboratory reports and the original ECG remain accessible through the listed sources. No automatic medication change.','AI առաջարկները չեն հանդիսանում դեղատոմս։ Բժիշկը հաստատում է որոշումները։ Ամբողջական չափումները, լաբորատոր տվյալները և ԷՍԳ-ն հասանելի են աղբյուրների հղումներով։ Դեղերի ավտոմատ փոփոխություն չի կատարվում։');

/** The header status line. "AI prepared | Not clinically reviewed" stays until a doctor approves. */
export function statusLine(approval:GpApproval|null):L{
 return approval
  ?cat(l('AI prepared | Reviewed by Noreon doctor ','Պատրաստված է AI-ի միջոցով | Վերանայվել է Նորեոն Հելթի բժշկի կողմից՝ '),approval.approvedByName,', ',dayTime(approval.approvedAt),l(' | Adult pathway; pregnancy status not recorded',' | Չափահասների ուղի. հղիության կարգավիճակը չի գրանցվել'))
  :l('AI prepared | Not clinically reviewed | Adult pathway; pregnancy status not recorded','Պատրաստված է AI-ի միջոցով | Բժշկի կողմից չի վերանայվել | Չափահասների ուղի. հղիության կարգավիճակը չի գրանցվել');
}
export function reportId(report:GpReport,approval:GpApproval|null){
 return approval?`${report.reportRef}/v${approval.version}`:`${report.reportRef}/v${report.nextVersion}`;
}
export function footerText(approval:GpApproval|null){
 return `Noreon | ${'NRN-GP-REP-001 v1.0'} | ${approval?`APPROVED v${approval.version}`:'DRAFT, NOT CLINICALLY REVIEWED'}`;
}

const t=(x:L,lang:Lang)=>x[lang];
const table=(head:L[],rows:Row[],w:readonly number[],lang:Lang):Block=>({type:'table',head:[t(head[0],lang),t(head[1],lang),t(head[2],lang)],rows:rows.map(r=>[t(r[0],lang),t(r[1],lang),t(r[2],lang)]),widths:[w[0],w[1],w[2]]});

/** One language's two pages, in the template's order. */
export function languageBlocks(report:GpReport,approval:GpApproval|null,lang:Lang):Block[]{
 const id=reportId(report,approval);
 const reviewed=approval?cat(l('Reviewed by ','Վերանայվել է՝ '),approval.approvedByName,', ',dayTime(approval.approvedAt)):l('AI prepared and not clinically reviewed','AI ամփոփում՝ առանց բժշկի վերանայման');
 const signoff=cat(l('GP receipt: not sent | Clinical review: ','Ստացվել է բժշկի կողմից՝ չի ուղարկվել | Վերանայում՝ '),approval?cat(dayTime(approval.approvedAt),', ',approval.approvedByName,l(' (Noreon doctor)',' (Նորեոն Հելթի բժիշկ)')):l('pending','սպասվում է'),l(' | Plan accepted or modified: not recorded | Patient informed: not recorded.',' | Պլան՝ չի գրանցվել | Պացիենտը տեղեկացված է՝ չի գրանցվել։'));
 return [
  {type:'title',text:t(titles.title,lang)},
  {type:'meta',text:t(statusLine(approval),lang)},
  {type:'meta',text:t(report.patientLine,lang)},
  {type:'meta',text:t(cat(l('Report ','Հաշվետվություն '),id,approval?'':l(' (draft)',' (սևագիր)'),' | ',report.reportLine),lang)},
  {type:'h2',text:t(titles.priority,lang)},{type:'p',text:t(report.priority,lang)},
  {type:'h2',text:t(titles.assessment,lang)},{type:'p',text:t(report.assessment,lang)},
  {type:'h2',text:t(titles.bp,lang)},table(heads.bp,report.bp.rows,widths.bp,lang),{type:'small',text:t(report.bp.note,lang)},
  {type:'h2',text:t(titles.history,lang)},{type:'p',text:t(report.history,lang)},{type:'small',text:t(report.risk,lang)},
  {type:'h2',text:t(titles.meds,lang)},table(heads.meds,report.meds.rows,widths.meds,lang),{type:'small',text:t(report.meds.note,lang)},
  {type:'pagebreak'},
  {type:'h1',text:t(titles.investigations,lang)},
  {type:'meta',text:t(cat(l('Patient ','Պացիենտ '),report.reportRef,' | ',l('Report ','Հաշվետվություն '),id,' | ',reviewed),lang)},
  {type:'h2',text:t(titles.labs,lang)},table(heads.labs,report.labs.rows,widths.labs,lang),{type:'small',text:t(report.labs.note,lang)},
  ...(report.results?[
   {type:'h2' as const,text:t(l('Results assessment','Արդյունքների գնահատում'),lang)},
   table([l('Measure','Չափում'),l('Result and date','Արդյունք և օր'),l('Assessment','Գնահատում')],report.results.rows,widths.labs,lang),
   {type:'small' as const,text:t(cat(l('Missing for assessment: ','Գնահատման համար բացակայում է՝ '),report.results.gaps.length?join(report.results.gaps):l('No missing-data gates.','Բացակայող տվյալների նշումներ չկան։')),lang)},
  ]:[]),
  {type:'h2',text:t(titles.ecg,lang)},{type:'small',text:t(report.ecg,lang)},
  {type:'h2',text:t(titles.proposals,lang)},table(heads.proposals,report.proposals,widths.proposals,lang),
  {type:'h2',text:t(titles.followUp,lang)},{type:'small',text:t(report.followUp,lang)},
  {type:'small',text:t(signoff,lang)},{type:'small',text:t(DISCLAIMER,lang)},{type:'small',text:t(report.sources,lang)},
 ];
}
/** The template order: Armenian pages first, then English. */
export function documentBlocks(report:GpReport,approval:GpApproval|null,langs:Lang[]):Block[]{
 return langs.flatMap((lang,i)=>[...(i?[{type:'pagebreak'} as Block]:[]),...languageBlocks(report,approval,lang)]);
}
