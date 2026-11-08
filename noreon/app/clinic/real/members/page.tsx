import {clinicLocale} from '@/lib/clinic-portal/locale';
import{notFound,redirect}from'next/navigation';import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{ClinicShell}from'@/components/clinic-portal/shell';import{ClinicMemberSearch}from'@/components/clinic-portal/member-search';
import{clinicSchedulingEnabled}from'@/lib/clinic-scheduling/schema';import{clinicMemberSearch}from'@/lib/clinic-scheduling/member-actions';import{searchClinicMembers}from'@/lib/clinic-scheduling/member-file';
export default async function ClinicMembersPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicSchedulingEnabled())notFound();
 const query=await searchParams,locale=await clinicLocale(query.locale),t=(en:string,hyText:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hyText:en;
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability==='clinic_admin'&&context.identity.fullAccess)redirect(`/clinic/real/records?clinic=${clinicId}&locale=${locale}`);
 // The first page (no filter) is read on the server, through the same audited RPC as the search.
 const initial=await searchClinicMembers(context.rpc,clinicId,'',1);
 return <ClinicShell identity={context.identity} locale={locale} current="members">
  <div className="space-y-2"><h1 className="text-h1">{t('Members','Անդամներ','Участники')}</h1><p className="text-body2 text-muted-foreground">{t('Members who have booked a visit with your clinic or have lab results from it. Newest activity first.','Անդամներ, ովքեր այց են գրանցել ձեր կլինիկայում կամ ունեն դրա լաբորատոր արդյունքներ։ Սկզբում՝ վերջին ակտիվությամբ անդամները։','Участники, которые записались на приём в вашу клинику или получили в ней результаты анализов. Сначала показаны участники с последней активностью.')}</p></div>
  <ClinicMemberSearch clinicId={clinicId} locale={locale} initial={initial} search={clinicMemberSearch.bind(null,clinicId,context.actorScope)}/>
 </ClinicShell>;
}
