'use client';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {useRef,useState} from 'react';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import type {ResultsBlockState} from '@/lib/gp-report/runtime';
import {approveMemberGpReport} from '@/lib/gp-report/actions';
import {categoryCopy,ruleCopy,gateCopy,score2ReasonCopy} from '@/lib/gp-report/results-copy';
import {ResultEntryForm} from '@/components/staff/result-entry-form';
import {clinicalLocale} from '@/lib/locale';
import {gpReportConfirmation,GpReportPreview} from '@/components/staff/gp-report-panel';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {PatientLabValue} from '@/lib/staff-zoe/patient-labs';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';
import {calendarDate} from '@/lib/staff/yerevan-time';

type Ready=Extract<ResultsBlockState,{status:'ready'}>;
export function ResultsBlock({block,name,locale,onRefresh,onSaved,onApproved,onStale,notice}:{notice?:string;onSaved:(text:string)=>Promise<void>;onApproved:(version:number)=>void;onStale:()=>Promise<void>;block:Ready;name:string;locale:StaffLocale;onRefresh:()=>Promise<void>}){
 const [checkedToken,setCheckedToken]=useState<string|null>(null),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[staleToken,setStaleToken]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const checked=checkedToken===block.token,stale=staleToken===block.token;
 const setChecked=(value:boolean)=>setCheckedToken(value?block.token:null);
 const setStale=(value:boolean)=>setStaleToken(value?block.token:null);
 const locked=useRef(false);
 const [previewLanguage,setPreviewLanguage]=useState<'en'|'hy'>(()=>clinicalLocale(locale));
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const local=(copy:{en:string;hy:string;ru:string})=>st(locale,copy.en,copy.hy,copy.ru);
 const a=block.assessment;
 async function refresh(){
  if(locked.current)return;
  locked.current=true;setBusy(true);setChecked(false);setMessage(null);
  try{await onRefresh();setStale(false);setMessage(done('results-refreshed',locale));}catch{setStale(true);setMessage(notDone('results-refresh-failed',locale));}
  finally{locked.current=false;setBusy(false);}
 }
 async function approve(){
  if(locked.current||saving||stale)return;
  locked.current=true;setBusy(true);setMessage(null);
  try{
   const result=await approveMemberGpReport(block.memberId,block.token,block.submissionId,true);
   if(result.status==='approved'){setChecked(false);onApproved(result.approval.version);}
   else if(result.status==='stale'){
    setStale(true);setChecked(false);
    try{await onStale();setMessage(notDone('results-stale',locale));}
    catch{setMessage(notDone('results-stale',locale));}
   }
   else{setChecked(false);setMessage(result.status==='off'?notDone('report-off',locale):result.status==='access'?notDone('report-access',locale):notDone('approval-unknown',locale));setStale(true);}
  }catch{setStale(true);setChecked(false);setMessage(notDone('approval-unknown',locale));}
  finally{locked.current=false;setBusy(false);}
 }
 const hmod={present:t('Present','Առկա է','Выявлено'),absent:t('Absent','Բացակայում է','Не выявлено'),unknown:t('Unknown','Անհայտ','Неизвестно')}[a.hmod.status];
 const hmodReasons={ecg_lvh:t('ECG left ventricular hypertrophy','ԷՍԳ՝ ձախ փորոքի հիպերտրոֆիա','Гипертрофия левого желудочка на ЭКГ'),uacr:'UACR',egfr:'eGFR'};
 const labs=[['totalCholesterol',t('Total cholesterol','Ընդհանուր խոլեստերին','Общий холестерин'),'mmol/L'],['hdl','HDL','mmol/L'],['ldl','LDL','mmol/L'],['egfr','eGFR','mL/min/1.73 m²'],['uacr','UACR','mg/mmol'],['hba1c','HbA1c','%']] as const;
 return <section className="dcv2-results" aria-label={t('Results and report','Արդյունքներ և հաշվետվություն','Результаты и отчёт')}>
  {block.priorityLevel!=='green'&&<p className="dcv2-priority" role={block.priorityLevel==='emergency'||block.priorityLevel==='cannot-assess'?'alert':undefined}>{st(locale,block.priority.en,block.priority.hy,block.priorityLevel==='emergency'?'Нужны срочные действия. Проверьте приоритет перед результатами.':block.priorityLevel==='cannot-assess'?'Приоритет нельзя оценить полностью. Проверьте анкету и оповещения.':block.priorityLevel==='orange'?'Нужна консультация в ближайшие дни.':block.priorityLevel==='yellow'?'Нужна плановая проверка.':'Продолжите плановое наблюдение.')}</p>}
  <h2><ChatMemberIdentity memberId={block.memberId} name={name} locale={locale}/> · {t('Results and report','Արդյունքներ և հաշվետվություն','Результаты и отчёт')}</h2>
  {!notice&&!message&&<p role="status">{done('results-opened',locale)}</p>}
  {notice&&<p role="status">{notice}</p>}
  <p>{t('This is a draft until approved.','Սա սևագիր է մինչև հաստատումը։','Это черновик до утверждения.')}</p>
  <dl className="dcv2-results-facts">
   <div><dt>{t('Non-HDL','Ոչ HDL','Не-ЛПВП')}</dt><dd>{a.nonHdl?`${a.nonHdl.value} mmol/L${block.nonHdlOn?` · ${calendarDate(block.nonHdlOn,locale)}`:''}`:t('Not available: total cholesterol and HDL need the same observation date.','Հասանելի չէ․ ընդհանուր խոլեստերինի և HDL-ի հետազոտության ամսաթիվը պետք է նույնը լինի։','Недоступно: общий холестерин и ЛПВП должны иметь одну дату исследования.')}</dd></div>
   <div><dt>{t('Latest LDL','Վերջին LDL','Последнее ЛПНП')}</dt><dd>{block.labsShown.ldl?`${block.labsShown.ldl.value} mmol/L · ${calendarDate(block.labsShown.ldl.on,locale)}`:t('Not available','Հասանելի չէ','Недоступно')}</dd></div>
   {a.ldlTarget&&<><div><dt>{t('Absolute LDL target','LDL-ի բացարձակ թիրախ','Абсолютная цель ЛПНП')}</dt><dd>&lt; {a.ldlTarget.mmol} mmol/L</dd></div><div><dt>{t('LDL reduction target','LDL-ի նվազեցման թիրախ','Цель снижения ЛПНП')}</dt><dd>{a.ldlTarget.reductionPct===null?t('No percentage target','Տոկոսային թիրախ չկա','Процентная цель не задана'):`≥ ${a.ldlTarget.reductionPct}%`}. {t('Reduction cannot be assessed without a baseline.','Առանց ելակետային արժեքի նվազեցումը հնարավոր չէ գնահատել։','Без исходного значения снижение оценить нельзя.')}</dd></div><div><dt>{t('Latest LDL against absolute target','Վերջին LDL-ը՝ բացարձակ թիրախի համեմատ','Последнее ЛПНП относительно абсолютной цели')}</dt><dd>{a.ldlTarget.below===null?t('Not available','Հասանելի չէ','Недоступно'):a.ldlTarget.below?t('Below absolute target','Բացարձակ թիրախից ցածր է','Ниже абсолютной цели'):t('Not below absolute target','Բացարձակ թիրախից ցածր չէ','Не ниже абсолютной цели')}</dd></div></>}
   <div><dt>{t('Risk category','Ռիսկի կատեգորիա','Категория риска')}</dt><dd>{a.category?<>{local(categoryCopy[a.category.level])}<p>{local(ruleCopy[a.category.rule])}</p></>:<>{t('No category can be assigned from the available information.','Հասանելի տվյալներով կատեգորիա հնարավոր չէ նշանակել։','По имеющимся сведениям категорию определить нельзя.')}{a.score2.reasons.map(reason=><p key={reason}>{local(score2ReasonCopy[reason])}</p>)}</>}</dd></div>
  </dl>
  {a.gates.length>0&&<div><h3>{t('Missing information and next checks','Բացակայող տվյալներ և հաջորդ ստուգումներ','Недостающие сведения и следующие проверки')}</h3><ul>{a.gates.map(gate=><li key={gate}>{local(gateCopy[gate])}</li>)}</ul></div>}
  <details><summary>{t('Other reviewed results','Այլ վերանայված արդյունքներ','Другие проверенные результаты')}</summary><dl className="dcv2-results-facts">
   {labs.filter(([key])=>key!=='ldl').map(([key,label,unit])=><div key={key}><dt>{label}</dt><dd>{block.labsShown[key]?`${block.labsShown[key].value} ${unit} · ${calendarDate(block.labsShown[key].on,locale)}`:t('Not available','Հասանելի չէ','Недоступно')}</dd></div>)}
   <div><dt>{t('Hypertension-mediated organ damage','Հիպերտենզիայով պայմանավորված օրգանների վնասում','Поражение органов вследствие гипертензии')}</dt><dd>{hmod}{a.hmod.reasons.length?`: ${a.hmod.reasons.map(reason=>hmodReasons[reason]).join(', ')}`:''}</dd></div>
   <div><dt>SCORE2</dt><dd>{a.score2.state==='applicable'?(a.score2.percent===null?t('Not entered','Մուտքագրված չէ','Не внесено'):`${a.score2.percent}%`):a.score2.state==='off'?t('Not applicable','Կիրառելի չէ','Не применяется'):t('Applicability not established','Կիրառելիությունը որոշված չէ','Применимость не установлена')}{a.score2.reasons.map(reason=><p key={reason}>{local(score2ReasonCopy[reason])}</p>)}</dd></div>
  </dl></details>
  <ResultEntryForm disabled={busy} memberId={block.memberId} locale={locale} entries={block.entries} score2Missing={a.gates.includes('score2_missing')} score2Applicable={a.score2.state==='applicable'} onBusy={value=>{setSaving(value);if(value){setChecked(false);setStale(true);setMessage(null);}}} onSaved={onSaved}/>
  <details className="dcv2-full-report"><summary>{t('Review full report','Վերանայել ամբողջական հաշվետվությունը','Проверить полный отчёт')}</summary>
   <div role="group" aria-label={t('Report language','Հաշվետվության լեզու','Язык отчёта')} className="flex flex-wrap gap-2 py-2">
    {(['hy','en'] as const).map(lang=><button type="button" key={lang} aria-pressed={previewLanguage===lang} onClick={()=>setPreviewLanguage(lang)}>{lang==='hy'?t('Armenian','Հայերեն','Армянский'):t('English','Անգլերեն','Английский')}</button>)}
   </div>
   <GpReportPreview blocks={block.reportBlocks[previewLanguage]} lang={previewLanguage}/>
  <div className="dcv2-approval"><label><input type="checkbox" checked={checked} disabled={busy||saving||stale} onChange={event=>setChecked(event.target.checked)}/>{gpReportConfirmation(locale)}</label><button type="button" disabled={!checked||busy||saving||stale} onClick={()=>void approve()}>{busy?t('Saving…','Պահպանվում է…','Сохраняется…'):t('Approve this report','Հաստատել հաշվետվությունը','Утвердить этот отчёт')}</button></div>
  </details>
  {stale&&<p role="status">{t('This view may be stale. Refresh before approving.','Այս տեսքը կարող է հնացած լինել։ Հաստատելուց առաջ թարմացրեք։','Данные могли устареть. Обновите перед утверждением.')}</p>}
  {message&&<p role="status">{message}</p>}
  <button type="button" disabled={busy||saving} onClick={()=>void refresh()}>{t('Refresh results','Թարմացնել արդյունքները','Обновить результаты')}</button>
  <p>{t('Nothing is sent to anyone.','Ոչինչ ոչ ոքի չի ուղարկվում։','Ничего никому не отправляется.')}</p>
 </section>;
}

/** Full dated history beside the existing clinical results/report block. */
export function LabResultsHistory({values,locale}:{values:PatientLabValue[];locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <section><h3>{t('All results, newest first','Բոլոր արդյունքները՝ նորերից սկսած','Все результаты, сначала новые')}</h3>
  {!values.length&&<p>{t('No values to show yet. Check the files above.','Ցուցադրվող արժեքներ դեռ չկան։ Ստուգեք վերևի ֆայլերը։','Показателей пока нет. Проверьте файлы выше.')}</p>}
  <ul>{values.map(v=><li key={`${v.source}:${v.id}`}>
   {analyteDisplayName(v.testName,locale,v.catalogueRef)}: {v.value} {v.unit} · {v.on?calendarDate(v.on,locale):t('Date not recorded','Ամսաթիվը գրանցված չէ','Дата не указана')} · {v.mark==='reviewed'?t('Reviewed','Վերանայված','Проверено'):v.mark==='member-reported'?t('Member-reported','Անդամի հաղորդած','Со слов участника'):t('Not reviewed','Չվերանայված','Не проверено')}
  </li>)}</ul>
 </section>;
}
