import type {AuditCategory,ProfileChange} from './contracts';
import type {Locale} from '@/lib/locale';
import {auditCopy,type AuditTranslation} from './copy';
export {auditCopy} from './copy';

const translated=(copy:AuditTranslation,locale:Locale)=>copy[locale==='hy'?1:locale==='ru'?2:0];
const lookup=<T,>(map:Record<string,T>,code:string):T|undefined=>Object.hasOwn(map,code)?map[code]:undefined;
export const auditCategoryLabel=Object.fromEntries(Object.entries(auditCopy.categories).map(([code,copy])=>[code,copy[0]]))as Record<AuditCategory,string>;
export const auditCategoryName=(category:AuditCategory,locale:Locale)=>translated(auditCopy.categories[category],locale);
export const sourceLabel=(source:string,locale:Locale='en')=>translated(lookup(auditCopy.sources,source)??auditCopy.text.otherSource,locale);
export function auditRoleName(role:string|null,locale:Locale='en'){
 const removed=role?.endsWith(', removed'),code=removed?role!.slice(0,-9):role??'';
 const name=translated(lookup(auditCopy.roles,code)??auditCopy.text.otherRole,locale);
 return removed?`${name}, ${translated(auditCopy.text.removed,locale)}`:name;
}
const outbound=new Set(['telegram_auth_message','conversation_delivery','patient_message_attempt','patient_message_delivery','telegram_nurse_outbox','member_push_delivery','system_message','zoe_chat_card_send','system_message_audit','booking_notice']);
/** Unknown identifiers are diagnostic codes, never humanised English sentences. */
export function actionLabel(source:string,action:string,locale:Locale='en'){
 // The clinic RPC masks all non-clinic staff record reads to this one safe code.
 const group=action==='member_record'?'access':source==='clinic_change'?'clinic':source;
 const direct=lookup(lookup(auditCopy.actions,group)??{},action);
 if(direct)return translated(direct,locale);
 if(outbound.has(source)){
  const [channel,kind,state,...extra]=action.split(':');
  const channelCopy=lookup(auditCopy.channels,channel),kindCopy=lookup(auditCopy.templates,kind),stateCopy=lookup(auditCopy.states,state);
  if(!extra.length&&channelCopy&&kindCopy&&stateCopy)return `${sourceLabel(source,locale)}: ${translated(channelCopy,locale)} · ${translated(kindCopy,locale)} · ${translated(stateCopy,locale)}`;
 }
 const code=/^[A-Za-z0-9_.:-]+$/.test(action)?` (${action})`:'';
 return `${translated(auditCopy.text.otherAction,locale)}${code}`;
}

/** These are the field values explicitly returned by the scoped audit RPC. */
export function profileChangeLines(change:ProfileChange|undefined,locale:Locale='en'):string[]{
 if(!change)return [];
 const text=(key:string)=>translated(auditCopy.text[key],locale),none=text('none'),lines:string[]=[];
 if(change.name)lines.push(`${text('name')}: ${change.name.before??none} → ${change.name.after??none}`);
 if(change.birthDate){
  const birth=change.birthDate;
  const before='before'in birth?birth.before:birth.beforeYear,after='after'in birth?birth.after:birth.afterYear;
  lines.push(`${text('birthDate')}: ${before??none} → ${after??none}`);
 }
 return lines;
}
