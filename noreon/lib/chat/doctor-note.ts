import type {Locale} from '@/lib/locale';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';

const TITLE={en:'Note from your doctor',hy:'Ձեր բժշկի նշումը',ru:'Заметка вашего врача'} as const;

/** Older notices store the title with the body. Localize only that exact first line. */
export function doctorNoticeText(text:string,locale:Locale):string{
 const end=text.indexOf('\n');
 if(end<0||!Object.values(TITLE).some(title=>title===text.slice(0,end)))return text;
 return TITLE[locale]+text.slice(end);
}

const PLAN_NOTICE_EN='Your care plan is ready. Open Noreon to read it.';
const PLAN_NOTICE_HY='Ձեր խնամքի ծրագիրը պատրաստ է։ Բացեք Noreon-ը՝ այն կարդալու համար։';

/** Chat presentation only. Stored notices and Telegram retain their approval label. */
export function memberNoticeText(text:string,locale:Locale):string{
 const body=text.replace(/^UNAPPROVED PLACEHOLDER\. /,'');
 // RU templates do not exist yet; Russian members see HY text (output/PENDING_QUESTIONS.md, 7 Nov member notices).
 return body===PLAN_NOTICE_EN||body===PLAN_NOTICE_HY?NEXT_STEP.plan[locale]:doctorNoticeText(body,locale);
}
