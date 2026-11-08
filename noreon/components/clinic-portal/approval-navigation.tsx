import {requireClinicPortal} from '@/lib/clinic-portal/identity';
import {readChangeRequests} from '@/lib/clinic-admin/approvals';
import type {Locale} from '@/lib/locale';
import {ClinicNavigation,type ClinicSection} from './navigation';
export async function ClinicApprovalNavigation({items,clinicId,locale,current}:{items:ClinicSection[];clinicId:string;locale:Locale;current?:ClinicSection}){
 const context=await requireClinicPortal(clinicId);
 const list=context.identity.capability==='clinic_admin'?await readChangeRequests(context.rpc,clinicId):null;
 return <ClinicNavigation items={items} clinicId={clinicId} locale={locale} current={current} pendingCount={list?.status==='loaded'?list.requests.length:undefined}/>;
}
