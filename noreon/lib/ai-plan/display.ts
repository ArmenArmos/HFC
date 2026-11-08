import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {PlanItem} from './contracts';

/** Presentation only. Keep the original items and references for audit and adoption. */
export function planDisplayText(text:string,locale:StaffLocale='en'):string{
 return text
  .replaceAll(AI_READ_LABEL.en,AI_READ_LABEL[locale])
  .replace('Available here:',st(locale,'Available here:','Այստեղ առկա է՝','Доступно здесь:'))
  .replace(/NRN-CLIN-ALG-001(?: v[\d.]+)?/g,st(locale,'Screening protocol','Սքրինինգի արձանագրություն','Протокол скрининга'))
  .replace(/NRN-LAB-CAT-001(?: v[\d.]+)?/g,st(locale,'Laboratory protocol','Լաբորատոր արձանագրություն','Лабораторный протокол'))
  .replace(/\b(?:NRN-[A-Z0-9]+(?:-[A-Z0-9]+)+|RF-\d{2}|Q\d+|C\d+)(?:[–-][CQ]?\d+)?\b:?\s*/g,'')
  .replace(/\([\s,;]*\)/g,'').replace(/\(\s*[,;]\s*/g,'(')
  .replace(/[ \t]+([,.;])/g,'$1').replace(/[ \t]{2,}/g,' ').trim();
}

export function planSourceLabel(source:PlanItem['source'],locale:StaffLocale='en'):string{
 if(source.kind==='rule'||source.kind==='questionnaire')return st(locale,'Questionnaire answer','Հարցաշարի պատասխան','Ответ на вопрос анкеты');
 if(source.kind==='lab')return `${st(locale,'Lab report','Լաբորատոր հաշվետվություն','Лабораторный отчёт')}: ${planDisplayText(source.label,locale)}`;
 if(source.kind==='protocol'&&/NRN-LAB|Lab protocol/.test(source.ref+' '+source.label))return st(locale,'Laboratory protocol','Լաբորատոր արձանագրություն','Лабораторный протокол');
 return planDisplayText(source.label,locale);
}
