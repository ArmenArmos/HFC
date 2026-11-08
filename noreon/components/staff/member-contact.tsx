import {Phone,Send} from 'lucide-react';
import {phoneText,type MemberContact} from '@/lib/staff/member-contact-schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
const link='inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
/** QA F-01: how an admin reaches a member. Telegram is the only messaging channel, so the
 * Telegram link opens a chat with the member's number from the admin's own Telegram. */
export function MemberContactLine({contact,locale='en'}:{contact:MemberContact|null|undefined;locale?:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(contact===null)return <p role="status" className="text-caption text-muted-foreground">{t('Contact details are unavailable. Reload to try again.','Կապի տվյալներն անհասանելի են։ Կրկին փորձելու համար թարմացրեք։','Контактные данные недоступны. Обновите, чтобы повторить попытку.')}</p>;
 if(!contact?.phone)return <p className="text-caption text-muted-foreground">{t('No phone number recorded for this member.','Այս անդամի հեռախոսահամարը գրանցված չէ։','Номер телефона участника не указан.')}</p>;
 const digits=contact.phone.slice(1);
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   <a href={`tel:${contact.phone}`} className={link}><Phone className="size-4 shrink-0" aria-hidden/><span className="whitespace-nowrap">{phoneText(contact.phone)}</span></a>
   <a href={`https://t.me/+${digits}`} target="_blank" rel="noreferrer" className={link}><Send className="size-4 shrink-0" aria-hidden/>{t('Write on Telegram','Գրել Telegram-ով','Написать в Telegram')}</a>
  </div>
  <p className="text-caption text-muted-foreground">{contact.telegramLinked?t('Linked to the Noreon Telegram bot.','Կապակցված է Noreon-ի Telegram բոտին։','Подключён к боту Noreon в Telegram.'):t('Not linked to the Noreon Telegram bot.','Կապակցված չէ Noreon-ի Telegram բոտին։','Не подключён к боту Noreon в Telegram.')} {t('The Telegram link opens a chat from your own account if the member’s privacy settings allow it; otherwise call.','Telegram-ի հղումը բացում է զրույց ձեր հաշվից, եթե անդամի գաղտնիության կարգավորումները թույլ են տալիս։ Հակառակ դեպքում զանգահարեք։','Ссылка открывает чат с вашей учётной записи Telegram, если настройки конфиденциальности участника это позволяют. Иначе позвоните.')}</p>
 </div>;
}
