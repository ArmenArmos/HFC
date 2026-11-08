import {z} from 'zod';
import {careAlertSchema} from './contracts';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
const contactSchema=z.object({id:z.string(),memberId:z.uuid(),at:z.string(),by:z.string(),kind:z.enum(['reply','task']),state:z.string()});
export const resolutionRecordSchema=z.object({alert:careAlertSchema.omit({resolutionNote:true}),cycleStartedAt:z.string(),closer:z.string().optional(),contacts:z.array(contactSchema)});
export type ResolutionRecord=z.infer<typeof resolutionRecordSchema>;
export type ResolutionSuggestion={outcome:''|'member_contacted';reason:string};
/** Templates report current-cycle contact facts only. A next action never proves contact. */
export function suggestResolution(record:ResolutionRecord,l:StaffLocale):ResolutionSuggestion{
 const a=record.alert,t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const after=(memberId:string,at:string)=>memberId===a.memberId&&Number.isFinite(Date.parse(at))&&Date.parse(at)>Date.parse(record.cycleStartedAt);
 const contact=record.contacts.filter(c=>after(c.memberId,c.at)&&c.by.trim()&&(c.kind==='reply'?['in_app','accepted_by_provider'].includes(c.state):c.state==='reached')).sort((x,y)=>Date.parse(y.at)-Date.parse(x.at)||x.id.localeCompare(y.id))[0];
 const facts:string[]=[];
 if(contact){const when=yerevanStamp(contact.at,l),where=contact.kind==='reply'?t('reply in the chat','պատասխան զրույցում','ответ в чате'):t('contact recorded on the task','առաջադրանքում գրանցված կապ','контакт записан в задаче');facts.push(t(`Member contacted by ${contact.by} on ${when} (${where}).`,`${contact.by}-ը կապ է հաստատել անդամի հետ ${when} (${where})։`,`С участником связались: ${contact.by}, ${when} (${where}).`));}
 else{const when=yerevanStamp(a.createdAt,l);facts.push(t(`Alert recorded on ${when}.`,`Ահազանգը գրանցվել է ${when}։`,`Оповещение записано: ${when}.`));}
 if(a.nextAction)facts.push(t(`Next action recorded: "${a.nextAction}"`,`Գրանցված հաջորդ գործողություն՝ "${a.nextAction}"`,`Записанное следующее действие: "${a.nextAction}"`));
 if(a.acknowledgedBy&&a.acknowledgedAt&&Number.isFinite(Date.parse(a.acknowledgedAt))){const when=yerevanStamp(a.acknowledgedAt,l);facts.push(t(`Acknowledged by ${a.acknowledgedBy} on ${when}.`,`Ստացումը հաստատել է ${a.acknowledgedBy}-ը ${when}։`,`Подтвердил: ${a.acknowledgedBy}, ${when}.`));}
 // Keep the recorded next action whole rather than rewriting it.
 let reason='';for(const fact of facts)if((reason.length?reason.length+1:0)+fact.length<=1000)reason+=(reason?' ':'')+fact;
 return {outcome:contact?'member_contacted':'',reason};
}
export const suggestedFromRecord=(l:StaffLocale)=>st(l,'Suggested from the record','Առաջարկված է գրանցված տվյալներից','Предложено на основе записей');
export const noContactRecorded=(l:StaffLocale)=>st(l,'Nothing recorded yet. Choose an outcome.','Կապ դեռ գրանցված չէ։ Ընտրեք արդյունքը։','Контакт пока не записан. Выберите исход.');
