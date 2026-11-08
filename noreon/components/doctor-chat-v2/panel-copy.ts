import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export function panelLabel(key:string,l:StaffLocale):string{
 const words:Record<string,[string,string,string]>={
  very_high:['Very high risk','Շատ բարձր ռիսկ','Очень высокий риск'],high:['High risk','Բարձր ռիսկ','Высокий риск'],moderate:['Moderate risk','Միջին ռիսկ','Умеренный риск'],low:['Low risk','Ցածր ռիսկ','Низкий риск'],unknown:['Not known','Հայտնի չէ','Неизвестно'],
  at_goal:['At LDL target','ՑԽԼ-ի թիրախում','ЛПНП в целевом диапазоне'],above_goal:['Above LDL target','ՑԽԼ-ի թիրախից բարձր','ЛПНП выше цели'],
  urgent:['Urgent','Շտապ','Срочно'],needs_me:['Needs me','Իմ օգնության կարիքն ունի','Нужна моя помощь'],none:['Nothing waiting','Սպասող գործ չկա','Нет ожидающих задач'],
 };
 const labels=words[key];return labels?st(l,...labels):key;
}
