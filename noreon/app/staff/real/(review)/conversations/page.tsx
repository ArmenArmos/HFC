import Link from 'next/link';
import type {Route} from 'next';
import {notFound,redirect,unstable_rethrow} from 'next/navigation';
import {ChevronRight,MessagesSquare,TriangleAlert} from 'lucide-react';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {nurseTodayHref} from '@/lib/nurse-chat/config';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {readAwaitingReplies,readZoeAnswered} from '@/app/staff/real/conversation/actions';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {zoeMarkNotices,type ZoeAnsweredItem} from '@/lib/doctor-inbox/zoe-answered';
import {ZoeAnsweredSection} from '@/components/doctor-inbox/zoe-answered';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {deliveryDetailText,deliveryLabel,deliveryLabelText} from '@/lib/telegram-runtime/delivery-copy';
import type {AwaitingReplies} from '@/lib/conversation-persistence/contracts';
import {adminOnly} from '@/lib/staff/real-admin';
import {readAdminConversationList} from '@/lib/admin-conversations/server';
import {parseAdminConversationFilter} from '@/lib/admin-conversations/contracts';
import {AdminConversationListView} from '@/components/admin-conversations/list';
export const dynamic='force-dynamic';
type Item=AwaitingReplies['items'][number];
function Row({item,l}:{item:Item;l:StaffLocale}){
 const attention=item.reason==='not_delivered'&&item.latestDelivery;
 return <li><Link href={`/staff/real/conversations/${item.memberId}` as Route} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
  {attention?<TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden/>:<MessagesSquare className="size-5 shrink-0 text-brand-teal" aria-hidden/>}
  <span className="min-w-0 flex-1 space-y-1"><span className="block break-words text-body2 font-semibold">{item.memberName||st(l,'Member','Անդամ','Участник')}</span>
   {attention?<span className="block text-caption text-muted-foreground">{deliveryDetailText(item.latestDelivery!,item.latestReason,l)}</span>
   :<span className="block text-caption text-muted-foreground">{l==='ru'?(item.unanswered===0?'Новые сообщения':`Новых сообщений: ${item.unanswered}`):l==='hy'?(item.unanswered===0?'Նոր հաղորդագրություններ':`${item.unanswered} նոր հաղորդագրություն`):item.unanswered===0?'New messages':item.unanswered===1?'1 new message':`${item.unanswered} new messages`} · {st(l,'last','վերջինը','последнее')} {stamp(item.lastMessageAt,l)} · {item.channel==='telegram'?'Telegram':st(l,'App','Հավելված','Приложение')}</span>}
   {item.mediaPending&&<span className="block text-caption font-medium text-destructive">{st(l,'Sent a photo, voice message, location or other non-text message that Noreon cannot read. Contact the member.','Ուղարկել է լուսանկար, ձայնային հաղորդագրություն, տեղորոշում կամ այլ ոչ տեքստային հաղորդագրություն, որը Noreon-ը չի կարող կարդալ։ Կապվեք անդամի հետ։','Участник отправил фото, голосовое сообщение, геолокацию или другое нетекстовое сообщение, которое Noreon не может прочитать. Свяжитесь с участником.')}</span>}
   {item.overLimit&&<span className="block text-caption font-medium text-destructive">{st(l,'Some messages were over the intake limit and were not saved. Contact the member.','Որոշ հաղորդագրություններ գերազանցել են ընդունման սահմանաչափը և չեն պահպանվել։ Կապվեք անդամի հետ։','Некоторые сообщения превысили лимит приема и не были сохранены. Свяжитесь с участником.')}</span>}</span>
  {item.latestDelivery&&<Status tone={deliveryLabel[item.latestDelivery].tone}>{`${st(l,'Last reply','Վերջին պատասխանը','Последний ответ')}: ${deliveryLabelText(item.latestDelivery,l)}`}</Status>}
  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
 </Link></li>;
}
/** Admins: the read-only oversight list (database switch admin_conversation_read_enabled). */
async function AdminConversations({filter,l}:{filter:unknown;l:StaffLocale}){
 const chosen=parseAdminConversationFilter(filter);
 let view;
 try{view=await readAdminConversationList(chosen);}catch(error){unstable_rethrow(error);return <CareSection title={st(l,'Conversations unavailable','Զրույցներն անհասանելի են','Разговоры недоступны')}><p className="text-body2">{st(l,'The list of conversations could not be loaded. Reload to try again.','Չհաջողվեց բեռնել զրույցների ցանկը։ Կրկին փորձելու համար թարմացրեք էջը։','Не удалось загрузить список разговоров. Обновите страницу, чтобы повторить попытку.')}</p></CareSection>;}
 return <AdminConversationListView view={view} filter={chosen}/>;
}
export default async function AwaitingRepliesPage({searchParams}:{searchParams:Promise<{filter?:string|string[];notice?:string|string[]}>}){
 const staff=await requireRealStaff();const {identity}=staff;
 if(identity.role==='admin'){await adminOnly(staff);return <AdminConversations l={await staffLocale(identity.role)} filter={(await searchParams).filter}/>;}
 // A nurse's conversations are in the nurse chat; the address a bookmark or an old link points to goes there instead of a 404.
 if(identity.role==='nurse')redirect(nurseTodayHref());
 if(identity.role!=='doctor'||!telegramEnabled())notFound();
 const l=await staffLocale(identity.role);
 let view;
 try{view=await readAwaitingReplies();}catch(error){unstable_rethrow(error);return <CareSection title={st(l,'Replies unavailable','Պատասխաններն անհասանելի են','Ответы недоступны')}><p className="text-body2">{st(l,'The list of members waiting for a reply could not be loaded. Reload to try again.','Պատասխանի սպասող անդամների ցանկը չհաջողվեց բեռնել։ Թարմացրեք էջը՝ կրկին փորձելու համար։','Не удалось загрузить список участников, ожидающих ответа. Обновите страницу, чтобы повторить попытку.')}</p></CareSection>;}
 // Part 2: threads Zoe fully answered. A failure here never hides the needs-reply list above it.
 let answered:ZoeAnsweredItem[]|null=null;
 try{answered=(await readZoeAnswered()).items;}catch(error){unstable_rethrow(error);}
 const {notice}=await searchParams,msg=notice==='unavailable'?zoeMarkNotices.zoe_invalid:typeof notice==='string'&&notice in zoeMarkNotices?zoeMarkNotices[notice as keyof typeof zoeMarkNotices]:null;
 const attention=view.items.filter(i=>i.reason==='not_delivered'),waiting=view.items.filter(i=>i.reason==='new_message');
 return <div className="mx-auto max-w-4xl space-y-6">
  <header className="space-y-2"><h1 className="text-h1">{st(l,'Replies','Պատասխաններ','Ответы')}</h1><p className="text-body2 text-muted-foreground">{st(l,'Your assigned members who are waiting for a reply, and replies that did not reach a member.','Ձեզ կցված անդամները, որոնք սպասում են պատասխանի, և պատասխանները, որոնք չեն հասել անդամին։','Назначенные вам участники, ожидающие ответа, и ответы, которые не дошли до участника.')}</p></header>
  {msg&&<p role="status" className="rounded-md border bg-background p-3 text-body2">{st(l,msg[0],msg[1],msg[2])}</p>}
  {attention.length>0&&<section aria-labelledby="needs-attention" className="space-y-3"><h2 id="needs-attention" className="text-h3">{st(l,'Reply not delivered','Պատասխանը չի առաքվել','Ответ не доставлен')}</h2><p className="text-body2 text-muted-foreground">{st(l,'Your last reply to these members was not sent, or we can’t confirm it arrived. Open the conversation to review the reason and any safe retry, or contact the member another way.','Այս անդամներին Ձեր վերջին պատասխանը չի ուղարկվել, կամ մենք չենք կարող հաստատել, որ այն հասել է։ Բացեք զրույցը՝ պատճառը և անվտանգ կրկին ուղարկելու հնարավորությունը տեսնելու համար, կամ կապվեք անդամի հետ այլ եղանակով։','Ваш последний ответ этим участникам не был отправлен, или мы не можем подтвердить его доставку. Откройте разговор, чтобы проверить причину и возможность безопасной повторной отправки, или свяжитесь с участником другим способом.')}</p><ul className="divide-y rounded-xl border bg-background">{attention.map(item=><Row key={item.memberId} item={item} l={l}/>)}</ul></section>}
  <section aria-labelledby="waiting" className="space-y-3"><h2 id="waiting" className="text-h3">{st(l,'Waiting for a reply','Սպասում են պատասխանի','Ожидают ответа')}</h2>
   {waiting.length===0?<p className="text-body2">{st(l,'No one is waiting. You have no unanswered member messages.','Ոչ ոք չի սպասում։ Անդամների անպատասխան հաղորդագրություններ չունեք։','Никто не ожидает ответа. У вас нет сообщений участников без ответа.')}</p>:<><p className="text-body2 text-muted-foreground">{st(l,'Oldest first. A member stays here until you approve or reject a reply to their latest message. Anything urgent, flagged or sent to you by Zoe is always here.','Ամենահները՝ առաջինը։ Անդամը մնում է այստեղ, մինչև Դուք հաստատեք կամ մերժեք նրա վերջին հաղորդագրության պատասխանը։ Շտապ, նշված կամ Զոյի կողմից Ձեզ ուղարկված ամեն ինչ միշտ այստեղ է։','Сначала самые ранние. Участник остается здесь, пока вы не утвердите или не отклоните ответ на его последнее сообщение. Все срочное, отмеченное или переданное вам Zoe всегда находится здесь.')}</p><ul className="divide-y rounded-xl border bg-background">{waiting.map(item=><Row key={item.memberId} item={item} l={l}/>)}</ul></>}
  </section>
  {answered===null?<p role="alert" className="rounded-md border p-3 text-body2">{st(l,'Answers by Zoe could not be loaded. Reload to try again.','Զոյի պատասխանները չհաջողվեց բեռնել։ Թարմացրեք էջը՝ կրկին փորձելու համար։','Не удалось загрузить ответы Zoe. Обновите страницу, чтобы повторить попытку.')}</p>:<ZoeAnsweredSection items={answered} l={l} from="replies"/>}
 </div>;
}
