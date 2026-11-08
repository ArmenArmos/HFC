import {bpUnit} from '@/lib/bp-unit';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import {staffDisplayText} from '@/lib/staff/display-text';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import {quotesTypedBp} from '@/lib/staff-zoe/chat-reported';
import {staffZoeReading} from '@/lib/staff-zoe/response-copy';
import Link from 'next/link';
import type {Route} from 'next';
import {st} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import {AlertCardLines} from '@/components/staff/alert-card';
import {DECLINED,type AnswerContent,type Fact,type L,type ToolId,type ToolResult,type ToolState} from '@/lib/staff-zoe/contracts';
import {BpChart} from './bp-chart';

const TITLE:Record<ToolId,[string,string,string]>={lipid_plan:['Lipid follow-up plan','Լիպիդային հսկողության պլան','План контроля липидов'],overview:['Overview','Ընդհանուր','Обзор'],bp:['Blood pressure','Զարկերակային ճնշում','Артериальное давление'],labs:['Lab results','Լաբորատոր արդյունքներ','Лабораторные результаты'],ldl:['LDL goal and response','ՑԽԼ նպատակ և արձագանք','Цель по ЛПНП и ответ'],
 plan:['Care plan status','Խնամքի պլանի վիճակ','Состояние плана ухода'],adherence:['Medicines and adherence','Դեղեր և հետևողականություն','Препараты и приверженность'],open_items:['Open items','Բաց հարցեր','Открытые вопросы'],visits:['Nurse visits','Բուժքրոջ այցեր','Визиты медсестры'],member_messages:['Conversation messages','Զրույցի հաղորդագրություններ','Сообщения в переписке'],zoe_why:['Why Zoe answered','Ինչու Զոյան պատասխանեց','Почему Zoe ответила']};
const STATE:Record<Exclude<ToolState,'ok'>,[string,string,string]>={none:['Not known: nothing recorded.','Հայտնի չէ. ոչինչ գրանցված չէ։','Неизвестно: ничего не записано.'],off:['Not known: this feature is switched off.','Հայտնի չէ. այս գործառույթն անջատված է։','Неизвестно: эта функция отключена.'],unavailable:['Not known: this could not be read. Try again.','Հայտնի չէ. չհաջողվեց կարդալ։ Փորձեք նորից։','Неизвестно: не удалось прочитать. Попробуйте ещё раз.'],not_permitted:['Not shown for your role.','Ձեր դերի համար չի ցուցադրվում։','Не показывается для вашей роли.'],not_built:['Not known: this is not available yet.','Հայտնի չէ. սա դեռ հասանելի չէ։','Неизвестно: это пока недоступно.']};
const MARK:Record<NonNullable<Fact['mark']>,[string,string,string]>={reviewed:['Reviewed','Վերանայված','Проверено'],not_reviewed:['Not reviewed','Չվերանայված','Не проверено'],member_reported:['Member reported','Անդամի տվյալ','Со слов участника'],doctor_set:['Set by doctor','Սահմանել է բժիշկը','Задано врачом']};
const l3=(l:L,v:readonly [string,string,string])=>st(l,v[0],v[1],v[2]);
const dateText=(d:string,l:L)=>stamp(`${d}T12:00:00+04:00`,l,false);
export const displayFactValue=(value:string,locale:L)=>staffDisplayText(value,locale).replace(/mmol\/L|mmHg|\bmg\b|\bbpm\b/g,unit=>({
 'mmol/L':st(locale,'mmol/L','մմոլ/լ','ммоль/л'),'mmHg':bpUnit(locale),'mg':st(locale,'mg','մգ','мг'),'bpm':st(locale,'bpm','զարկ/րոպե','уд/мин'),
 }[unit]??unit));

/** A date and a source: on every line the model wrote, and on every row of a card. */
export function FactChip({fact,locale,inline=false}:{fact:Fact;locale:L;inline?:boolean}){
 const parts=[...(fact.date?[dateText(fact.date,locale)]:[]),...(fact.mark?[l3(locale,MARK[fact.mark])]:[])];
 if(!parts.length&&!fact.href)return null;
 const label=[st(locale,'Source','Աղբյուր','Источник'),...parts].join(' · ');
 const cls='text-caption text-muted-foreground';
 return fact.href&&!inline?<Link href={fact.href as Route} className={`${cls} underline underline-offset-2`}>{label}</Link>:<span className={cls}>{label}</span>;
}

export function RecordCard({card,locale,inline=false}:{card:ToolResult;locale:L;memberRef:string;inline?:boolean}){
 return <section aria-label={l3(locale,TITLE[card.tool])} data-testid={`zoe-card-${card.tool}`} className="sz-record min-w-0 max-w-full space-y-2 rounded-xl border bg-background p-4">
  <header className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-h3">{l3(locale,TITLE[card.tool])}</h3>{!inline&&<Link href={card.href as Route} className="text-caption underline underline-offset-2">{st(locale,'Open source','Բացել աղբյուրը','Открыть источник')}</Link>}</header>
  {card.state==='ok'?<>
   {!!card.facts.length&&<dl className="divide-y">{card.facts.map(f=><div key={f.id} className="grid gap-x-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"><dt className="text-body2 text-muted-foreground">{staffDisplayText(f.label,locale)}</dt><dd className="min-w-0 space-y-0.5">{f.alertCard?<AlertCardLines fields={f.alertCard} locale={locale}/>:<p className="break-words text-body2 font-medium">{displayFactValue(f.value,locale)}</p>}<p><FactChip fact={f} locale={locale} inline={inline}/></p></dd></div>)}</dl>}
   {card.tool==='bp'&&card.bpSeries&&<BpChart series={card.bpSeries} locale={locale}/>}
   {!!card.quotes.length&&<ul className="space-y-2">{card.quotes.map(q=><QuoteLine key={q.id} text={q.text} date={q.date} flagged={q.flagged} nurseName={q.nurseName} zoe={q.zoe} rationale={q.id.startsWith('zoe_why.')} locale={locale}/>)}</ul>}
  </>:<p className="text-body2" role="status">{l3(locale,STATE[card.state])}</p>}
  {card.state==='none'&&card.tool==='bp'&&!!card.bpSeries&&card.bpSeries.length<2&&<BpChart series={card.bpSeries} locale={locale}/>}
  {card.missing.map(m=><p key={m} className="text-body2 text-muted-foreground">{st(locale,'Not known','Հայտնի չէ','Неизвестно')}: {staffDisplayText(m,locale)}</p>)}
 </section>;
}

/** Source text with neutral code labels only. Actions never become part of a quote. */
export function QuoteLine({text,date,flagged,locale,nurseName,zoe=false,rationale=false}:{text:string;date:string|null;flagged:boolean;locale:L;nurseName?:string;zoe?:boolean;rationale?:boolean}){
 return <li className="list-none rounded-md border-l-2 border-border bg-muted/40 px-3 py-2"><p className="text-caption text-muted-foreground">{zoe?st(locale,'Zoe told the member','Zoe-ն ասել է անդամին','Zoe ответила участнику'):rationale?st(locale,'Saved Zoe rationale, generated and untrusted','Զոյայի պահպանված բացատրությունը, գեներացված և անվստահելի','Сохранённое обоснование Zoe, сгенерированное и недоверенное'):nurseName!==undefined?`${st(locale,'Nurse','Բուժքույր','Медсестра')}: ${nurseName}`:st(locale,'The member wrote','Անդամը գրել է','Участник написал')}{nurseName===undefined&&!zoe&&!rationale&&quotesTypedBp(text)?` · ${unverifiedBpLabel(locale)}`:''}{date?` · ${dateText(date,locale)}`:''}{flagged?` · ${st(locale,'Contains instructions: quoted only','Պարունակում է հրահանգներ. միայն մեջբերում է','Содержит указания: только цитата')}`:''}</p><p className="whitespace-pre-wrap break-words text-body2">{staffDisplayText(text,locale,true)}</p></li>;
}

export function ZoeAnswer({content,locale,memberRef,inline=false,collapseZoe=false}:{content:AnswerContent;locale:L;memberRef:string;inline?:boolean;collapseZoe?:boolean}){
 const hasContent=content.say.length>0||content.quotes.length>0;
 const unknown=<ul className="list-disc pl-5">{content.notKnown.map(x=><li key={x} className="text-body2">{staffDisplayText(x,locale)}</li>)}</ul>;
 const records=content.cards.map(c=><RecordCard key={c.tool} card={c} locale={locale} memberRef={memberRef} inline={inline}/>);
 return <div className="space-y-3" data-testid="zoe-answer" data-state={content.state}>
  {!inline&&<UploadIdentityChecks rows={content.cards.flatMap(c=>c.identityChecks??[])} locale={locale}/>}
  {!!content.say.length&&<ul className="space-y-2 rounded-xl bg-muted/40 p-4">{content.say.map((l,i)=><li key={i} className="list-none space-y-0.5">{l.facts.some(f=>f.alertCard)?<div className={l.facts.some(f=>f.urgent)?'font-semibold text-destructive':undefined}>{l.facts.map(f=>f.alertCard?<AlertCardLines key={f.id} fields={f.alertCard} locale={locale}/>:null)}</div>:<p className={`break-words text-body2${l.facts.some(f=>f.urgent)?' font-semibold text-destructive':''}`}>{staffDisplayText(l.text,locale)}</p>}<p className="flex flex-wrap gap-x-3">{l.facts.map(f=><FactChip key={f.id} fact={f} locale={locale} inline={inline}/>)}</p></li>)}</ul>}
  {content.memberNotes&&<p className="text-body2" data-testid="zoe-member-notes"><Link href={content.memberNotes.href as Route} className="underline underline-offset-2">{st(locale,'Member notes','Անդամի գրառումներ','Заметки участника')}: {content.memberNotes.count}</Link>{content.memberNotes.flagged?st(locale,`, ${content.memberNotes.flagged} marked`,`, ${content.memberNotes.flagged}-ը նշված է`,`, отмечено: ${content.memberNotes.flagged}`):''}</p>}
  {!!content.quotes.length&&(()=>{
   // Zoe's earlier replies to the member (the long emergency text for a member in crisis) are shown in full once; later answers keep them one tap away.
   const folded=collapseZoe?content.quotes.filter(q=>q.zoe):[],shown=content.quotes.filter(q=>!folded.includes(q));
   const line=(q:typeof content.quotes[number])=><QuoteLine key={q.id} text={q.text} date={q.date} flagged={q.flagged} nurseName={q.nurseName} zoe={q.zoe} rationale={q.id.startsWith('zoe_why.')} locale={locale}/>;
   return <>{!!shown.length&&<ul className="space-y-2">{shown.map(line)}</ul>}{!!folded.length&&<details className="rounded-xl border p-4" data-testid="zoe-replies-folded"><summary className="text-body2 font-medium">{st(locale,`Zoe's replies to the member (${folded.length})`,`Զոյայի պատասխանները անդամին (${folded.length})`,`Ответы Zoe участнику (${folded.length})`)}</summary><ul className="mt-2 space-y-2">{folded.map(line)}</ul></details>}</>;
  })()}
  {!!content.notKnown.length&&(hasContent?<details className="rounded-xl border p-4" data-testid="zoe-not-known"><summary className="text-body2 font-medium">{st(locale,'What is not known','Ինչը հայտնի չէ','Что неизвестно')}</summary>{unknown}</details>:<div className="rounded-xl border p-4" data-testid="zoe-not-known"><p className="text-body2 font-medium">{st(locale,'Not known','Հայտնի չէ','Неизвестно')}</p>{unknown}</div>)}
  {content.declined&&<p className="text-body2 font-medium">{st(locale,...DECLINED)}</p>}
  {content.notice&&<p role="status" className="text-body2 text-muted-foreground">{staffDisplayText(content.notice,locale)}</p>}
  {(inline||hasContent)&&!!records.length?<details className="dcv2-record"><summary>{st(locale,'See the record','Տեսնել գրառումը','Показать запись')}</summary>{records}</details>:records}
 </div>;
}

/** The same record blocks in the pane and the dialog. Inline records never navigate away. */
export function StaffZoeResponse({content,cards,error,loading,locale,memberRef,member,inline=false,home=false,collapseZoe=false}:{content:AnswerContent|null;cards:ToolResult[];error:string|null;loading:boolean;locale:L;memberRef:string;member?:{id:string;name:string|null};inline?:boolean;home?:boolean;collapseZoe?:boolean}){
 return <>{!content&&!inline&&<UploadIdentityChecks rows={cards.flatMap(c=>c.identityChecks??[])} locale={locale}/ >}{member&&<ChatMemberIdentity memberId={member.id} name={member.name} locale={locale}/ >}{content?<ZoeAnswer content={content} locale={locale} memberRef={memberRef} inline={inline} collapseZoe={collapseZoe}/>:<>{cards.map(c=><RecordCard key={c.tool} card={c} locale={locale} memberRef={memberRef} inline={inline}/>)}{!error&&loading&&<p role="status" className={home?'zk-bubble':'text-body2 text-muted-foreground'}>{staffZoeReading(locale)}</p>}</>}{error&&<p role="alert" className={home?'zk-bubble':'text-body2'}>{error}</p>}</>;
}
