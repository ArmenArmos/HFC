import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {clinicalLocale,type Locale} from '@/lib/locale';
import {AlertTriangle,Bot,FlaskConical} from 'lucide-react';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {outOfRange,type ResultsCardItem,type StaffClinicFile,type StaffLabResults,type StaffMemberUpload} from '@/lib/lab-ai/staff-results';
import type {LabSummaryRead} from '@/lib/lab-ai/doctor-schema';

const enCopy={
  card:'Results',cardIntro:'New lab results read by AI in the last two weeks.',clinic:'Clinic lab document',member:'Member upload',reading:'Being read now',read:'Read',notRead:'Not read automatically',
  outCount:(n:number,v:number)=>n?`${n} of ${v} outside the lab range or flagged`:`${v} ${v===1?"value":"values"}, none outside the lab range`,open:'See values',
  title:'Lab results read by AI',intro:'Read only. Values were read from each file by AI; check them against the PDF. Member uploads are saved as read and may be corrected by the member.',
  aiLabel:'AI-prepared, check against the PDF',summary:'AI summary',workup:'Hypertension work-up',onSheet:'On this sheet',missing:'Not on this sheet',outside:'Outside the lab range',none:'None.',
  noFiles:'No lab documents or member uploads.',unavailable:'Lab results read by AI are unavailable. Reload to check them.',
  state:{queued:'Waiting to be read.',running:'Being read now.',rejected:'Not read: the file broke a limit or was removed.',failed:'Reading failed.',none:'Not read by AI.',empty:'Read: no values found.',unreadable:'Read: not a lab sheet, or nothing could be read.',several:'Read: more than one person on the sheet, so no values were kept.'} as Record<string,string>,
  mismatch:'Name or date of birth on the sheet differs from the member\'s profile.',identityConfirmed:'The doctor confirmed the sheet belongs to this member.',
  clinicStatus:{unverified:'pending doctor review',auto_accepted:AI_READ_LABEL.en,verified:'doctor confirmed',corrected:'doctor corrected',rejected:'doctor rejected'} as Record<string,string>,
  memberStatus:{pending:'AI-read, not confirmed by member',confirmed:'member-confirmed',corrected:'member-corrected',rejected:'member removed'} as Record<string,string>,
  checks:'Reader checks',check:{unmapped:'test not recognised',mapping_conflict:'test name unclear',unit_missing:'no unit',unit_unexpected:'unexpected unit',implausible:'implausible value',censored:'below or above a limit',not_numeric:'not a number',range_unparsed:'range unclear',date_future:'date in the future',date_unparsed:'date unclear',page_unknown:'page unclear'} as Record<string,string>,
  flag:{high:'high',low:'low',abnormal:'abnormal',critical:'critical',normal:'normal'} as Record<string,string>,
  attention:{threshold:'matches a threshold rule',lab_critical:'lab marked critical',needs_doctor:'outside the lab range'} as Record<string,string>,
  aiRead:'AI read',page:'page',from:'from',uploaded:'Uploaded',
 };
const copy:Record<Locale,typeof enCopy>={
 en:enCopy,
 hy:{
  card:'Արդյունքներ',cardIntro:'Վերջին երկու շաբաթում AI-ի կարդացած նոր լաբորատոր արդյունքներ։',clinic:'Կլինիկայի լաբորատոր փաստաթուղթ',member:'Անդամի վերբեռնում',reading:'Կարդացվում է',read:'Կարդացված է',notRead:'Ավտոմատ չի կարդացվել',
  outCount:(n:number,v:number)=>n?`${v}-ից ${n}-ը լաբորատորիայի միջակայքից դուրս է կամ նշված է`:`${v} արժեք, միջակայքից դուրս չկա`,open:'Տեսնել արժեքները',
  title:'AI-ի կարդացած լաբորատոր արդյունքներ',intro:'Միայն ընթերցման համար։ Արժեքները յուրաքանչյուր ֆայլից կարդացել է AI-ը. ստուգեք PDF-ի հետ։ Անդամի վերբեռնումները պահպանվում են կարդացածի պես, և անդամը կարող է ուղղել դրանք։',
  aiLabel:'Պատրաստել է AI-ը, ստուգեք PDF-ի հետ',summary:'AI ամփոփում',workup:'Հիպերտոնիայի հետազոտություններ',onSheet:'Թերթիկին կա',missing:'Թերթիկին չկա',outside:'Լաբորատորիայի միջակայքից դուրս',none:'Չկա։',
  noFiles:'Լաբորատոր փաստաթղթեր կամ անդամի վերբեռնումներ չկան։',unavailable:'AI-ի կարդացած լաբորատոր արդյունքներն անհասանելի են։ Թարմացրեք էջը։',
  state:{queued:'Սպասում է կարդալուն։',running:'Կարդացվում է։',rejected:'Չի կարդացվել․ ֆայլը խախտել է սահմանափակումը կամ հեռացվել է։',failed:'Կարդալը ձախողվեց։',none:'AI-ը չի կարդացել։',empty:'Կարդացված է․ արժեքներ չեն գտնվել։',unreadable:'Կարդացված է․ լաբորատոր թերթիկ չէ, կամ ոչինչ հնարավոր չեղավ կարդալ։',several:'Կարդացված է․ թերթիկին մեկից ավելի անձ կա, արժեքներ չեն պահվել։'} as Record<string,string>,
  mismatch:'Թերթիկի անունը կամ ծննդյան ամսաթիվը տարբերվում է անդամի պրոֆիլից։',identityConfirmed:'Բժիշկը հաստատել է, որ թերթիկը պատկանում է այս անդամին։',
  clinicStatus:{unverified:'սպասում է բժշկի ստուգմանը',auto_accepted:AI_READ_LABEL.hy,verified:'բժիշկը հաստատել է',corrected:'բժիշկն ուղղել է',rejected:'բժիշկը մերժել է'} as Record<string,string>,
  memberStatus:{pending:'AI-ի կարդացած, անդամը չի հաստատել',confirmed:'անդամը հաստատել է',corrected:'անդամն ուղղել է',rejected:'անդամը հեռացրել է'} as Record<string,string>,
  checks:'Ստուգումներ',check:{unmapped:'հետազոտությունը չճանաչվեց',mapping_conflict:'անվանումն անհասկանալի է',unit_missing:'միավոր չկա',unit_unexpected:'անսպասելի միավոր',implausible:'անհավանական արժեք',censored:'սահմանից ցածր կամ բարձր',not_numeric:'թիվ չէ',range_unparsed:'միջակայքն անհասկանալի է',date_future:'ապագա ամսաթիվ',date_unparsed:'ամսաթիվն անհասկանալի է',page_unknown:'էջն անհասկանալի է'} as Record<string,string>,
  flag:{high:'բարձր',low:'ցածր',abnormal:'աննորմալ',critical:'կրիտիկական',normal:'նորմալ'} as Record<string,string>,
  attention:{threshold:'համապատասխանում է շեմային կանոնին',lab_critical:'լաբորատորիան նշել է կրիտիկական',needs_doctor:'լաբորատորիայի միջակայքից դուրս'} as Record<string,string>,
  aiRead:'AI-ի կարդացածը',page:'էջ',from:'',uploaded:'Վերբեռնվել է',
 },
 ru:{
  card:"Результаты",cardIntro:"Новые лабораторные результаты, распознанные ИИ за последние две недели.",clinic:"Лабораторный документ клиники",member:"Файл участника",reading:"Распознаётся",
  read:"Распознано",notRead:"Не распознано автоматически",open:"Посмотреть показатели",title:"Лабораторные результаты, распознанные ИИ",
  intro:"Только для просмотра. Показатели из каждого файла распознаны ИИ; сверьте их с PDF. Загруженные участником данные сохраняются как распознаны, и участник может их исправить.",
  aiLabel:"Подготовлено ИИ, сверьте с PDF",summary:"Сводка ИИ",workup:"Обследования при гипертонии",onSheet:"Есть на бланке",missing:"Нет на бланке",
  outside:"За пределами референсного интервала лаборатории",none:"Нет.",noFiles:"Нет лабораторных документов или файлов участника.",
  unavailable:"Лабораторные результаты, распознанные ИИ, недоступны. Обновите страницу, чтобы проверить их.",
  state:{queued:"Ожидает распознавания.",running:"Распознаётся.",rejected:"Не распознано: файл превышает допустимые ограничения или удалён.",failed:"Не удалось распознать.",none:"Не распознано ИИ.",empty:"Распознано: показатели не найдены.",unreadable:"Распознано: это не лабораторный бланк или данные не удалось прочитать.",several:"Распознано: на бланке данные нескольких человек, поэтому показатели не сохранены."} as Record<string,string>,
  mismatch:"Имя или дата рождения на бланке отличаются от профиля участника.",identityConfirmed:"Врач подтвердил, что бланк принадлежит этому участнику.",
  clinicStatus:{unverified:"ожидает проверки врача",auto_accepted:AI_READ_LABEL.ru,verified:"подтверждено врачом",corrected:"исправлено врачом",rejected:"отклонено врачом"} as Record<string,string>,
  memberStatus:{pending:"распознано ИИ, не подтверждено участником",confirmed:"подтверждено участником",corrected:"исправлено участником",rejected:"удалено участником"} as Record<string,string>,
  checks:"Проверки распознавания",
  check:{unmapped:"исследование не распознано",mapping_conflict:"название исследования неоднозначно",unit_missing:"нет единицы измерения",unit_unexpected:"неожиданная единица измерения",implausible:"неправдоподобное значение",censored:"ниже или выше предела",not_numeric:"не число",range_unparsed:"референсный интервал неясен",date_future:"дата в будущем",date_unparsed:"дата неясна",page_unknown:"страница неизвестна"} as Record<string,string>,
  flag:{high:"повышен",low:"понижен",abnormal:"отклонение",critical:"критический",normal:"в норме"} as Record<string,string>,
  attention:{threshold:"достигнут порог клинического правила",lab_critical:"лаборатория отметила как критический",needs_doctor:"за пределами референсного интервала лаборатории"} as Record<string,string>,
  aiRead:"Распознано ИИ",page:"страница",from:"из",uploaded:"Загружено",
  outCount:(n:number,v:number)=>n?`${n} из ${v} за пределами референсного интервала лаборатории или отмечены`:`Показателей: ${v}, все в пределах референсного интервала лаборатории`,
 },
};
type T=typeof copy.en;

/** Top of the member page: readings running now and readings finished in the last two weeks. */
export function LabResultsCard({items,locale}:{items:ResultsCardItem[];locale:Locale}){
 const t=copy[locale];
 if(!items.length)return null;
 return <section className="space-y-3 rounded-xl border border-brand-gold bg-surface-subtle-gold p-4 sm:p-5" aria-labelledby="lab-results-card" lang={locale}>
  <header className="space-y-1"><h2 id="lab-results-card" className="flex items-center gap-2 text-h3"><FlaskConical className="size-5" aria-hidden/>{t.card}</h2><p className="text-body2 text-muted-foreground">{t.cardIntro}</p></header>
  <ul className="divide-y rounded-lg border bg-background px-3">{items.map(i=>(
   <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div className="min-w-0 space-y-0.5">
     <p className="break-all text-body2 font-medium">{i.name}</p>
     <p className="text-caption text-muted-foreground">{i.source==='clinic'?t.clinic:t.member} · {i.state==='reading'?t.reading:i.state==='read'?t.read:t.notRead} · <time dateTime={i.at}>{yerevanStamp(i.at,locale)}</time></p>
     {i.state==='read'&&<p className="text-body2">{i.outOfRange>0&&<AlertTriangle className="mr-1 inline size-4 text-destructive" aria-hidden/>}{t.outCount(i.outOfRange,i.values)}</p>}
    </div>
    <a className="inline-flex min-h-11 items-center text-body2 underline" href={i.href}>{t.open}</a>
   </li>))}</ul>
 </section>;
}

const names=(ids:string[],locale:Locale)=>ids.map(id=>TEST_CATALOGUE.find(x=>x.id===id)?.name[locale]??id).join(', ');
/** The AI summary of one file, labelled; the work-up lines are computed in code, the narrative by the model from those facts. */
export function LabSummaryBlock({summary,locale}:{summary:LabSummaryRead|null;locale:Locale}){
 const t=copy[locale];
 if(!summary)return null;
 return <div className="space-y-2 rounded-md border border-brand-gold bg-surface-subtle-gold p-3">
  <p className="text-body2 font-medium">{t.summary}</p>
  <p className="text-caption font-medium">{t.aiLabel}</p>
  {summary.narrative&&<p className="text-body2">{summary.narrative[clinicalLocale(locale)]}</p>}
  {summary.workup&&<dl className="grid gap-1 text-body2">
   <div><dt className="inline font-medium">{t.workup}, {t.onSheet.toLowerCase()}: </dt><dd className="inline">{names(summary.workup.found,locale)||t.none}</dd></div>
   <div><dt className="inline font-medium">{t.outside}: </dt><dd className="inline">{names(summary.workup.outOfRange,locale)||t.none}</dd></div>
   <div><dt className="inline font-medium">{t.missing}: </dt><dd className="inline">{names(summary.workup.missing,locale)||t.none}</dd></div>
  </dl>}
 </div>;
}

type Row={valueId:string;testName:string;catalogueRef:string|null;valueText:string;unit:string|null;refText:string|null;labFlag:string|null;collectedOn:string|null;page:number;checks:string[];attention:string|null};
function ValueRow({v,status,shown,original,t,locale}:{v:Row;status:string;shown:string;original:string|null;t:T;locale:Locale}){
 const out=outOfRange(v);
 return <li className="space-y-0.5 py-2 text-body2">
  <p className="flex flex-wrap justify-between gap-2">
   <span>{out&&<AlertTriangle className="mr-1 inline size-4 text-destructive" aria-hidden/>}{analyteDisplayName(v.testName,locale,v.catalogueRef)}: <span className="tabular-nums">{shown}</span>{v.unit?` ${v.unit}`:''}</span>
   <span className="text-caption text-muted-foreground">{status}</span>
  </p>
  <p className="text-caption text-muted-foreground">
   {original?`${t.aiRead} ${original} · `:''}{v.refText?`${v.refText} · `:''}{v.labFlag&&v.labFlag!=='normal'?`${t.flag[v.labFlag]??v.labFlag} · `:''}{v.collectedOn?`${v.collectedOn} · `:''}{t.page} {v.page}{v.attention?` · ${t.attention[v.attention]}`:''}
  </p>
  {v.checks.length>0&&<p className="text-caption">{t.checks}: {v.checks.map(c=>t.check[c]??c).join(', ')}</p>}
 </li>;
}

function jobText(job:{state:string;outcome:string|null;identityStatus:string|null}|null,count:number,t:T){
 if(!job)return t.state.none;
 if(job.state!=='done')return t.state[job.state];
 if(job.outcome==='unreadable')return t.state.unreadable;
 if(job.identityStatus==='multiple_patients')return t.state.several;
 return count?null:t.state.empty;
}

function ClinicFile({f,t,locale}:{f:StaffClinicFile;t:T;locale:Locale}){
 const text=jobText(f.job,f.values.length,t);
 return <li id={`lab-ai-${f.fileId}`} className="min-w-0 scroll-mt-24 space-y-2 rounded-lg border p-3">
  <p className="break-all text-body1 font-medium">{f.name}</p>
  <p className="text-caption text-muted-foreground">{t.clinic} · {f.clinic} · {t.uploaded} <time dateTime={f.uploadedAt}>{yerevanStamp(f.uploadedAt,locale)}</time></p>
  <p className="flex items-center gap-2 text-caption font-medium"><Bot className="size-4" aria-hidden/>{t.aiLabel}</p>
  {text&&<p className="text-body2">{text}</p>}
  {f.job?.identityStatus&&f.job.identityStatus!=='match'&&f.job.identityStatus!=='multiple_patients'&&<p className="text-body2">{f.job.identityStatus==='mismatch'&&<AlertTriangle className="mr-1 inline size-4" aria-hidden/>}{f.job.identityConfirmedAt?t.identityConfirmed:f.job.identityStatus==='mismatch'?t.mismatch:null}</p>}
  {f.values.length>0&&<ul className="divide-y rounded-md border bg-background px-3">{f.values.map(v=><ValueRow key={v.valueId} v={v} t={t} locale={locale} status={t.clinicStatus[v.status]!}
   shown={v.status==='corrected'&&v.correctedValue!==null?String(v.correctedValue):v.valueText} original={v.status==='corrected'?v.valueText:null}/>)}</ul>}
  <LabSummaryBlock summary={f.job?.summary??null} locale={locale}/>
 </li>;
}
function MemberFile({d,t,locale}:{d:StaffMemberUpload;t:T;locale:Locale}){
 const text=jobText(d.job,d.values.length,t);
 return <li id={`lab-ai-${d.documentId}`} className="min-w-0 scroll-mt-24 space-y-2 rounded-lg border p-3">
  <p className="break-all text-body1 font-medium">{d.name}</p>
  <p className="text-caption text-muted-foreground">{t.member} · {t.uploaded} <time dateTime={d.uploadedAt}>{yerevanStamp(d.uploadedAt,locale)}</time></p>
  <p className="flex items-center gap-2 text-caption font-medium"><Bot className="size-4" aria-hidden/>{t.aiLabel}</p>
  {text&&<p className="text-body2">{text}</p>}
  {d.job?.identityStatus==='mismatch'&&<p className="text-body2"><AlertTriangle className="mr-1 inline size-4" aria-hidden/>{t.mismatch}</p>}
  {d.values.length>0&&<ul className="divide-y rounded-md border bg-background px-3">{d.values.map(v=><ValueRow key={v.valueId} v={v} t={t} locale={locale} status={t.memberStatus[v.memberStatus]!}
   shown={v.memberStatus==='corrected'&&v.memberValue!==null?String(v.memberValue):v.valueText} original={v.memberStatus==='corrected'?v.valueText:null}/>)}</ul>}
  <LabSummaryBlock summary={d.job?.summary??null} locale={locale}/>
 </li>;
}

/** Read-only results for an administrator: every clinic lab document and member upload with its AI reading. */
export function LabAiResults({data,locale}:{data:StaffLabResults|null;locale:Locale}){
 const t=copy[locale];
 if(data&&!data.enabled)return null;
 return <section className="space-y-3 rounded-xl border bg-background p-4 sm:p-5" aria-labelledby="lab-ai-results" lang={locale}>
  <header className="space-y-1"><h2 id="lab-ai-results" className="flex items-center gap-2 text-h3"><FlaskConical className="size-5" aria-hidden/>{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p></header>
  {!data?<p role="status" className="text-body2">{t.unavailable}</p>:!data.clinic.length&&!data.memberUploads.length?<p className="text-body2">{t.noFiles}</p>:
   <ul className="space-y-3">{data.clinic.map(f=><ClinicFile key={f.fileId} f={f} t={t} locale={locale}/>)}{data.memberUploads.map(d=><MemberFile key={d.documentId} d={d} t={t} locale={locale}/>)}</ul>}
 </section>;
}
