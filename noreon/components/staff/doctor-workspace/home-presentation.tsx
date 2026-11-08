import {bpUnit} from '@/lib/bp-unit';
import type {ReactNode} from 'react';
import {Activity,Droplet,Pill} from 'lucide-react';
import type {ConversationRead,Fact,L,ToolResult} from '@/lib/staff-zoe/contracts';
import {stamp} from '@/components/patient-care/common';
import {st} from '@/lib/staff/staff-locale-copy';
import {FactChip,RecordCard,QuoteLine,displayFactValue} from '@/components/staff/zoe/cards';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';

export const homeTime=(at:string,locale:L)=>new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
export function doctorGreeting(locale:L,name:string,at:string){
 const date=new Date(at),hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Yerevan',hour:'numeric',hourCycle:'h23'}).format(date));
 const greeting=hour<12?st(locale,'Good morning','Բարի լույս','Доброе утро'):hour<18?st(locale,'Good afternoon','Բարի օր','Добрый день'):st(locale,'Good evening','Բարի երեկո','Добрый вечер');
 const titled=/^(?:dr\.?\s|doctor\s|բժիշկ\s|д-р\s|доктор\s)/iu.test(name.trim())?name.trim():`${st(locale,'Dr.','բժիշկ','д-р')} ${name.trim()}`;
 return {name:name.trim()?`${greeting}, ${titled}`:greeting,date:new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',weekday:'long',month:'long',day:'numeric'}).format(date)};
}
const facts=(records:ToolResult[],tool:ToolResult['tool'])=>records.find(r=>r.tool===tool&&r.state==='ok')?.facts??[];
const named=(records:ToolResult[],tool:ToolResult['tool'],label:string)=>facts(records,tool).find(f=>f.label===label);
export function HomeMemberHeader({member,locale}:{member:ConversationRead['member'];locale:L}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <header className="dw-patient-header"><div className="dw-member-identity"><h2><strong className="dw-member-name">{member.name??t('Name not recorded','Անունը գրանցված չէ','Имя не указано')}</strong> <span>{member.birthYear}</span></h2></div></header>;
}

/** Select the reader's actual metric, never the first arbitrary fact (for example an index event or LDL goal).
 * Overview has no CV-risk fact in the existing read contract, so there is deliberately no CV-risk tile. */
export function HomeGlance({records,locale,reference,asOf}:{records:ToolResult[];locale:L;reference:string;asOf:string}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const bp=named(records,'bp',t('Home BP week average','Տնային ճնշման շաբաթվա միջին','Среднее АД за домашнюю неделю'));
 const ldl=named(records,'ldl',t('Latest reviewed LDL','Վերջին վերանայված ՑԽԼ','Последний проверенный ЛПНП'));
 // A newer value the doctor has not reviewed sits under the reviewed one, or takes the tile when there is none.
 const unseen=facts(records,'ldl').find(f=>f.mark==='not_reviewed');
 const dose=facts(records,'adherence').find(f=>f.label.endsWith(`(${t('plan','պլան','план')})`)||f.label.endsWith(`(${t('self-reported','ինքնուրույն գրանցված','указано участником')})`));
 const tiles=[{tool:'bp',label:t('Home BP','Տնային ճնշում','Домашнее АД'),fact:bp,Icon:Activity},{tool:'ldl',label:t('LDL-C','ՑԽԼ-Խ','ЛПНП-Х'),fact:ldl??unseen,Icon:Droplet},{tool:'adherence',label:t('Adherence','Հետևողականություն','Приверженность'),fact:dose,Icon:Pill}];
 const missing=(tool:string)=>{
  const r=records.find(r=>r.tool===tool);
  if(r?.missing.length)return r.missing.join(' ');
  if(r?.state==='none'||r?.state==='ok')return tool==='bp'?t('No home BP average available','Տնային ճնշման միջինը հասանելի չէ','Среднее домашнее АД недоступно'):tool==='ldl'?t('No LDL-C value available','ՑԽԼ-Խ արժեքը հասանելի չէ','Значение ЛПНП-Х недоступно'):tool==='adherence'?t('No dose history available','Դեղաչափերի պատմությունը հասանելի չէ','История приёма недоступна'):t('Nothing recorded','Ոչինչ գրանցված չէ','Ничего не записано');
  return r?.state==='off'?t('Switched off','Անջատված է','Отключено'):r?.state==='not_permitted'?t('Not available for your role','Հասանելի չէ ձեր դերի համար','Недоступно для вашей роли'):t('Could not be read','Չհաջողվեց կարդալ','Не удалось прочитать');
 };

 const medicines=facts(records,'plan').filter(f=>f.label===t('Plan medicine','Պլանի դեղ','Препарат плана'));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf));
 const next=facts(records,'ldl').filter(f=>[t('Next LDL test set for','Հաջորդ ՑԽԼ թեստը','Следующий анализ ЛПНП'),t('LDL re-test window','ՑԽԼ կրկնակի թեստի պատուհան','Окно повторного анализа ЛПНП')].includes(f.label)&&f.date!==null&&f.date>=today);
 const visits=facts(records,'visits').filter(f=>f.label===t('Nurse visit','Բուժքրոջ այց','Визит медсестры')&&f.value.endsWith(', confirmed')&&f.date&&f.date>=today);
 const rows=(items:Fact[],empty:string)=><>{items.length?items.map(f=><div key={f.id} className="dw-fact"><p>{f.label}: {displayFactValue(f.value,locale)}</p><FactChip fact={f} locale={locale}/></div>):<p className="dw-muted">{empty}</p>}</>;
 return <ZoeTurn locale={locale} say={[t('Here is the saved record at a glance.','Ահա պահպանված գրառման ամփոփ պատկերը։','Вот краткий обзор сохранённой записи.')]} at={homeTime(asOf,locale)}>
  <section className="zk-card dw-overview" aria-label={t('At a glance','Մի հայացքով','Краткий обзор')}>
   <div className="dw-stats">{tiles.map(({tool,label,fact,Icon})=><div key={tool} className="dw-stat" data-tool={tool}><p className="dw-stat-label"><Icon size={13} aria-hidden/>{label}</p>{fact?<><p className="dw-stat-value">{displayFactValue(fact.value,locale)}</p><span className="dw-muted">{fact.label}</span><FactChip fact={fact} locale={locale}/>{tool==='ldl'&&unseen&&unseen!==fact&&<span className="dw-muted">{unseen.label}: {displayFactValue(unseen.value,locale)}</span>}</>:<p className="dw-muted">{missing(tool)}</p>}</div>)}</div>
   <div className="dw-record-sections"><section><h3>{t('Medications','Դեղեր','Лекарства')}</h3>{rows(medicines,records.find(r=>r.tool==='plan')?.state==='none'?t('No published medicines recorded','Հրապարակված դեղեր գրանցված չեն','Опубликованных назначений нет'):missing('plan'))}</section><section><h3>{t('Coming up','Առաջիկայում','Предстоит')}</h3>{rows([...next,...visits],t('No upcoming dates recorded','Առաջիկա ամսաթվեր գրանցված չեն','Предстоящие даты не записаны'))}{['ldl','visits'].filter(tool=>!['ok','none'].includes(records.find(r=>r.tool===tool)?.state??'')).map(tool=><p key={tool} className="dw-muted">{tool==='ldl'?t('LDL follow-up','ՑԽԼ հսկողություն','Контроль ЛПНП'):t('Visits','Այցեր','Визиты')}: {missing(tool)}</p>)}</section></div>
  </section>
  <details className="dw-sources"><summary>{t('Read the sources and dates','Կարդալ աղբյուրներն ու ամսաթվերը','Посмотреть источники и даты')}</summary>{records.map(r=><RecordCard key={r.tool} card={r} locale={locale} memberRef={reference}/>)}</details>
 </ZoeTurn>;
}

/** A short record-led introduction. Missing reads stay unknown; no clinical ranking is inferred. */
export function HomeMemberSummary({records,readings,bpState,reasons,locale,onReply}:{records:ToolResult[];readings:import('@/lib/bp-device/schema').BpReading[]|null;bpState?:'ok'|'off'|'unavailable';reasons:ReactNode[];locale:L;onReply?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const latest=[...(readings??[])].sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt))[0];
 const bp=facts(records,'bp').filter(f=>f.label===t('Latest recorded BP','Վերջին գրանցված ճնշում','Последнее записанное АД')||f.label===t('Latest home reading','Վերջին տնային չափում','Последнее домашнее измерение')).sort((a,b)=>(b.date??'').localeCompare(a.date??''))[0];
 const lab=[...facts(records,'labs')].sort((a,b)=>(b.date??'').localeCompare(a.date??''))[0];
 const message=records.find(r=>r.tool==='member_messages'&&r.state==='ok')?.quotes.filter(q=>q.nurseName===undefined).at(-1);
 const missing=(tool:ToolResult['tool'],empty:string)=>{
  const state=records.find(r=>r.tool===tool)?.state;
  if(state==='ok'||state==='none')return empty;
  if(state==='off')return t('This feature is switched off.','Այս գործառույթն անջատված է։','Эта функция отключена.');
  if(state==='not_permitted')return t('Not available for your role.','Հասանելի չէ ձեր դերի համար։','Недоступно для вашей роли.');
  if(state==='not_built')return t('This is not available yet.','Սա դեռ հասանելի չէ։','Это пока недоступно.');
  return t('This could not be read. Try again.','Չհաջողվեց կարդալ։ Փորձեք նորից։','Не удалось прочитать. Попробуйте ещё раз.');
 };
 const historyMissing=bpState==='off'?t('BP history is switched off.','Ճնշման պատմությունն անջատված է։','История давления отключена.'):t('BP history could not be read. Try again.','Ճնշման պատմությունը չհաջողվեց կարդալ։ Փորձեք նորից։','Не удалось прочитать историю давления. Попробуйте ещё раз.');
 const source=latest?.source==='device'?`${t('Monitor','Սարք','Тонометр')} ${latest.serial??t('(identity not recorded)','(նույնականացումը գրանցված չէ)','(идентификатор не записан)')}`:latest?.source==='visit'?t('Recorded at a visit','Գրանցված այցի ժամանակ','Записано на приеме'):t('Recorded manually','Գրանցված ձեռքով','Записано вручную');
 return <section className="zk-card space-y-3" aria-label={t('Member summary','Անդամի ամփոփում','Кратко об участнике')}>
  <h2 className="text-h3">{t('Here for review','Վերանայման համար','На рассмотрении')}</h2>
  <p className="text-body2">{reasons[0]??t('Review the saved record and any decisions below.','Վերանայեք պահպանված գրառումն ու ստորև բերված որոշումները։','Проверьте сохранённую запись и решения ниже.')}</p>
  <dl className="grid gap-3 text-body2 sm:grid-cols-2">
   <div><dt className="font-semibold">{t('Latest reading','Վերջին չափումը','Последнее измерение')}</dt><dd>{latest?<>{latest.systolic}/{latest.diastolic} {bpUnit(locale)} · {latest.pulse!==null&&`${t('Pulse','Զարկերակ','Пульс')} ${latest.pulse} · `}{stamp(latest.measuredAt,locale)}<p className="text-caption">{t('Source','Աղբյուր','Источник')}: {source}</p>{latest.source==='device'&&<p className="text-caption text-muted-foreground">{t('Monitor readings are not yet part of the evidence for review.','Սարքի չափումները դեռ վերանայման տվյալների մաս չեն։','Измерения с тонометра пока не входят в данные для рассмотрения.')}</p>}</>:bp?<>{displayFactValue(bp.value,locale)}<p><FactChip fact={bp} locale={locale}/></p></>:readings!==null?missing('bp',t('No reading available in the saved record.','Պահպանված գրառման մեջ չափում հասանելի չէ։','В сохранённой записи нет доступного измерения.')):null}{readings===null&&<p role="status">{historyMissing}</p>}</dd></div>
   <div><dt className="font-semibold">{t('Latest result','Վերջին արդյունքը','Последний результат')}</dt><dd>{lab?<>{lab.label}: {displayFactValue(lab.value,locale)}<p><FactChip fact={lab} locale={locale}/></p></>:missing('labs',t('No lab value available in the saved record.','Պահպանված գրառման մեջ լաբորատոր արժեք հասանելի չէ։','В сохранённой записи нет доступного результата анализа.'))}</dd></div>
   <div className="sm:col-span-2"><dt className="font-semibold">{t('Latest member message','Անդամի վերջին հաղորդագրությունը','Последнее сообщение участника')}</dt><dd>{message?<ul className="[&_li>p:last-child]:line-clamp-3"><QuoteLine {...message} locale={locale}/></ul>:missing('member_messages',t('No member message available.','Անդամի հաղորդագրություն հասանելի չէ։','Нет доступного сообщения участника.'))}</dd></div>
  </dl>
  {onReply&&<button type="button" className="dw-pill" onClick={onReply}>{t('Open conversation and reply','Բացել զրույցը և պատասխանել','Открыть разговор и ответить')}</button>}
 </section>;
}
