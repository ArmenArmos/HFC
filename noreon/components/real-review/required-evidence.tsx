import type {ComponentType,ReactNode} from 'react';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {hasEvidencePath,isInvestigationTest,type BodyMeasuresSource,type InvestigationRecord,type RequiredEvidenceSources,type StaffReadingSource,type WeekSource} from '@/lib/patient-care/required-evidence';

type Command=ComponentType<{snapshot:ClinicalSnapshot;operation:string;label:string;locale:StaffLocale;children?:ReactNode}>;
type Test={id:string;title:string};
const input='mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2';
const stamp=yerevanStamp;
const pressure=(r:{systolic:number;diastolic:number;pulse:number|null},pulseWord:string)=>`${r.systolic}/${r.diastolic}${r.pulse===null?'':`, ${pulseWord} ${r.pulse}`}`;
const reading=(r:{systolic:number;diastolic:number;pulse:number|null;measuredAt:string},locale:StaffLocale,pulseWord:string)=>`${stamp(r.measuredAt,locale)}: ${pressure(r,pulseWord)}`;

/** The doctor's confirmation form for one source. Nothing is calculated: the doctor reads it and confirms. */
function Confirm({snapshot,test,sourceId,locale,Command,attest}:{snapshot:ClinicalSnapshot;test:Test;sourceId:string;locale:StaffLocale;Command:Command;attest:string}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <Command snapshot={snapshot} operation="receive-evidence" locale={locale} label={t('Confirm for this requirement','Հաստատել այս պահանջի համար','Подтвердить для этого требования')}>
  <input type="hidden" name="testId" value={test.id}/><input type="hidden" name="sourceId" value={sourceId}/>
  <label className="flex min-h-11 gap-3"><input type="checkbox" name="sourceChecked" required className="size-5 shrink-0"/>{attest}</label>
 </Command>;
}
function Investigation({record,locale}:{record:InvestigationRecord;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <dl className="grid gap-1 text-body2 sm:grid-cols-[auto_1fr] sm:gap-x-3">
  <dt className="text-muted-foreground">{t('Date','Ամսաթիվ','Дата')}</dt><dd>{record.performedOn}</dd>
  <dt className="text-muted-foreground">{t('Result','Արդյունք','Результат')}</dt><dd>{record.result==='normal'?t('Normal','Նորմալ','Норма'):t('Abnormal','Շեղում','Отклонение')}{record.finding?`: ${record.finding}`:''}</dd>
  <dt className="text-muted-foreground">{t('Source','Աղբյուր','Источник')}</dt><dd className="break-words">{record.source}</dd>
  <dt className="text-muted-foreground">{t('Recorded by','Գրանցել է','Записал')}</dt><dd>{record.recordedByName}, {stamp(record.recordedAt,locale)}</dd>
 </dl>;
}
function Investigations({snapshot,test,records,locale,Command}:{snapshot:ClinicalSnapshot;test:Test;records:InvestigationRecord[];locale:StaffLocale;Command:Command}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const sourceId=snapshot.review?.evidenceReceipts?.[test.id]?.sourceId,confirmed=records.find(record=>record.id===sourceId);
 return <div className="space-y-3">
  {confirmed&&<Investigation record={confirmed} locale={locale}/>}
  {records.filter(record=>record!==confirmed).map(record=><div key={record.id} className="space-y-2 rounded-md border p-3"><Investigation record={record} locale={locale}/>
   <Confirm snapshot={snapshot} test={test} sourceId={record.id} locale={locale} Command={Command} attest={t('I read the original tracing or report.','Ես կարդացել եմ բնօրինակ գրառումը կամ եզրակացությունը։','Я прочитал(а) оригинальную запись или заключение.')}/></div>)}
  <details open={!sourceId&&!records.length}><summary className="min-h-11 cursor-pointer text-body2 font-medium">{t(`Record ${test.title}`,`Գրանցել՝ ${test.title}`,`Записать: ${test.title}`)}</summary>
   <div className="pt-3"><Command snapshot={snapshot} operation="record-investigation" locale={locale} label={t('Save and confirm','Պահպանել և հաստատել','Сохранить и подтвердить')}>
    <input type="hidden" name="testId" value={test.id}/>
    <p className="text-caption text-muted-foreground">{t('It must be dated on or after the questionnaire. This record cannot be changed afterwards and stays with the care team.','Ամսաթիվը պետք է լինի հարցաշարի օրը կամ դրանից հետո։ Այս գրառումը հետո չի կարող փոխվել և մնում է խնամքի թիմի մոտ։','Дата должна быть не раньше анкеты. Эту запись нельзя изменить, и она остаётся у медицинской команды.')}</p>
    <label className="block">{t('Date of the investigation','Հետազոտության ամսաթիվ','Дата исследования')}<input type="date" name="performedOn" required className={`${input} max-w-64`}/></label>
    <fieldset className="space-y-1"><legend>{t('Result','Արդյունք','Результат')}</legend>
     <label className="flex min-h-11 items-center gap-3"><input type="radio" name="result" value="normal" required className="size-5 shrink-0"/>{t('Normal','Նորմալ','Норма')}</label>
     <label className="flex min-h-11 items-center gap-3"><input type="radio" name="result" value="abnormal" required className="size-5 shrink-0"/>{t('Abnormal','Շեղում','Отклонение')}</label></fieldset>
    <label className="block">{t('Finding (required when abnormal)','Գտածո (պարտադիր է շեղման դեպքում)','Описание (обязательно при отклонении)')}<textarea name="finding" maxLength={2000} className={input}/></label>
    <label className="block">{t('Source: where it was done and who read it','Աղբյուր. որտեղ է արվել և ով է կարդացել','Источник: где выполнено и кто прочитал')}<input name="source" required minLength={3} maxLength={500} className={input}/></label>
    <label className="flex min-h-11 gap-3"><input type="checkbox" name="sourceChecked" required className="size-5 shrink-0"/>{t('I read the original tracing or report.','Ես կարդացել եմ բնօրինակ գրառումը կամ եզրակացությունը։','Я прочитал(а) оригинальную запись или заключение.')}</label>
   </Command></div></details>
 </div>;
}
function Week({week,locale}:{week:WeekSource;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),pulse=t('pulse','զարկ','пульс');
 return <div className="space-y-1 text-body2"><p className="font-medium">{t(`BP week from ${week.startsOn}: ${week.readings.length} readings saved`,`Ճնշման շաբաթ՝ ${week.startsOn}-ից. պահպանված է ${week.readings.length} չափում`,`Неделя АД с ${week.startsOn}: сохранено измерений: ${week.readings.length}`)}</p>
  <ol className="list-inside list-decimal">{week.readings.map(r=><li key={r.id}>{t('Day','Օր','День')} {r.day}, {r.slot==='morning'?t('morning','առավոտ','утро'):t('evening','երեկո','вечер')}. {reading(r,locale,pulse)}</li>)}</ol></div>;
}
function StaffReading({r,locale}:{r:StaffReadingSource;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <p className="text-body2">{reading(r,locale,t('pulse','զարկ','пульс'))}. {t('Taken by','Չափել է','Измерил(а)')} {r.takenBy}</p>;
}
function Body({m,locale}:{m:BodyMeasuresSource;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const name=(f:string)=>f==='weight'?t('Weight','Քաշ','Вес'):f==='waist'?t('Waist','Գոտկատեղ','Талия'):t('Height','Հասակ','Рост');
 return <div className="text-body2"><p>{stamp(m.observedAt,locale)}. {t('Taken by','Չափել է','Измерил(а)')} {m.takenBy}</p><ul>{m.observations.map(o=><li key={`${o.field}:${o.observedAt}`}>{name(o.field)}: {o.value} {o.unit}</li>)}</ul></div>;
}

/** One required clinic or home test on the Evidence tab: what is confirmed, and what the doctor can confirm it from. */
export function RequiredEvidence({snapshot,test,sources,locale,Command}:{snapshot:ClinicalSnapshot;test:Test;sources:RequiredEvidenceSources|null;locale:StaffLocale;Command:Command}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(!hasEvidencePath(test.id))return null;
 if(!sources)return <p role="alert">{t('The evidence for this test could not be read. Reload the page.','Այս հետազոտության տվյալները հնարավոր չեղավ կարդալ։ Թարմացրեք էջը։','Не удалось прочитать данные этого исследования. Обновите страницу.')}</p>;
 const receipt=snapshot.review?.evidenceReceipts?.[test.id];
 const confirmed=<T extends {id:string}>(list:T[])=>receipt?list.find(s=>s.id===receipt.sourceId)??null:null;
 const pick=<T extends {id:string}>(list:T[],render:(item:T)=>ReactNode,attest:string,none:string)=>{
  const chosen=confirmed(list),rest=list.filter(s=>s!==chosen);
  return <div className="space-y-3">{chosen&&render(chosen)}
   {rest.map(item=><div key={item.id} className="space-y-2 rounded-md border p-3">{render(item)}<Confirm snapshot={snapshot} test={test} sourceId={item.id} locale={locale} Command={Command} attest={attest}/></div>)}
   {!list.length&&<p>{none}</p>}</div>;
 };
 const stale=receipt&&!(sources[test.id] as {id:string}[]).some(s=>s.id===receipt.sourceId);
 return <div className="space-y-3">
  {receipt&&!stale&&<p role="status" className="font-medium">{t(`Confirmed ${stamp(receipt.at,locale)}. Publication rechecks it.`,`Հաստատվել է ${stamp(receipt.at,locale)}։ Հրապարակման ժամանակ կրկին կստուգվի։`,`Подтверждено ${stamp(receipt.at,locale)}. При публикации проверяется повторно.`)}</p>}
  {stale&&<p role="alert">{t('The confirmed source changed or no longer counts. Confirm this requirement again.','Հաստատված աղբյուրը փոխվել է կամ այլևս չի հաշվվում։ Կրկին հաստատեք այս պահանջը։','Подтверждённый источник изменился или больше не засчитывается. Подтвердите это требование снова.')}</p>}
  {isInvestigationTest(test.id)?<Investigations snapshot={snapshot} test={test} records={sources[test.id] as InvestigationRecord[]} locale={locale} Command={Command}/>
  :test.id==='bp-home-log'?pick(sources['bp-home-log'],w=><Week week={w} locale={locale}/>,t('I read every reading in this week.','Ես կարդացել եմ այս շաբաթվա բոլոր չափումները։','Я прочитал(а) все измерения этой недели.'),t('No finished BP week since the questionnaire yet. Start a 7-day week from Follow-up.','Հարցաշարից հետո ավարտված ճնշման շաբաթ դեռ չկա։ Սկսեք 7-օրյա շաբաթը «Հետագա քայլեր» բաժնից։','После анкеты ещё нет завершённой недели измерений. Начните 7-дневную неделю в разделе «Дальнейшие шаги».'))
  :test.id==='bp-visit'?pick(sources['bp-visit'],r=><StaffReading r={r} locale={locale}/>,t('I read this reading, taken by staff.','Ես կարդացել եմ աշխատակցի կատարած այս չափումը։','Я прочитал(а) это измерение, выполненное сотрудником.'),t('No reading taken by staff since the questionnaire yet. A member’s own reading does not count here.','Հարցաշարից հետո աշխատակցի կատարած չափում դեռ չկա։ Անդամի սեփական չափումն այստեղ չի հաշվվում։','После анкеты ещё нет измерения, выполненного сотрудником. Собственное измерение участника здесь не засчитывается.'))
  :pick(sources.anthropometry,m=><Body m={m} locale={locale}/>,t('I read these measurements, taken by staff.','Ես կարդացել եմ աշխատակցի կատարած այս չափումները։','Я прочитал(а) эти измерения, выполненные сотрудником.'),t('No visit with both weight and waist since the questionnaire yet. A nurse records them during a visit.','Հարցաշարից հետո քաշով և գոտկատեղով այց դեռ չկա։ Բուժքույրը դրանք գրանցում է այցի ընթացքում։','После анкеты ещё нет визита с весом и талией. Медсестра записывает их во время визита.'))}
 </div>;
}
