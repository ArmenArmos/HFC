import {pick,type Locale} from '@/lib/locale';
import {z} from 'zod';

/**
 * Doctor inbox, part 2: threads Zoe fully answered in free mode (20261020060842). The database decides what counts as
 * answered (_zoe_answered_open: nothing forwarded, urgent, flagged or unanswered); this file only parses and words it.
 * The doctor marks a thread reviewed (it leaves the group until the member writes again) or reopens it (back to needs
 * reply until the doctor's next decision), bound to the conversation version they saw.
 */
export const zoeAnsweredUrgencies=['none','self_monitoring','planned','doctor_soon']as const;
export const zoeAnsweredItemSchema=z.object({conversationId:z.uuid(),memberId:z.uuid().transform(v=>v.toLowerCase()),memberName:z.string(),
 version:z.number().int().positive(),runId:z.uuid(),answeredAt:z.string(),urgency:z.enum(zoeAnsweredUrgencies),declined:z.boolean(),
 unanswered:z.number().int().nonnegative(),reviewed:z.boolean(),lastMessageAt:z.string().nullable().optional(),channel:z.enum(['telegram','app']).optional()});
export type ZoeAnsweredItem=z.infer<typeof zoeAnsweredItemSchema>;
export const zoeAnsweredListSchema=z.object({ok:z.literal(true),items:z.array(zoeAnsweredItemSchema)});

type L=Locale;
const t=(l:L,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
export const zoeAnsweredTitle=(l:L)=>t(l,'Answered by Zoe','Պատասխանել է Զոյան','Zoe ответила');
export const zoeAnsweredIntro=(l:L)=>t(l,
 'Zoe answered these members fully and nothing needed you: no urgent sign, nothing sent to you, and the member did not ask for you. Read what Zoe said, then mark it reviewed, or reopen it to reply yourself.',
 'Զոյան ամբողջությամբ պատասխանել է այս անդամներին, և ձեր միջամտությունը պետք չէր՝ շտապ նշան չկա, ձեզ ոչինչ չի ուղարկվել, անդամը ձեզ չի խնդրել։ Կարդացեք Զոյայի պատասխանը, ապա նշեք որպես դիտված կամ վերաբացեք՝ ինքներդ պատասխանելու համար։','Zoe полностью ответила этим участникам, и ваше вмешательство не требовалось: срочных признаков нет, вам ничего не передано, участник не просил вашего участия. Прочитайте ответ Zoe и отметьте его как просмотренный или откройте разговор снова, чтобы ответить самостоятельно.');
export const zoeAnsweredEmpty=(l:L)=>t(l,'Nothing answered by Zoe is waiting for your review.','Զոյայի պատասխաններից ոչինչ չի սպասում ձեր դիտմանը։','Нет ответов Zoe, ожидающих вашего просмотра.');
export const urgencyLabel=(u:ZoeAnsweredItem['urgency'],l:L)=>({none:t(l,'not urgent','ոչ շտապ','не срочно'),self_monitoring:t(l,'self-care and monitoring','ինքնախնամք և հսկողություն','самопомощь и наблюдение'),
 planned:t(l,'next planned visit','հաջորդ պլանային այց','следующий плановый визит'),doctor_soon:t(l,'doctor in the coming days','բժիշկ առաջիկա օրերին','врач в ближайшие дни')}[u]);
/** One line from codes and counts only. */
export function zoeAnsweredSummary(i:ZoeAnsweredItem,l:L){
 return [i.unanswered===1?t(l,'1 message','1 հաղորդագրություն','1 сообщение'):t(l,`${i.unanswered} messages`,`${i.unanswered} հաղորդագրություն`,`Сообщений: ${i.unanswered}`),
  `${t(l,'Zoe\'s urgency','Զոյայի գնահատած շտապությունը','Срочность по оценке Zoe')}: ${urgencyLabel(i.urgency,l)}`,
  ...(i.declined?[t(l,'the member said no to sending it to you','անդամը հրաժարվել է այն ձեզ ուղարկելուց','участник отказался передавать это вам')]:[])].join(' · ');
}

export const zoeMarkActions=['reviewed','reopen']as const;
export type ZoeMarkAction=typeof zoeMarkActions[number];
export type ZoeMarkNotice='zoe_reviewed'|'zoe_reopened'|'zoe_changed'|'zoe_invalid'|'unavailable';
/** The page notices this flow adds ('unavailable' is each page's own). */
export const zoeMarkNotices:Record<Exclude<ZoeMarkNotice,'unavailable'>,[string,string,string]>={
 zoe_reviewed:['Marked reviewed. It comes back if the member writes again.','Նշված է որպես դիտված։ Այն կվերադառնա, եթե անդամը կրկին գրի։','Отмечено как просмотренное. Появится снова, если участник напишет.'],
 zoe_reopened:['Reopened. The member is back in waiting for your reply.','Վերաբացված է։ Անդամը կրկին սպասում է ձեր պատասխանին։','Разговор открыт снова. Участник вновь ожидает вашего ответа.'],
 zoe_changed:['The member wrote again or the conversation changed, so nothing was saved. Check it again.','Անդամը կրկին գրել է կամ զրույցը փոխվել է, ոչինչ չի պահպանվել։ Կրկին ստուգեք։','Участник написал снова или разговор изменился, поэтому ничего не сохранено. Проверьте ещё раз.'],
 zoe_invalid:['That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք էջը և փորձեք նորից։','Действие не выполнено. Обновите страницу и попробуйте снова.'],
};

const markInput=z.object({memberId:z.uuid(),action:z.enum(zoeMarkActions),version:z.coerce.number().int().positive()});
const markResult=z.union([z.object({ok:z.literal(true),action:z.enum(zoeMarkActions),replayed:z.boolean()}),z.object({ok:z.literal(false),code:z.string()})]);
export type ZoeMarkPorts={mark:(memberId:string,action:ZoeMarkAction,version:number)=>Promise<unknown>};
/** Validates the form, calls doctor_zoe_answered_mark once, and says what happened. Never retries. */
export async function markZoeAnswered(ports:ZoeMarkPorts,raw:{memberId:unknown;action:unknown;version:unknown}):Promise<ZoeMarkNotice>{
 const input=markInput.safeParse(raw);
 if(!input.success)return 'zoe_invalid';
 const r=markResult.safeParse(await ports.mark(input.data.memberId,input.data.action,input.data.version));
 if(!r.success)return 'unavailable';
 if(!r.data.ok)return r.data.code==='stale'||r.data.code==='not_answered_by_zoe'?'zoe_changed':r.data.code==='invalid'?'zoe_invalid':'unavailable';
 return r.data.action==='reviewed'?'zoe_reviewed':'zoe_reopened';
}
