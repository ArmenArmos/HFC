import {randomUUID} from 'node:crypto';
import {Building2} from 'lucide-react';
import {ClinicSchedulingForm} from './clinic-scheduling-form';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import type {z} from 'zod';
import type {realClinicRowSchema,SchedulingActionState} from '@/lib/staff/clinic-scheduling-schema';
type Clinic=z.infer<typeof realClinicRowSchema>;
export function ClinicDirectoryList({clinics,locale='en',settingsHref,action,manageAccess=false,manageResults=false}:{clinics:Clinic[];locale?:PatientLocale;settingsHref?:string;manageAccess?:boolean;manageResults?:boolean;action?:(previous:SchedulingActionState,form:FormData)=>Promise<SchedulingActionState>}){
 return <ul aria-label={tx(locale,'Կլինիկաներ','Clinics','Клиники')} className="divide-y overflow-hidden rounded-xl border bg-background">
  {clinics.map(clinic=><li key={clinic.id} className="min-w-0 space-y-4 p-5">
   <div className="flex items-start gap-3">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-primary"><Building2 className="size-5" aria-hidden/></span>
    <div className="min-w-0 flex-1"><h2 className="break-words text-body1 font-semibold">{clinic.name}</h2><p className="mt-1 break-words text-body2 text-muted-foreground">{clinic.address||tx(locale,'Հասցեն նշված չէ','No address recorded','Адрес не указан')}</p></div>
    <span className={`shrink-0 rounded-md px-3 py-1 text-caption ${clinic.active?'bg-surface-subtle-teal text-foreground':'bg-muted text-muted-foreground'}`}>{clinic.active?tx(locale,'Ակտիվ','Active','Активна'):tx(locale,'Ոչ ակտիվ','Inactive','Неактивна')}</span>
   </div>
   <ClinicSchedulingForm kind="clinic" clinicId={clinic.id} clinicName={clinic.name} initialEmail={clinic.schedulingEmail} revision={clinic.schedulingRevision} requestId={randomUUID()} locale={locale} disabled={!clinic.active} settingsHref={settingsHref} action={action}/>
   {manageAccess&&<a aria-label={tx(locale,`Կառավարել կլինիկայի հասանելիությունը՝ ${clinic.name}`,`Manage clinic access for ${clinic.name}`,`Управлять доступом клиники ${clinic.name}`)} href={`/staff/real/clinics/${clinic.id}/access?locale=${locale}`} className="inline-flex min-h-12 items-center rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{tx(locale,'Կառավարել կլինիկայի հասանելիությունը','Manage clinic access','Управлять доступом клиники')}</a>}
   {manageResults&&<a href={`/staff/real/clinics/${clinic.id}/results`} className="ml-3 inline-flex min-h-12 items-center rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{tx(locale,'Լաբորատոր արդյունքներ','Lab results','Результаты анализов')}</a>}
  </li>)}
 </ul>;
}
