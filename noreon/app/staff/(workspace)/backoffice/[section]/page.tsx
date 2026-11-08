import {yerevanStamp} from '@/lib/staff/yerevan-time';
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { backofficeData } from "@/lib/staff/backoffice-data";
import { listClinics, listDoctors, listNurses } from "@/lib/staff/admin";
import { loadStaffDirectory } from "@/lib/staff/directory-data";
import { OperationsQueue } from "@/components/staff/operations-queue";
import { StaffDirectory } from "@/components/staff/directory";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireStaff("admin");
  const { section } = await params;
  if (!["cases", "doctors", "nurses", "clinics"].includes(section)) notFound();
  const { filter } = await searchParams;
  const data = section === "cases"
    ? await backofficeData()
    : { ...(await loadStaffDirectory((section === "nurses" ? "doctors" : section) as "doctors" | "clinics", { clinics: listClinics, doctors: section === "nurses" ? listNurses : listDoctors })), queue: [], activeDoctors: [],followups:[],monitoringWarning:null };
  const title =
    section === "cases"
      ? "Cases"
      : section === "doctors"
        ? "Doctors"
        : section === "nurses" ? "Nurses" : "Clinics";
  return (
    <>
      <header className="mb-7">
        <h1 className="text-h1 font-semibold">{title}</h1>
        <p className="mt-2 max-w-2xl text-body2 text-muted-foreground">
          {section === "cases"
            ? "See the next action for every case. Open one to coordinate bookings, results and history."
            : section === "doctors"
              ? "Manage doctor accounts and their clinic access."
              : section === "nurses" ? "Manage nurse accounts and their clinic access." : "Manage clinic details and availability."}
        </p>
      </header>
      {data.monitoringWarning&&<p role="alert" className="mb-5 rounded-lg border p-4 text-body2">{data.monitoringWarning}</p>}
      {section==='cases'&&<section className="mb-6 space-y-3 rounded-xl border bg-card p-5"><h2 className="text-h2">Monitoring follow-up</h2><p className="text-body2 text-muted-foreground">Missing evidence after a doctor-set window. Contact outcomes do not mark readings received.</p>{data.followups.length?<ul className="divide-y">{data.followups.map(f=><li key={f.requirementId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-body2 font-medium">{f.name}</p><p className="text-caption">Due {yerevanStamp(f.dueAt,'en')} · {f.owner}</p></div><Link className="inline-flex min-h-11 items-center underline" href={`/staff/case/${f.caseId}#monitoring`}>Coordinate follow-up</Link></li>)}</ul>:<p className="text-body2">No missing-evidence follow-up is currently recorded.</p>}</section>}
      {section === "cases" ? (
        <OperationsQueue
          key={filter ?? "All"}
          initialFilter={filter}
          items={data.queue}
          doctors={data.activeDoctors.map((d) => ({
            id: d.id,
            name: d.name,
            clinicName:
              data.clinics.find((c) => c.id === d.clinicId)?.name ??
              "Clinic unavailable",
          }))}
        />
      ) : (
        <StaffDirectory
          kind={section as "doctors" | "nurses" | "clinics"}
          clinics={data.clinics}
          doctors={data.doctors}
        />
      )}
    </>
  );
}
