import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export function handBackCopy(key:'confirm'|'inactive'|'changed'|'off'|'unknown'|'saved'|'unread'|'access'|'invalid',l:StaffLocale){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 switch(key){
  case 'access':return notDone('access',l);
  case 'invalid':return notDone('invalid-action',l);
  case 'confirm':return t('Zoe will answer again and a hand-back notice will be queued for this member.','Զոյան կրկին կպատասխանի, և այս անդամի համար վերադարձի ծանուցումը կտեղադրվի հերթում։','Зоя снова будет отвечать, а уведомление о передаче будет поставлено в очередь для этого участника.');
  case 'inactive':return notDone('hand-back-inactive',l);
  case 'changed':return notDone('hand-back-changed',l);
  case 'off':return notDone('hand-back-off',l);
  case 'unknown':return notDone('hand-back-unknown',l);
  case 'saved':return done('hand-back-saved',l);
  case 'unread':return done('hand-back-unread',l);
 }
}
