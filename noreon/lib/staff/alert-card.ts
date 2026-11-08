import {alertReasons,resolutionLabel,sourceLabel,type CareAlert} from '@/lib/care-alerts/contracts';
import {staffDisplayText,staffReviewStep} from './display-text';
import {staffAlertReason} from '@/lib/staff/alert-label';
import {st} from '@/lib/staff/staff-locale-copy';
import type {Locale} from '@/lib/locale';

/** Display only. Never infer symptom onset, clinical advice or an alert state from its copy. */
export function alertCardFields(alert:CareAlert,locale:Locale):{symptom:string;onset:string;severity:string;source:string;next:string;count:number;owner?:string;escalation?:string;acknowledgement?:string;recordedAction?:string}{
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const fallback=t("Urgent alert, open the conversation to read the member's words",'Շտապ ահազանգ, բացեք զրույցը՝ անդամի գրածը կարդալու համար','Срочное оповещение, откройте разговор, чтобы прочитать слова участника');
 const known=alert.reason!=='questionnaire_unknown_rule'&&alertReasons.some(reason=>reason===alert.reason);
 const reason=known?staffAlertReason(alert,locale):fallback;
 // Unknown registry ids and technical labels are never made into guessed clinical wording.
 const symptom=/RF-\d|_|care_alert|NRN|zoe\.|rule/i.test(reason)?fallback:reason;
 function time(value:string,date:boolean){
  const instant=new Date(value);
  if(!Number.isFinite(instant.getTime()))return t('Time unavailable','Ժամն անհասանելի է','Время недоступно');
  return new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{timeZone:'Asia/Yerevan',...(date?{day:'2-digit',month:'short',year:'numeric'} as const:{}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
 }
 // This is the first recorded alert time. CareAlert has no member-reported onset field.
 const since=time(alert.createdAt,true);
 const ruTimes=new Intl.PluralRules('ru').select(alert.occurrences)==='few'?'раза':'раз';
 const onset=t(`Since ${since}`,`${since}-ից`,`С ${since}`)+(alert.occurrences>1?t(` · ${alert.occurrences} times, last ${time(alert.lastSeenAt,false)}`,` · ${alert.occurrences} անգամ, վերջինը՝ ${time(alert.lastSeenAt,false)}`,` · ${alert.occurrences} ${ruTimes}, последний раз в ${time(alert.lastSeenAt,false)}`):'');
 const name=alert.acknowledgedBy??t('Name unavailable','Անունն անհասանելի է','Имя недоступно');
 const next=alert.state==='resolved'?(alert.resolution?resolutionLabel(alert.resolution,locale):t('Alert resolved','Ահազանգը լուծված է','Оповещение закрыто')):alert.state==='acknowledged'
  ?t(`Acknowledged by ${name}. Record what you did when done`,`Ստացումը հաստատել է ${name}։ Ավարտելուց հետո գրանցեք՝ ինչ եք արել`,`Подтверждено: ${name}. Когда закончите, запишите, что вы сделали`)
  :!known||alert.reason==='questionnaire_unknown_rule'?staffReviewStep(locale):t('Contact the member, then record what you did','Կապ հաստատեք անդամի հետ, ապա գրանցեք՝ ինչ եք արել','Свяжитесь с участником, затем запишите, что вы сделали');
 const owner=(alert.escalatedAt?alert.primaryOwnerName??alert.ownerName:alert.ownerName)??t('Not assigned','Նշանակված չէ','Не назначен');
 const backup=alert.escalatedTo==='nurse'?(alert.primaryOwnerRole==='nurse'?alert.primaryOwnerName:alert.ownerRole==='nurse'?alert.ownerName:null)??t('the nurse','բուժքրոջը','медсестре'):alert.escalatedDoctorName??alert.doctorName??t('the doctor','բժշկին','врачу');
 const escalation=alert.escalatedAt?`${t('Escalated to','Փոխանցվել է','Передано')} ${backup} ${t('at','ժամը','в')} ${time(alert.escalatedAt,true)}`:undefined;
 const acknowledgement=alert.acknowledgedAt?`${t('Acknowledged by','Հաստատել է','Подтвердил')} ${name} ${t('at','ժամը','в')} ${time(alert.acknowledgedAt,true)}`:undefined;
 const recordedAction=alert.nextAction?`${alert.nextAction} · ${alert.nextActionBy??t('Name unavailable','Անունն անհասանելի է','Имя недоступно')} · ${alert.nextActionAt?time(alert.nextActionAt,true):t('Time unavailable','Ժամն անհասանելի է','Время недоступно')}${alert.nextActionDueAt?` · ${t('Due','Ժամկետ','Срок')}: ${time(alert.nextActionDueAt,true)}`:''}`:undefined;
 // Keep the recorded action separate so every surface can label static guidance "Suggested step".
 return {symptom,onset,severity:t('Urgent','Շտապ','Срочно'),source:sourceLabel(alert.source,locale),next:staffDisplayText(alert.state==='resolved'?next:recordedAction??next,locale),count:alert.occurrences,owner,escalation,acknowledgement,recordedAction:recordedAction?staffDisplayText(recordedAction,locale):undefined};
}
