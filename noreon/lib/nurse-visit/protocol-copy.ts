import {pick,type Locale} from '@/lib/locale';
import type {NurseVisitItem} from './schema';

type Check=Extract<NurseVisitItem,{kind:'check'}>;
/** Presentation translations of database content. Match the version AND original wording:
 * a new clinical revision must never silently inherit an older translation. */
const russian:Record<string,{en:string;ru:string}>={
 "bp-validated-device":{en:"Use a validated upper-arm blood pressure monitor and check that it works.",ru:"Используйте валидированный плечевой тонометр и проверьте, что он работает."},
 "bp-cuff-fit":{en:"Use a cuff that fits the member's arm.",ru:"Используйте манжету, подходящую по размеру руки участника."},
 "bp-seated-rest":{en:"The member is seated and rested before you measure, and you use the correct technique.",ru:"К моменту измерения участник сидит и отдохнул; вы используете правильную технику измерения."},
 "bp-conditions-medicines":{en:"Note the measurement conditions and the medicines the member has taken.",ru:"Отметьте условия измерения и лекарства, которые принял участник."},
 "fasting-8h":{en:"Fasting glucose is ordered: confirm the member has had no food with calories for at least 8 hours.",ru:"Назначена глюкоза натощак: подтвердите, что участник не принимал калорийную пищу не менее 8 часов."},
 "uacr-first-morning":{en:"For urine ACR, take the first morning urine where possible.",ru:"Для анализа мочи на ACR по возможности возьмите первую утреннюю мочу."},
 "uacr-confounders":{en:"Note heavy exercise, fever, a urinary infection or menstruation, if present.",ru:"Отметьте интенсивную физическую нагрузку, лихорадку, инфекцию мочевыводящих путей или менструацию, если они есть."},
 "sample-time-medicines":{en:"Record the sample time and the medicines the member has taken, so they stay with the result.",ru:"Запишите время взятия образца и лекарства, которые принял участник, чтобы эти сведения сохранились вместе с результатом."},
};

export function protocolLabel(item:Check,l:Locale){
 if(l!=='ru')return item.label[l];
 // Urgent wording is protected by the brief pending explicit translation approval.
 if(item.section==='safety')return item.label.hy;
 const translation=russian[item.checkId];
 if(['protocol-draft-1','protocol-draft-2'].includes(item.version)&&translation?.en===item.label.en)return translation.ru;
 return 'Перевод этого пункта недоступен. Уточните инструкцию у медицинской команды перед выполнением.';
}

const sources:Record<string,{hy:string;ru:string}>={
 "Laboratory protocol v2, section 1 (BP confirmation)":{hy:"Լաբորատոր հետազոտությունների արձանագրություն v2, բաժին 1 (ճնշման հաստատում)",ru:"Протокол лабораторных исследований v2, раздел 1 (подтверждение АД)"},
 "Laboratory protocol v2, section 1 (urgency), paragraph 1":{hy:"Լաբորատոր հետազոտությունների արձանագրություն v2, բաժին 1 (հրատապություն), պարբերություն 1",ru:"Протокол лабораторных исследований v2, раздел 1 (срочность), пункт 1"},
 "Laboratory protocol v2, section 1 (urgency), paragraph 2":{hy:"Լաբորատոր հետազոտությունների արձանագրություն v2, բաժին 1 (հրատապություն), պարբերություն 2",ru:"Протокол лабораторных исследований v2, раздел 1 (срочность), пункт 2"},
 "Laboratory protocol v2, section 3 (sampling rules), paragraph 1":{hy:"Լաբորատոր հետազոտությունների արձանագրություն v2, բաժին 3 (նմուշառման կանոններ), պարբերություն 1",ru:"Протокол лабораторных исследований v2, раздел 3 (правила взятия образцов), пункт 1"},
 "Laboratory protocol v2, section 3 (sampling rules), paragraph 2":{hy:"Լաբորատոր հետազոտությունների արձանագրություն v2, բաժին 3 (նմուշառման կանոններ), պարբերություն 2",ru:"Протокол лабораторных исследований v2, раздел 3 (правила взятия образцов), пункт 2"},
};
export function protocolSource(source:string,l:Locale){
 if(l==='en')return source;
 return sources[source]?.[l]??pick(l,{en:source,hy:'Աղբյուրի թարգմանությունն անհասանելի է։ Ճշտեք խնամքի թիմի հետ։',ru:'Перевод источника недоступен. Уточните у медицинской команды.'});
}
