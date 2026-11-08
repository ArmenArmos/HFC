import {staffDisplayText} from '@/lib/staff/display-text';
import type {CareAlert} from '@/lib/care-alerts/contracts';
import type {Locale} from '@/lib/locale';
import {alertCardFields} from '@/lib/staff/alert-card';
import {st} from '@/lib/staff/staff-locale-copy';

/** Phrasing elements also keep the same labelled layout valid inside a member button. */
export function AlertCardLines(props:({alert:CareAlert}|{fields:ReturnType<typeof alertCardFields>})&{locale:Locale}){
 const {locale}=props,fields='alert' in props?alertCardFields(props.alert,locale):props.fields,t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const labels={symptom:t('Symptom','Ախտանիշ','Симптом'),onset:t('Onset (first recorded alert)','Սկիզբ (առաջին գրանցված ահազանգ)','Начало (первое оповещение)'),severity:t('Severity','Հրատապություն','Срочность'),source:t('Source','Աղբյուր','Источник'),next:fields.recordedAction===fields.next?t('Next action','Հաջորդ գործողություն','Следующее действие'):t('Suggested step','Առաջարկվող քայլ','Предлагаемый шаг')};
 return <span data-alert-card="" className="flex min-w-0 w-full flex-col gap-1 break-words text-body2 [overflow-wrap:anywhere]">
  {(['symptom','onset','severity','source','next'] as const).map(key=><span key={key} data-alert-field={key} data-alert-next-action={key==='next'&&fields.recordedAction===fields.next?'':undefined} className="block"><strong className="font-medium">{labels[key]}: </strong>{staffDisplayText(fields[key],locale)}</span>)}
  <span data-alert-owner=""><strong className="font-medium">{t('Owner','Պատասխանատու','Ответственный')}: </strong>{fields.owner??t('Not assigned','Նշանակված չէ','Не назначен')}</span>
  {fields.escalation&&<span data-alert-escalation="">{fields.escalation}</span>}
  {fields.acknowledgement&&<span data-alert-acknowledgement="">{fields.acknowledgement}</span>}
 </span>;
}
