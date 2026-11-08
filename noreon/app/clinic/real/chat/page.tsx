import {clinicLocale} from '@/lib/clinic-portal/locale';
import {notFound} from 'next/navigation';
import {clinicAccess,requireClinicPortal} from '@/lib/clinic-portal/identity';
import {clinicChatEnabled} from '@/lib/clinic-chat/config';
import {chatQuerySchema} from '@/lib/clinic-chat/schema';
import {clinicChatRead,clinicChatCommand,clinicChatSlots} from '@/lib/clinic-chat/actions';
import {ClinicShell} from '@/components/clinic-portal/shell';
import {ClinicChat} from '@/components/clinic-portal/chat';
import {resultAttachEnabled} from '@/lib/clinic-portal/result-attach-schema';
// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function ClinicChatPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicChatEnabled())notFound();
 const query=await searchParams,locale=await clinicLocale(query.locale);
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true});
 const clinicId=context.identity.clinicId;
 const parsed=chatQuerySchema.safeParse(typeof query.member==='string'?{kind:'member',memberId:query.member}:{kind:'home'});
 if(!parsed.success)notFound();
 const choices=await clinicAccess();
 const canChooseClinic=choices.access.status==='selection-required';
 const initial=await clinicChatRead(clinicId,context.actorScope,parsed.data);
 return <ClinicShell identity={context.identity} locale={locale} current="chat"><ClinicChat key={`${context.actorScope}:${locale}:${parsed.data.kind==='member'?parsed.data.memberId:'home'}`} identity={context.identity} locale={locale} actorScope={context.actorScope} canChooseClinic={canChooseClinic} resultLink={resultAttachEnabled()} initial={initial} initialQuery={parsed.data}
 read={clinicChatRead.bind(null,clinicId,context.actorScope)} run={clinicChatCommand.bind(null,clinicId,context.actorScope)} slots={clinicChatSlots.bind(null,clinicId,context.actorScope)}/></ClinicShell>;
}
