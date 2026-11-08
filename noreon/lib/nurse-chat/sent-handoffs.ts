import {z} from 'zod';
import {staffMemberIdentitySchema} from '@/lib/staff/member-search-schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {taskStatusLabel} from '@/lib/staff/real-coordination/status-copy';
import {handoffTopics} from './handoffs';

export const sentHandoffSchema=z.strictObject({
 taskId:z.uuid(),member:staffMemberIdentitySchema,sentAt:z.iso.datetime({offset:true}),
 topic:z.enum(handoffTopics),observation:z.string(),
 status:z.enum(['open','awaiting-member','awaiting-doctor','completed','cancelled']),
 resolution:z.strictObject({note:z.string(),by:z.string(),at:z.iso.datetime({offset:true})}).nullable(),
});
export const sentHandoffsSchema=z.strictObject({items:z.array(sentHandoffSchema).max(50),hasMore:z.boolean()});
export type SentHandoffs=z.infer<typeof sentHandoffsSchema>;
export const handoffResolved=(status:string)=>status==='completed'||status==='cancelled';

// HY/RU drafts for Roo. These statuses describe the handoff, rather than a generic task.
export function sentHandoffStatus(locale:StaffLocale,status:SentHandoffs['items'][number]['status']){
 return status==='completed'?st(locale,'Completed','Ավարտված է','Завершено'):
  status==='cancelled'?st(locale,'Cancelled','Չեղարկված է','Отменено'):
  status==='awaiting-doctor'?st(locale,'Awaiting doctor','Սպասում է բժշկին','Ожидает врача'):
  taskStatusLabel(locale,status);
}
export function sentHandoffsCopy(locale:StaffLocale){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return {
  title:t('Sent to the doctor','Ուղարկված է բժշկին','Отправлено врачу'),
  empty:t('You have not handed anything over yet.','Դուք դեռ ոչինչ չեք փոխանցել։','Вы пока ничего не передавали.'),
  observation:t('Your observation','Ձեր դիտարկումը','Ваше наблюдение'),
  resolution:t('Resolution','Ավարտի նշում','Итог'),
  open:t('Open conversation','Բացել զրույցը','Открыть переписку'),
  older:t('Only your latest 50 handoffs are shown. Older handoffs are not shown.','Ցուցադրված են միայն ձեր վերջին 50 փոխանցումները։ Ավելի հին փոխանցումները չեն ցուցադրվում։','Показаны только ваши последние 50 передач. Более старые передачи не показаны.'),
  unavailable:t('Handoffs are unavailable. Try again.','Փոխանցումները հասանելի չեն։ Կրկին փորձեք։','Передачи недоступны. Попробуйте ещё раз.'),
 };
}
