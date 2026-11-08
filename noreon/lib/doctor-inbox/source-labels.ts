import {alertSources,sourceLabel} from '@/lib/care-alerts/contracts';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';

type Source={type:string;ref:string;page?:number|null};

/** What a doctor reads under an item: kinds of record in plain words. Ids, rule codes and sequence numbers never print. */
export function sourceKindLabel(s:Source,l:Locale):string{
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 switch(s.type){
  case 'care_alert':return t('Urgent alert','Շտապ ահազանգ','Срочное оповещение');
  case 'source':{const known=alertSources.find(a=>a===s.ref);return known?sourceLabel(known,l):t('Alert source','Ահազանգի աղբյուր','Источник оповещения');}
  case 'rule':return t('Safety rule','Անվտանգության կանոն','Правило безопасности');
  case 'plan_generation':return t('Care plan draft','Բուժման պլանի նախագիծ','Черновик плана лечения');
  case 'plan_publication':return t('Published care plan','Հրապարակված բուժման պլան','Опубликованный план лечения');
  case 'plan_item':return t('Care plan item','Բուժման պլանի կետ','Пункт плана лечения');
  case 'lab_value':return s.page!=null?t(`Lab value, page ${s.page}`,`Լաբորատոր արժեք, էջ ${s.page}`,`Лабораторный показатель, стр. ${s.page}`):t('Lab value','Լաբորատոր արժեք','Лабораторный показатель');
  case 'lab_file':return t('Lab document','Լաբորատոր փաստաթուղթ','Документ с анализами');
  case 'intake':return t('Symptom questions','Ախտանիշների հարցեր','Вопросы о симптомах');
  case 'draft':return t('Reply draft','Պատասխանի նախագիծ','Черновик ответа');
  case 'conversation':return t('Conversation','Զրույց','Разговор');
  case 'checkpoint':return t('Follow-up checkpoint','Ստուգման կետ','Контрольная точка');
  case 'checkin':return t('Check-in','Ինքնազգացողության նշում','Отметка о самочувствии');
  case 'case_revision':return t('Member record','Անդամի գրառում','Запись об участнике');
  case 'zoe_run':return t('Zoe answer','Zoe-ի պատասխան','Ответ Zoe');
  case 'measurement':return t('Blood pressure reading','Ճնշման չափում','Измерение давления');
  default:return t('Other record','Այլ գրառում','Другая запись');
 }
}

/** One line, each kind once, in the order first seen. */
export function sourcesLine(sources:Source[],l:Locale):string{
 return [...new Set(sources.map(s=>sourceKindLabel(s,l)))].join(' · ');
}
