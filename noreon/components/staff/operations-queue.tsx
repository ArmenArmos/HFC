"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AssignCaseForm } from "./backoffice-forms";
import {SelectField} from '@/components/ui/select-field';
export type OperationsItem = {
  id: string;
  name: string;
  next: string;
  doctor: string;
  assignedDoctorId: string | null;
  priority: number;
  flags: string[];
};
const filters = [
  "All",
  "Urgent",
  "Needs assignment",
  "Missing results",
  "Needs rescheduling",
  "Overdue review",
  "Needs review",
  "Published",
];
export function OperationsQueue({
  items,
  doctors,
  initialFilter = "All",
}: {
  items: OperationsItem[];
  doctors: Array<{ id: string; name: string; clinicName: string }>;
  initialFilter?: string;
}) {
  const [filter, setFilter] = useState(
      filters.includes(initialFilter) ? initialFilter : "All",
    ),
    [search, setSearch] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const shown = items.filter(
    (i) =>
      (filter === "All" || i.flags.includes(filter)) &&
      `${i.name} ${i.id} ${i.doctor}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap items-end gap-4 border-b p-5">
        <label className="min-w-48 flex-1 text-caption">
          Find a member, case or GP
          <input
            type="search"
            placeholder="Name, case ID or assigned GP"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border bg-background px-4 text-body2"
          />
        </label>
        <label className="text-caption">
          Case status
          <SelectField
            value={filter}
            onValueChange={setFilter}
            className="mt-2 min-w-48"
            options={filters.map((f) => ({ value: f, label: f }))}
          />
        </label>
        <button
          disabled={pending}
          className="min-h-12 rounded-md border px-4 text-body2"
          onClick={() => start(() => router.refresh())}
        >
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p role="status" className="px-5 py-3 text-caption text-muted-foreground">
        {shown.length} of {items.length} cases · Urgent cases first
      </p>
      <div className="hidden grid-cols-[1.1fr_1.5fr_1fr_auto] gap-5 border-y bg-muted/40 px-5 py-3 text-caption text-muted-foreground lg:grid">
        <span>Member</span>
        <span>Next action</span>
        <span>Assigned GP</span>
        <span className="w-24">Case</span>
      </div>
      <div className="divide-y">
        {shown.map((i) => (
          <article
            key={i.id}
            className={`grid items-start gap-4 px-5 py-5 lg:grid-cols-[1.1fr_1.5fr_1fr_auto] lg:gap-5 ${i.flags.includes("Urgent") ? "border-l-4 border-l-destructive" : ""}`}
          >
            <div>
              <h2 className="break-words text-body1 font-semibold">{i.name}</h2>
              <div className="mt-2 flex flex-wrap gap-1">
                {(i.flags.length ? i.flags : ["In progress"]).map((f) => (
                  <span
                    key={f}
                    className={`rounded-md px-2 py-1 text-caption ${f === "Urgent" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-body2 leading-relaxed">{i.next}</p>
            <div>
              <p className="text-body2">{i.doctor}</p>
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer text-caption leading-10 underline">
                  {i.assignedDoctorId ? "Change GP" : "Assign GP"}
                </summary>
                <div className="mt-2">
                  <AssignCaseForm
                    key={`${i.id}:${i.assignedDoctorId}`}
                    caseId={i.id}
                    memberName={i.name}
                    assignedDoctorId={i.assignedDoctorId}
                    doctors={doctors}
                  />
                </div>
              </details>
            </div>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-body2 font-medium hover:bg-muted"
              href={`/staff/case/${i.id}`}
            >
              Open case
            </Link>
          </article>
        ))}
      </div>
      {!shown.length && (
        <div className="p-8 text-body2">
          <p>No cases match this view.</p>
          <button
            className="mt-2 min-h-11 underline"
            onClick={() => {
              setFilter("All");
              setSearch("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
