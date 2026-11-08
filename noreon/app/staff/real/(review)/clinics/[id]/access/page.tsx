import {parseLocale} from '@/lib/locale';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {ClinicAccessManager} from '@/components/clinic-portal/admin-memberships';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {readClinicAdminPage} from '@/lib/clinic-portal/admin-runtime';
import {clinicAdminRead,clinicAdminLookup,clinicAdminCommand,clinicAdminRecover} from '@/lib/clinic-portal/admin-actions';
import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import {tx} from '@/lib/patient/copy';
import {staffTelegramEnrolmentEnabled} from '@/lib/telegram-auth/staff-signin';
import {telegramBotUsername} from '@/lib/telegram-runtime/config';
import {randomUUID} from 'node:crypto';
import {ClinicTelegramInvitations} from '@/components/clinic-portal/telegram-invitations';
import {clinicTelegramInvitesReady} from '@/lib/telegram-auth/clinic-invite-config';
import {listClinicInvitations} from '@/lib/telegram-auth/clinic-invite';
import {staffTelegramRecoveryReady} from '@/lib/telegram-auth/staff-recovery';

export default async function ClinicMembershipPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{locale?:string}>}){
 const context=await requireRealAdmin(),{id}=await params;
 if(!z.uuid().safeParse(id).success)notFound();
 const locale=parseLocale((await searchParams).locale,'hy'),invites=clinicTelegramInvitesReady();
 const result=await readClinicAdminPage(context.client as unknown as ClinicRpc,id);
 if(result.status!=='loaded')return <div lang={locale} className="space-y-4"><h1 className="text-h1">{tx(locale,'Կլինիկայի հասանելիություն','Clinic access','Доступ к клинике')}</h1><p role="alert" className="text-body2">{tx(locale,'Կլինիկայի հասանելիությունների ցանկն անհասանելի է։','Clinic access list is unavailable.','Список доступа к клинике недоступен.')}</p><a className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" href={`/staff/real/clinics/${id}/access?locale=${locale}`}>{tx(locale,'Կրկին փորձել','Try again','Повторить попытку')}</a></div>;
 return <div lang={locale} className="min-w-0 space-y-5"><h1 className="break-words text-h1">{result.data.clinic.name}: {tx(locale,'կլինիկայի հասանելիություն','clinic access','доступ к клинике')}</h1><p className="text-body2 text-muted-foreground">{tx(locale,'Կառավարեք այս կլինիկայի հասանելիությունը։ Կլինիկայի փաստաթղթերը դիտելու համար անհրաժեշտ է առանձին անդամակցություն։','Manage access to this clinic. Viewing clinic documents requires a separate clinic membership.','Управляйте доступом к этой клинике. Для просмотра документов клиники требуется отдельное членство в клинике.')}</p><ClinicAccessManager telegramRecovery={staffTelegramRecoveryReady()} telegram={staffTelegramEnrolmentEnabled()&&telegramBotUsername()!==null} initial={result.data} actorScope={context.actorScope} actorId={context.identity.id} locale={locale} ports={{read:clinicAdminRead,lookup:clinicAdminLookup,command:clinicAdminCommand,recover:clinicAdminRecover}}/>{invites&&<ClinicTelegramInvitations clinicId={id} invitations={await listClinicInvitations(context.client,id).catch(()=>null)} requestId={randomUUID()} locale={locale}/>}</div>;
}
