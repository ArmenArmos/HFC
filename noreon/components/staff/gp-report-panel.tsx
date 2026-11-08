'use client';
import {ResultEntryForm} from './result-entry-form';
import type {ResultsBlockState} from '@/lib/gp-report/runtime';
import {useState} from 'react';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import {Download, FileCheck2} from 'lucide-react';
import {buttonClass} from './shell';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {Block,GpApproval} from '@/lib/gp-report/document';
import type {ApproveResult} from '@/lib/gp-report/runtime';

import {clinicalLocale,type Locale} from '@/lib/locale';
const copy:Record<Locale,Record<'title'|'intro'|'approvedCurrent'|'current'|'draft'|'latest'|'none'|'preview'|'armenian'|'english'|'confirm'|'approve'|'saving'|'approved'|'download'|'pdf'|'docx'|'version'|'noSend',string>&{status:Record<'stale'|'off'|'access'|'invalid'|'outcome-unknown',string>}>={
 en:{title:'GP report',intro:'The hypertension report for the member’s primary-care doctor, built from this member’s records and the screening engine. Values that are missing say “Not available” with the reason.',
  approvedCurrent:'Approved, no newer records. Version',current:'Current report',draft:'Draft. AI prepared, not clinically reviewed.',latest:'Latest approved',none:'No version approved yet.',preview:'Preview language',armenian:'Armenian',english:'English',
  confirm:'I checked this report against the member’s records.',approve:'Approve this report',saving:'Saving…',
  approved:'Approved. The header now names you as the reviewer.',
  status:{stale:'The member’s records changed since this page loaded. Reload to review the current report.',off:'The GP report is switched off.',access:'Only the assigned doctor can approve this report.',invalid:'This report could not be approved. Reload and try again.','outcome-unknown':'We could not confirm the approval. Reload to check before trying again.'},
  download:'Download',pdf:'PDF, Armenian and English',docx:'Word, Armenian and English',version:'Version',
  noSend:'Noreon does not send this report to anyone. You can view and download it.'},
 hy:{title:'Բժշկի հաշվետվություն',intro:'Հիպերտենզիայի հաշվետվություն անդամի առաջնային օղակի բժշկի համար՝ կազմված անդամի գրառումներից և սքրինինգի շարժիչից։ Բացակայող արժեքները նշված են «Հասանելի չէ»՝ պատճառով։',
  approvedCurrent:'Հաստատված է, նոր գրառումներ չկան։ Տարբերակ',current:'Ընթացիկ հաշվետվություն',draft:'Սևագիր։ Պատրաստված է AI-ի միջոցով, բժշկի կողմից չի վերանայվել։',latest:'Վերջին հաստատված',none:'Դեռ հաստատված տարբերակ չկա։',preview:'Նախադիտման լեզու',armenian:'Հայերեն',english:'Անգլերեն',
  confirm:'Ես ստուգել եմ այս հաշվետվությունը անդամի գրառումների հետ։',approve:'Հաստատել հաշվետվությունը',saving:'Պահպանվում է…',
  approved:'Հաստատված է։ Վերնագրում այժմ նշված եք որպես վերանայող։',
  status:{stale:'Անդամի գրառումները փոխվել են էջը բացելուց հետո։ Թարմացրեք էջը՝ ընթացիկ հաշվետվությունը վերանայելու համար։',off:'Բժշկի հաշվետվությունն անջատված է։',access:'Միայն կցված բժիշկը կարող է հաստատել այս հաշվետվությունը։',invalid:'Հաշվետվությունը հնարավոր չեղավ հաստատել։ Թարմացրեք էջը և փորձեք կրկին։','outcome-unknown':'Չհաջողվեց հաստատել արդյունքը։ Թարմացրեք էջը՝ ստուգելու համար, նախքան կրկին փորձելը։'},
  download:'Ներբեռնել',pdf:'PDF, հայերեն և անգլերեն',docx:'Word, հայերեն և անգլերեն',version:'Տարբերակ',
  noSend:'Նորեոն Հելթը այս հաշվետվությունը որևէ մեկին չի ուղարկում։ Կարող եք դիտել և ներբեռնել այն։'},
 ru:{title:'Отчёт для врача первичного звена',intro:'Отчёт об артериальной гипертензии для врача первичного звена участника, составленный на основе записей об участнике и системы скрининга. Отсутствующие значения отмечены как «Недоступно» с указанием причины.',
  approvedCurrent:'Утверждено, новых записей нет. Версия',current:'Текущий отчёт',draft:'Черновик. Подготовлен ИИ, клиническая проверка не проводилась.',latest:'Последний утверждённый',none:'Пока нет утверждённой версии.',preview:'Язык предпросмотра',armenian:'Армянский',english:'Английский',
  confirm:'Я проверил этот отчёт по записям об участнике.',approve:'Утвердить этот отчёт',saving:'Сохраняется…',
  approved:'Утверждено. Теперь в заголовке вы указаны как проверивший отчёт.',
  status:{stale:'Записи об участнике изменились после загрузки страницы. Обновите страницу, чтобы проверить текущий отчёт.',off:'Отчёт для врача первичного звена отключён.',access:'Только назначенный врач может утвердить этот отчёт.',invalid:'Не удалось утвердить этот отчёт. Обновите страницу и попробуйте снова.','outcome-unknown':'Не удалось подтвердить утверждение. Обновите страницу, чтобы проверить результат, прежде чем повторить попытку.'},
  download:'Скачать',pdf:'PDF, армянский и английский',docx:'Word, армянский и английский',version:'Версия',
  noSend:'Нореон Хелс никому не отправляет этот отчёт. Его можно просмотреть и скачать.'},
};
export const gpReportConfirmation=(locale:Locale)=>copy[locale].confirm;
type Props={resultsBlock?:Extract<ResultsBlockState,{status:'ready'}>;currentApproved:number|null;memberId:string;locale:Locale;token:string;submissionId:string;blocks:{hy:Block[];en:Block[]};versions:(GpApproval&{contentSha256:string;sourceToken?:string})[];approve:(memberId:string,token:string,submissionId:string,shownResultsAssessment?:boolean)=>Promise<ApproveResult>};

export function GpReportPanel(props:Props){
 const t=copy[props.locale];
 const refresh=useRecordRefresh();
 const [lang,setLang]=useState<'hy'|'en'>(clinicalLocale(props.locale));
 const [checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false);
 const [resultSaving,setResultSaving]=useState(false);
 const [message,setMessage]=useState<string|null>(null);
 const latest=props.versions[0];
 const base=`/staff/real/members/${props.memberId}/gp-report`;
 async function approve(){
  setBusy(true);setMessage(null);
  try{
   const result=await props.approve(props.memberId,props.token,props.submissionId,Boolean(props.resultsBlock));
   if(result.status==='approved'){setMessage(t.approved);refresh();}
   else setMessage(t.status[result.status]);
  }catch{setMessage(t.status['outcome-unknown']);}
  finally{setBusy(false);}
 }
 // The main downloads are the document shown below: the approved version when there is one (audit B2-5).
 const approvedQuery=props.currentApproved?`&version=${props.currentApproved}`:'';
 return <section id="gp-report" aria-labelledby="gp-report-title" lang={props.locale} className="space-y-4 rounded-xl border bg-background p-4 sm:p-6">
  <header className="space-y-1"><h2 id="gp-report-title" className="flex items-center gap-2 text-h3"><FileCheck2 className="size-5" aria-hidden/>{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p><p className="text-body2 text-muted-foreground">{t.noSend}</p></header>
  <dl className="grid gap-3 sm:grid-cols-2">
   <div><dt className="text-caption text-muted-foreground">{t.current}</dt><dd className="text-body2">{props.currentApproved?`${t.approvedCurrent} ${props.currentApproved}`:t.draft}</dd></div>
   <div><dt className="text-caption text-muted-foreground">{t.latest}</dt><dd className="text-body2">{latest?`${t.version} ${latest.version} · ${latest.approvedByName} · ${yerevanStamp(latest.approvedAt,props.locale)}`:t.none}</dd></div>
  </dl>
  <div className="flex flex-wrap items-center gap-2">
   <a className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-body2 font-medium hover:bg-muted" href={`${base}?format=pdf&lang=both${approvedQuery}`}><Download className="size-4" aria-hidden/>{t.pdf}</a>
   <a className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-body2 font-medium hover:bg-muted" href={`${base}?format=docx&lang=both${approvedQuery}`}><Download className="size-4" aria-hidden/>{t.docx}</a>
  </div>
  {props.versions.length>0&&<details><summary className="min-h-11 cursor-pointer text-body2">{t.latest}: {props.versions.length}</summary><ul className="divide-y">{props.versions.map(v=><li key={v.version} className="flex flex-wrap items-center gap-3 py-2 text-body2"><span>{t.version} {v.version} · {v.approvedByName} · {yerevanStamp(v.approvedAt,props.locale)}</span><a className="underline" href={`${base}?format=pdf&lang=both&version=${v.version}`}>PDF</a><a className="underline" href={`${base}?format=docx&lang=both&version=${v.version}`}>Word</a></li>)}</ul></details>}
  <div role="group" aria-label={t.preview} className="flex gap-1 border-b">
   {(['hy','en'] as const).map(code=><button key={code} type="button" aria-pressed={lang===code} onClick={()=>setLang(code)} className={`min-h-11 border-b-2 px-4 text-body2 font-medium ${lang===code?'border-primary text-primary':'border-transparent text-muted-foreground hover:bg-muted'}`}>{code==='hy'?t.armenian:t.english}</button>)}
  </div>
  {props.resultsBlock&&<ResultEntryForm disabled={busy} memberId={props.memberId} locale={props.locale} entries={props.resultsBlock.entries} score2Applicable={props.resultsBlock.assessment.score2.state==='applicable'} onBusy={value=>{setResultSaving(value);if(value)setChecked(false);}} onSaved={()=>refresh()}/>}
  <GpReportPreview blocks={props.blocks[lang]} lang={lang}/>
  {!props.currentApproved&&<div className="space-y-3 rounded-lg border p-4">
   <label className="flex min-h-11 items-start gap-3 text-body2"><input type="checkbox" className="mt-1 size-5" checked={checked} disabled={busy||resultSaving} onChange={e=>setChecked(e.target.checked)}/>{t.confirm}</label>
   <button type="button" className={buttonClass} disabled={!checked||busy||resultSaving} onClick={approve}>{busy?t.saving:t.approve}</button>
   {message&&<p role="status" className="text-body2">{message}</p>}
  </div>}
  {props.currentApproved&&message&&<p role="status" className="text-body2">{message}</p>}
 </section>;
}

/** The report as the GP sees it, in the template's order and structure. */
export function GpReportPreview({blocks,lang}:{blocks:Block[];lang:'hy'|'en'}){
 return <article lang={lang} className="space-y-2 overflow-x-auto rounded-lg border bg-background p-4 text-body2 sm:p-6">
  {blocks.map((b,i)=>{
   if(b.type==='pagebreak')return <hr key={i} className="my-4 border-dashed"/>;
   if(b.type==='table')return <table key={i} className="w-full min-w-[36rem] border-collapse text-caption"><thead><tr>{b.head.map((h,j)=><th key={j} scope="col" className="border bg-primary p-2 text-left font-semibold text-primary-foreground">{h}</th>)}</tr></thead><tbody>{b.rows.map((r,ri)=><tr key={ri} className={ri%2===0?'bg-muted':''}>{r.map((c,ci)=>ci===0?<th key={ci} scope="row" className="border p-2 text-left align-top font-normal">{c}</th>:<td key={ci} className="border p-2 align-top">{c}</td>)}</tr>)}</tbody></table>;
   if(b.type==='title')return <h3 key={i} className="text-h2">{b.text}</h3>;
   if(b.type==='h1')return <h3 key={i} className="pt-2 text-h3">{b.text}</h3>;
   if(b.type==='h2')return <h4 key={i} className="pt-2 text-body1 font-semibold">{b.text}</h4>;
   if(b.type==='meta'||b.type==='small')return <p key={i} className="text-caption">{b.text}</p>;
   return <p key={i} className="whitespace-pre-line leading-relaxed">{b.text}</p>;
  })}
 </article>;
}
