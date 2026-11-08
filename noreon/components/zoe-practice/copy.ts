import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {PracticePatient} from '@/lib/zoe/practice/patients';
export function patientCopy(p:PracticePatient,l:StaffLocale){
 const titles:Record<string,[string,string]>={
  'practice-ldl-well':['Ստատինով լավ ընթացք','Всё хорошо на статине'],
  'practice-ldl-aches':['Թիրախից բարձր LDL և մկանային ցավ','ЛПНП выше цели и боль в мышцах'],
  'practice-post-mi':['Սրտի կաթվածից հետո, բաց թողնված ընդունումներ','После инфаркта, пропуски приёма'],
  'practice-hy-worried':['Մտահոգված է ճնշմամբ և LDL-ով','Беспокоится о давлении и ЛПНП'],
  'practice-new-ldl':['LDL-ի նոր արդյունք','Новый результат ЛПНП'],
 };
 const translated=titles[p.id];
 return {name:p.name.replace('(fictional)',st(l,'(fictional)','(հորինված)','(вымышленный)')),title:translated?st(l,p.title,...translated):p.title,
  detail:st(l,`Age ${p.record.memberRecord.ageYears}. ${p.locale==='hy'?'Armenian':'English'} conversation.`,`Տարիքը՝ ${p.record.memberRecord.ageYears}։ Զրույցը՝ ${p.locale==='hy'?'հայերեն':'անգլերեն'}։`,`Возраст: ${p.record.memberRecord.ageYears}. Переписка ${p.locale==='hy'?'на армянском':'на английском'}.`)};
}
