import {pick,type Locale} from '@/lib/locale';

/**
 * WP R: member copy for the offline outbox and banner (hy default, en, ru). Second person, no exclamation marks.
 * `veryHighQueued` is new safety-adjacent wording: an unapproved DRAFT for the clinical owners (Armen, Yesayi), like
 * the other BP flow drafts in lib/zoe-chat-actions/copy.ts. The 103 line itself reuses the existing instruction.
 */
type Copy=Record<Locale,string>;
export const OFFLINE={
 queued:{hy:'Կուղարկվի, երբ կապը վերականգնվի',en:'Will send when you are back online',ru:'Отправится, когда связь восстановится'},
 banner:{hy:'Դուք անցանց եք։ Ձեր գրածը կուղարկվի, երբ կապը վերականգնվի։',en:'You are offline. What you send now will go when you are back online.',ru:'Вы не в сети. То, что вы отправите сейчас, уйдёт, когда связь восстановится.'},
 emergency:{hy:'Շտապ դեպքում մի՛ սպասեք՝ զանգահարեք 103։',en:'In an emergency, do not wait: call 103.',ru:'В экстренном случае не ждите: позвоните 103.'},
 back:{hy:'Կապը վերականգնվեց։ Ուղարկում ենք սպասողները։',en:'You are back online. Sending what was waiting.',ru:'Связь восстановилась. Отправляем то, что ждало.'},
 // DRAFT, unapproved: shown on the device when a reading the rules call very high (bpVeryHigh) is queued offline.
 veryHighQueued:{hy:'Այս չափումը շատ բարձր է, և այն դեռ չի հասել ձեր խնամքի թիմին։ Եթե հիմա վատ եք զգում, մի՛ սպասեք՝ զանգահարեք 103։',en:'This reading is very high and has not reached your care team yet. If you feel unwell now, do not wait: call 103.',ru:'Это измерение очень высокое, и оно ещё не дошло до вашей команды заботы. Если вам сейчас плохо, не ждите: позвоните 103.'},
 call103:{hy:'Զանգահարել 103',en:'Call 103',ru:'Позвонить 103'},
} satisfies Record<string,Copy>;
export const offlineText=(locale:Locale,key:keyof typeof OFFLINE)=>pick(locale,OFFLINE[key]);
