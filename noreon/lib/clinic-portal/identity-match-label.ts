import type {Locale} from '@/lib/locale';

/** Only fixed match outcomes cross the clinic boundary. */
export function clinicIdentityMatchLabel(kind:'name'|'birthYear',match:'yes'|'no'|'unknown',locale:Locale):string{
 const labels={
  name:{
   yes:{en:'Name on the sheet matches',hy:'Թերթիկում նշված անունը համընկնում է',ru:'Имя на бланке совпадает'},
   no:{en:'Name on the sheet does not match',hy:'Թերթիկում նշված անունը չի համընկնում',ru:'Имя на бланке не совпадает'},
   unknown:{en:'Name match could not be checked',hy:'Անվան համընկնումը չհաջողվեց ստուգել',ru:'Не удалось проверить совпадение имени'},
  },
  birthYear:{
   yes:{en:'Birth year on the sheet matches',hy:'Թերթիկում նշված ծննդյան տարեթիվը համընկնում է',ru:'Год рождения на бланке совпадает'},
   no:{en:'Birth year on the sheet does not match',hy:'Թերթիկում նշված ծննդյան տարեթիվը չի համընկնում',ru:'Год рождения на бланке не совпадает'},
   unknown:{en:'Birth year match could not be checked',hy:'Ծննդյան տարեթվի համընկնումը չհաջողվեց ստուգել',ru:'Не удалось проверить совпадение года рождения'},
  },
 };
 return labels[kind][match][locale];
}
