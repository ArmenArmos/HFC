import {z} from 'zod';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export const doctorHandoverSchema=z.strictObject({locale:z.enum(['en','hy','ru']),memberId:z.uuid(),nurseId:z.uuid(),conversationId:z.uuid(),taskId:z.uuid(),requestId:z.uuid(),note:z.string().min(1).max(2000).nullable()});
export type DoctorHandover=z.infer<typeof doctorHandoverSchema>;
export type HandoverTarget={memberId:string;memberName:string;nurseId:string;nurseName:string;conversationId:string};
export function doctorHandoverCopy(l:StaffLocale){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 return {
  noNurse:t('No nurse is assigned to this member yet, so there is nobody to hand over to.','Այս անդամին դեռ բուժքույր կցված չէ, ուստի փոխանցելու մարդ չկա։','Этому участнику ещё не назначена медсестра, поэтому передать задачу некому.'),
  noConversation:t('There is no conversation with this member yet, so there is nothing to hand over.','Այս անդամի հետ դեռ զրույց չկա, ուստի փոխանցելու բան չկա։','Переписки с этим участником ещё нет, поэтому передавать нечего.'),
  prepareFailed:t('The hand-over could not be prepared. Try again.','Չհաջողվեց պատրաստել փոխանցումը։ Փորձեք կրկին։','Не удалось подготовить передачу. Попробуйте снова.'),
  title:t('From the doctor','Բժշկի կողմից','От врача'),
  noNote:t('Review the conversation','Վերանայել զրույցը','Рассмотреть разговор'),
  open:t('Open the member first','Նախ բացեք անդամին','Сначала откройте участника'),
  unavailable:t('You cannot hand over to this member’s nurse. Check the assignment and your access.','Դուք չեք կարող փոխանցել այս անդամի բուժքրոջը։ Ստուգեք նշանակումը և ձեր հասանելիությունը։','Вы не можете передать задачу медсестре этого участника. Проверьте назначение и свой доступ.'),
  confirm:t('Hand over to the nurse','Փոխանցել բուժքրոջը','Передать медсестре'),
  note:t('Your note','Ձեր նշումը','Ваша заметка'),send:t('Send','Ուղարկել','Отправить'),cancel:t('Cancel','Չեղարկել','Отменить'),
  cancelled:t('Cancelled','Չեղարկված է','Отменено'),
  sending:t('Sending to the nurse…','Ուղարկվում է բուժքրոջը…','Отправляем медсестре…'),
  sent:(name:string)=>t(`Sent to ${name}`,`Ուղարկված է ${name}-ին`,`Отправлено: ${name}`),
  working:t('The nurse is working on it','Բուժքույրը զբաղվում է դրանով','Медсестра занимается этим'),
  done:t('Done','Ավարտված է','Выполнено'),closed:t('Closed','Փակված է','Закрыто'),
  failed:t('The result could not be confirmed. Your note is kept. Check or retry this handover.','Արդյունքը չհաջողվեց հաստատել։ Ձեր նշումը պահպանված է։ Ստուգեք կամ կրկնեք այս փոխանցումը։','Результат не удалось подтвердить. Ваша заметка сохранена. Проверьте или повторите эту передачу.'),
  retry:t('Check or retry this handover','Ստուգել կամ կրկնել այս փոխանցումը','Проверить или повторить передачу'),
  reassign:t('Check the nurse assignment for this task.','Ստուգեք այս առաջադրանքի բուժքրոջ նշանակումը։','Проверьте, какая медсестра назначена на эту задачу.'),
  refreshFailed:t('You cannot check the task state right now. Try again.','Այս պահին չեք կարող ստուգել առաջադրանքի վիճակը։ Փորձեք կրկին։','Сейчас не удалось проверить состояние задачи. Попробуйте снова.'),
 };
}
