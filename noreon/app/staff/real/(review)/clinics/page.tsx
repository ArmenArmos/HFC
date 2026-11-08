import Link from 'next/link';
import type {Route} from 'next';
import {Suspense} from 'react';
import {randomUUID} from 'node:crypto';
import {ClinicSchedulingForm} from '@/components/real-review/clinic-scheduling-form';
import {ClinicDirectoryList} from '@/components/real-review/clinic-directory-list';
import {resultAttachEnabled} from '@/lib/clinic-portal/result-attach-schema';
import {Building2, Plus, RotateCcw} from 'lucide-react';
import {AddClinicForm} from '@/components/real-review/admin-forms';
import {getRealClinics, getSchedulingCopySettings, requireRealAdmin} from '@/lib/staff/real-admin';

async function ClinicDirectory() {
  let clinics: Awaited<ReturnType<typeof getRealClinics>>;
  try { clinics = await getRealClinics(); }
  catch {
    return <p role="alert" className="rounded-xl border bg-background p-5 text-body2">Clinics are unavailable. <a href="/staff/real/clinics" className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><RotateCcw className="size-4" aria-hidden/>Try again</a>.</p>;
  }
  if (!clinics.length) return <div className="flex items-start gap-4 rounded-xl border bg-background p-6">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Building2 className="size-5" aria-hidden/></span>
    <div><h2 className="text-body1 font-semibold">No clinics yet</h2><p className="mt-1 text-body2 text-muted-foreground">Add your first clinic to start your directory.</p></div>
  </div>;
  return <ClinicDirectoryList clinics={clinics} manageAccess manageResults={resultAttachEnabled()}/>;
}

async function CopySchedulingSettings() {
  let setting:Awaited<ReturnType<typeof getSchedulingCopySettings>>;
  try { setting=await getSchedulingCopySettings(); }
  catch {
    return <p role="alert" className="rounded-xl border bg-background p-5 text-body2">Scheduling copy settings are unavailable. <a href="/staff/real/clinics" className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><RotateCcw className="size-4" aria-hidden/>Reload settings</a>.</p>;
  }
  return <section className="space-y-3 rounded-xl border bg-background p-5" aria-labelledby="scheduling-copy-heading">
      <h2 id="scheduling-copy-heading" className="text-h3 font-semibold">Noreon scheduling copy</h2>
      <p className="text-body2 text-muted-foreground">Configure the Noreon copy recipient separately from each clinic. Email delivery is not activated by these settings.</p>
      <ClinicSchedulingForm kind="copy" initialEmail={setting.email} revision={setting.revision} requestId={randomUUID()}/>
    </section>;
}

export default async function RealClinicsPage() {
  await requireRealAdmin();
  return <div className="space-y-6">
    <h1 className="flex items-center gap-3 text-h1"><Building2 className="size-7 shrink-0 text-primary" aria-hidden/>Clinics</h1>
    <Link href={"/staff/real/clinics/approvals" as Route} className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2">Review clinic changes</Link>
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground transition-colors hover:bg-primary/90 group-open:bg-muted group-open:text-foreground group-open:hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Plus className="size-4 group-open:rotate-45" aria-hidden/>Add clinic
      </summary>
      <section className="mt-4 space-y-4 rounded-xl border bg-background p-5" aria-labelledby="add-clinic-heading">
        <h2 id="add-clinic-heading" className="text-h3 font-semibold">Add clinic</h2>
        <AddClinicForm/>
      </section>
    </details>
    <Suspense fallback={<p role="status" className="text-body2">Loading scheduling copy settings…</p>}><CopySchedulingSettings/></Suspense>
    <Suspense fallback={<p role="status" className="rounded-xl border bg-background p-5 text-body2 text-muted-foreground">Loading clinics…</p>}><ClinicDirectory/></Suspense>
  </div>;
}
