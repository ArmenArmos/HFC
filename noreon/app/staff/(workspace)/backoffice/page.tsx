import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { requireStaff } from "@/lib/staff/auth";
import { backofficeData } from "@/lib/staff/backoffice-data";
export default async function BackofficePage() {
  await requireStaff("admin");
  const { queue, activeDoctors, activeClinics, monitoringWarning, followups } = await backofficeData();
  const priorities = [
    "Urgent",
    "Needs assignment",
    "Needs rescheduling",
    "Overdue review",
    "Needs review",
    "Missing results",
  ];
  const attention = priorities
    .map((label) => ({
      label,
      count: queue.filter((i) => i.flags.includes(label)).length,
    }))
    .filter((i) => i.count > 0);
  return (
    <>
      <header className="mb-8">
        <p className="mb-2 text-body2 text-muted-foreground">Overview</p>
        <h1 className="text-h1 font-semibold">Keep care moving.</h1>
        <p className="mt-3 max-w-2xl text-body1 text-muted-foreground">
          Start with the cases that need attention. Manage your team and clinics
          in their own spaces.
        </p>
      </header>
      {monitoringWarning&&<p role="alert" className="mb-5 rounded-lg border p-4 text-body2">{monitoringWarning}</p>}
      {!!followups.length&&<p className="mb-5 text-body2"><Link className="underline" href="/staff/backoffice/cases">{followups.length} monitoring follow-up {followups.length===1?"task":"tasks"} awaiting evidence</Link></p>}
      <div className="mb-8 grid grid-cols-3 divide-x rounded-xl border bg-background py-5">
        {[
          [queue.length, "Demo cases", "cases"],
          [activeDoctors.length, "Available doctors", "doctors"],
          [activeClinics.length, "Active clinics", "clinics"],
        ].map(([count, label, path]) => (
          <Link
            key={String(path)}
            href={`/staff/backoffice/${path}`}
            className="px-4 sm:px-6 hover:underline"
          >
            <p className="text-h2 font-semibold tabular-nums">{count}</p>
            <p className="mt-1 text-caption text-muted-foreground">{label}</p>
          </Link>
        ))}
      </div>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border bg-background">
          <header className="flex items-center justify-between gap-3 border-b p-6">
            <h2 className="text-h3 font-semibold">Needs attention</h2>
            <Link
              href="/staff/backoffice/cases"
              className="inline-flex min-h-11 items-center text-body2 underline"
            >
              View all cases
            </Link>
          </header>
          {attention.length ? (
            <ul className="divide-y">
              {attention.map((item) => (
                <li key={item.label}>
                  <Link
                    className="flex min-h-20 items-center gap-4 px-6 py-4 hover:bg-muted/40"
                    href={`/staff/backoffice/cases?filter=${encodeURIComponent(item.label)}`}
                  >
                    <span
                      className={`flex size-10 items-center justify-center rounded-lg font-semibold ${item.label === "Urgent" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
                    >
                      {item.count}
                    </span>
                    <span className="flex-1 text-body2 font-medium">
                      {item.label}
                    </span>
                    <ArrowUpRight className="size-5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-10">
              <CheckCircle2
                className="mb-4 size-8 text-brand-teal"
                aria-hidden
              />
              <h3 className="text-h3">No other operations tasks currently recorded</h3>
              <p className="mt-2 text-body2 text-muted-foreground">
                Cases may still be waiting for a member to finish their health
                questions. Open the case list to see each next step.
              </p>
            </div>
          )}
        </section>
        <section className="space-y-5">
          <h2 className="text-h3 font-semibold">Your workspace</h2>
          {[
            [
              "Cases",
              "Track progress, review bookings and change GP assignments.",
              "cases",
            ],
            [
              "Doctors",
              "Create accounts and manage clinic-linked access.",
              "doctors",
            ],
            ["Clinics", "Maintain locations and availability.", "clinics"],
          ].map(([title, detail, path]) => (
            <Link
              key={path}
              href={`/staff/backoffice/${path}`}
              className="block border-b pb-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-body1 font-medium">{title}</h3>
                <ArrowUpRight className="size-4" aria-hidden />
              </div>
              <p className="mt-2 text-body2 text-muted-foreground">{detail}</p>
            </Link>
          ))}
          <p className="rounded-lg bg-surface-subtle-teal p-4 text-caption">
            New demo cases get the test GP automatically when that doctor and
            clinic are active. You can reassign them in Cases.
          </p>
        </section>
      </div>
    </>
  );
}
