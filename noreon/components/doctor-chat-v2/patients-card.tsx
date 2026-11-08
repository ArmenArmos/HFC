'use client';
import {bpUnit} from '@/lib/bp-unit';
import {useState} from 'react';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {calendarDate,yerevanStamp} from '@/lib/staff/yerevan-time';
import type {PanelMember} from '@/lib/staff-zoe/panel';
import {panelLabel} from './panel-copy';
export function PatientsCard({rows,locale,onOpen,memberIds=null,onClearFilter,asOf,rosterComplete=true}:{rows:PanelMember[];locale:StaffLocale;onOpen:(id:string)=>void;memberIds?:string[]|null;onClearFilter?:()=>void;asOf:string;rosterComplete?:boolean}){
 const [filter,setFilter]=useState({memberIds,attention:'all'});
 // A graph choice starts a new table filter, including when the same bar is pressed again.
 const attention=filter.memberIds===memberIds?filter.attention:'all';
 const setAttention=(attention:string)=>setFilter({memberIds,attention});
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),missing=t('Not recorded','Գրանցված չէ','Не записано');
 const visible=rows.filter(row=>(!memberIds||memberIds.includes(row.identity.id))&&(attention==='all'||attention==='needs_me'&&(row.attention==='needs_me'||row.attention==='urgent')||attention==='urgent'&&row.attention==='urgent'));
 return <section className="dcv2-results dcv2-patients" data-patients-card>
  <h2>{t('Patients','Անդամներ','Участники')}</h2>
  {!rosterComplete&&<p role="status">{t('Your member list is incomplete. Panel totals and graphs are unavailable.','Ձեր անդամների ցանկը թերի է։ Խմբի ընդհանուր քանակներն ու գծապատկերները հասանելի չեն։','Список ваших участников неполный. Общие показатели и графики недоступны.')}</p>}
  <label>{t('Attention','Ուշադրություն','Внимание')} <select value={attention} onChange={event=>setAttention(event.target.value)}>
   <option value="all">{t('All','Բոլորը','Все')}</option><option value="needs_me">{panelLabel('needs_me',locale)}</option><option value="urgent">{panelLabel('urgent',locale)}</option>
  </select></label>
  {memberIds&&<button type="button" onClick={()=>{setAttention('all');onClearFilter?.();}}>{t('Show all members','Ցույց տալ բոլոր անդամներին','Показать всех участников')}</button>}
  {!visible.length?<p>{!rosterComplete?t('Your full member list could not be read.','Ձեր անդամների ամբողջական ցանկը չհաջողվեց կարդալ։','Не удалось прочитать полный список ваших участников.'):rows.length?t('No members match this filter.','Այս զտիչին համապատասխան անդամներ չկան։','Нет участников с таким фильтром.'):t('No members are assigned to you.','Ձեզ դեռ անդամներ նշանակված չեն։','Вам пока не назначены участники.')}</p>:<div className="dcv2-table-scroll" tabIndex={0} role="region" aria-label={t('Your members','Ձեր անդամները','Ваши участники')}><table>
   <caption className="sr-only">{t('Your assigned members','Ձեզ նշանակված անդամները','Назначенные вам участники')}</caption>
   <thead><tr>{[t('Name, age and ID','Անուն, տարիք և համար','Имя, возраст и номер'),t('Risk category','Ռիսկի խումբ','Категория риска'),t('Latest BP','Վերջին ճնշումը','Последнее АД'),t('Latest LDL-C','Վերջին ՑԽԼ','Последний ЛПНП'),t('Attention','Ուշադրություն','Внимание')].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
   <tbody>{visible.map(row=><tr key={row.identity.id} data-panel-member={row.identity.id} onClick={()=>onOpen(row.identity.id)}>
    <th scope="row"><button type="button" onClick={event=>{event.stopPropagation();onOpen(row.identity.id);}}><ChatMemberIdentity memberId={row.identity.id} name={row.identity.name} member={row.identity} locale={locale}/><span className="dcv2-tag dcv2-open-chat">{t('Open chat','Բացել զրույցը','Открыть чат')}</span></button></th>
    <td>{row.risk?panelLabel(row.risk,locale):missing}</td>
    <td>{row.bp?<>{row.bp.systolic}/{row.bp.diastolic} {bpUnit(locale)}<small>{yerevanStamp(row.bp.at,locale)}</small>{row.bp.unverified&&<small>{t('Member-reported, unverified','Անդամի նշածը, չստուգված','Со слов участника, не проверено')}</small>}</>:missing}</td>
    <td>{row.ldl?<>{new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(row.ldl.value)} mmol/L<small>{calendarDate(row.ldl.on,locale)}</small>{!row.ldl.counted&&<small>{t('Not counted toward target','Թիրախի համար չի հաշվվում','Не учитывается для цели')}</small>}</>:missing}</td>
    <td>{panelLabel(row.attention,locale)}{row.unavailable&&<small>{t('Some records unavailable','Որոշ տվյալներ անհասանելի են','Часть данных недоступна')}</small>}</td>
   </tr>)}</tbody>
  </table></div>}
  <p className="text-caption text-muted-foreground">{t('As shown at','Ցուցադրված է','По состоянию на')} {yerevanStamp(asOf,locale)}</p>
 </section>;
}
