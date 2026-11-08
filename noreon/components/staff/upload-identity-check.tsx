import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {labEmptyReadMessage} from '@/lib/lab-ai/empty-read-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
export function UploadIdentityChecks({rows,locale,onOpen}:{rows:DoctorUploadOverride[];locale:StaffLocale;onOpen?:(row:DoctorUploadOverride)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <>{rows.map(row=><section key={row.fileId} role="note" className="space-y-2 rounded-lg border border-destructive p-4" data-upload-identity={row.fileId}>
  <p>{t(`Check this file belongs to ${row.memberName}. The name or date of birth on the sheet differed from the member's record.`,
   `Ստուգեք՝ այս ֆայլը պատկանում է ${row.memberName}-ին։ Թերթիկի անունը կամ ծննդյան ամսաթիվը տարբերվել է անդամի գրառումից։`,
   `Проверьте, принадлежит ли этот файл ${row.memberName}. Имя или дата рождения в бланке отличались от записи участника.`)}</p>
  <p>{row.clinicName} · {stamp(row.at,locale)} · {row.fileName}</p>
  <dl className="grid gap-2 sm:grid-cols-2"><div><dt>{t('Sheet','Թերթիկ','Бланк')}</dt><dd className="break-words">{row.sheet.name??'–'} · {row.sheet.birthDate?.slice(0,4)??'–'}</dd></div>
   <div><dt>{t('Member','Անդամ','Участник')}</dt><dd className="break-words"><ChatMemberIdentity memberId={row.memberId} name={row.member.name??row.memberName} member={{...row.member,name:row.member.name??row.memberName}} locale={locale}/></dd></div></dl>
  {row.noValuesRead&&<p>{labEmptyReadMessage(locale)}</p>}
  {!row.noValuesRead&&row.jobState!=='done'&&<p>{t('Lab values not read yet','Լաբորատոր արժեքները դեռ չեն կարդացվել','Лабораторные показатели ещё не прочитаны')}</p>}
  {onOpen&&<><button type="button" className="dcv2-choice" onClick={()=>onOpen(row)}>{t('Check this file','Ստուգել այս ֆայլը','Проверить этот файл')}</button>
   <p>{t('If it is not this member: Tell Noreon to move it','Եթե այս անդամինը չէ՝ ասեք Նորեոն Հելթին տեղափոխել այն','Если файл не этого участника: попросите Нореон Хелс перенести его')}</p></>}
 </section>)}</>;
}
