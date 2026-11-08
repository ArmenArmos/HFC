'use client';
import {MemberDisambiguationCard,MemberIdentityButton} from '@/components/staff/chat-member-identity';
import type {ChatMemberIdentity as Identity} from '@/lib/staff/chat-member-identity-schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
/** A general question can offer navigation, never open a record or replay the held question. */
export function OpenPatientChatChoice({rows,locale,onOpen,busy=false}:{rows:({id:string;name:string}&Partial<Identity>)[];locale:StaffLocale;onOpen:(id:string)=>void;busy?:boolean}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),row=rows[0];
 return <div className="dcv2-block" data-open-patient-chat>
  {rows.length===1&&row?<><p>{t(`Open ${row.name}'s chat to ask this`,`Այս հարցը տալու համար բացեք ${row.name}-ի զրույցը։`,`Чтобы задать этот вопрос, откройте чат участника ${row.name}.`)}</p><MemberIdentityButton memberId={row.id} name={row.name} member={row} locale={locale} disabled={busy} buttonClassName="dcv2-row" onClick={()=>onOpen(row.id)}><span className="dcv2-tag">{t('Open chat','Բացել զրույցը','Открыть чат')}</span></MemberIdentityButton></>:<><p>{t('Open the member’s chat to ask this.','Այս հարցը տալու համար բացեք անդամի զրույցը։','Чтобы задать этот вопрос, откройте чат участника.')}</p><MemberDisambiguationCard rows={rows} locale={locale} busy={busy} onChoose={r=>onOpen(r.id)} actionLabel={t('Open chat','Բացել զրույցը','Открыть чат')}/></>}
 </div>;
}
