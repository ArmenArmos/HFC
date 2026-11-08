"use client";
import { useState } from "react";
import Link from "next/link";
import type { StaffClinic, StaffDoctor } from "@/lib/staff/types";
import {
  CreateClinicForm,
  CreateDoctorForm,
  EditClinicForm,
  DoctorAccessForm,
} from "./backoffice-forms";
import {SelectField} from '@/components/ui/select-field';
export function StaffDirectory({
  kind,
  clinics,
  doctors,
}: {
  kind: "doctors" | "nurses" | "clinics";
  clinics: StaffClinic[];
  doctors: StaffDoctor[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const doctorMode = kind !== "clinics";
  const nurse = kind === "nurses";
  const activeClinics = clinics.filter((c) => c.active);
  const term = query.trim().toLowerCase();
  const shownDoctors = doctors.filter(
    (d) =>
      `${d.name} ${d.email} ${clinics.find((c) => c.id === d.clinicId)?.name ?? ""}`
        .toLowerCase()
        .includes(term) &&
      (status === "all" ||
        (d.active && activeClinics.some((c) => c.id === d.clinicId)) ===
          (status === "active")),
  );
  const shownClinics = clinics.filter(
    (c) =>
      `${c.name} ${c.address}`.toLowerCase().includes(term) &&
      (status === "all" || c.active === (status === "active")),
  );
  return (
    <div className="space-y-6">
      {doctorMode && <nav aria-label="Clinical team roles" className="flex gap-2"><Link href="/staff/backoffice/doctors" aria-current={!nurse ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md px-4 text-body2 ${!nurse ? "bg-primary text-primary-foreground" : "border"}`}>Doctors</Link><Link href="/staff/backoffice/nurses" aria-current={nurse ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md px-4 text-body2 ${nurse ? "bg-primary text-primary-foreground" : "border"}`}>Nurses</Link></nav>}
      {doctorMode && <p className="text-caption text-muted-foreground">{nurse ? "Assigned measurements, evidence collection and follow-up. Treatment changes require a doctor." : "Full clinical workflow, including evidence collection and treatment approval."}</p>}
      <details className="rounded-xl border bg-background p-5">
        <summary className="min-h-11 cursor-pointer text-body2 font-semibold text-primary">
          {doctorMode ? nurse ? "Add a nurse" : "Add a doctor" : "Add a clinic"}
        </summary>
        <div className="max-w-3xl border-t pt-5">
          {doctorMode ? (
            <CreateDoctorForm clinics={activeClinics} nurse={nurse} />
          ) : (
            <CreateClinicForm />
          )}
        </div>
      </details>
      <section className="overflow-hidden rounded-xl border bg-background">
        <div className="flex flex-wrap items-end gap-4 border-b p-5">
          <label className="min-w-48 flex-1 text-caption">
            {doctorMode ? "Find a team member or clinic" : "Find a clinic"}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder={
                doctorMode ? "Name, email or clinic" : "Name or address"
              }
              className="mt-2 min-h-12 w-full rounded-md border bg-background px-4 text-body2"
            />
          </label>
          <label className="text-caption">
            Availability
            <SelectField
              value={status}
              onValueChange={setStatus}
              className="mt-2 min-w-44"
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Available" },
                { value: "inactive", label: "Unavailable" },
              ]}
            />
          </label>
        </div>
        <p
          role="status"
          className="px-5 py-3 text-caption text-muted-foreground"
        >
          {doctorMode ? shownDoctors.length : shownClinics.length} {doctorMode ? (shownDoctors.length === 1 ? nurse ? "nurse" : "doctor" : nurse ? "nurses" : "doctors") : (shownClinics.length === 1 ? "clinic" : "clinics")} shown
        </p>
        <div className="divide-y">
          {doctorMode
            ? shownDoctors.map((d) => {
                const clinic = clinics.find((c) => c.id === d.clinicId);
                const available = d.active && !!clinic?.active;
                return (
                  <article key={d.id} className="px-5 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-h3 font-semibold">{d.name}</h2>
                        <p className="mt-1 break-all text-body2 text-muted-foreground">
                          {d.email}
                        </p>
                        <p className="mt-2 text-caption">
                          {clinic?.name ?? "Clinic unavailable"}
                        </p>
                      </div>
                      <span
                        className={`rounded-md px-3 py-1 text-caption ${available ? "bg-surface-subtle-teal text-brand-teal" : "bg-muted text-muted-foreground"}`}
                      >
                        {available
                          ? "Available"
                          : !clinic?.active
                            ? "Clinic inactive"
                            : "Access inactive"}
                      </span>
                    </div>
                    <details className="mt-3">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-body2 underline">
                        Manage access
                      </summary>
                      <div className="mt-2 rounded-lg bg-muted/40 p-4">
                        <p className="mb-3 text-body2">
                          Deactivating access prevents this team member from signing
                          in. Review their case assignments before changing
                          access.
                        </p>
                        <DoctorAccessForm
                          doctorId={d.id}
                          nurse={nurse}
                          active={d.active}
                          clinicActive={!!clinic?.active}
                        />
                      </div>
                    </details>
                  </article>
                );
              })
            : shownClinics.map((c) => (
                <article key={`${c.id}:${c.active}`} className="px-5 py-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h2 className="text-h3 font-semibold">{c.name}</h2>
                      <p className="mt-1 text-body2 text-muted-foreground">
                        {c.address}
                      </p>
                      <p className="mt-2 text-caption">
                        {doctors.filter((d) => d.clinicId === c.id).length}{" "}
                        linked {doctors.filter((d) => d.clinicId === c.id).length === 1 ? "doctor" : "doctors"}
                      </p>
                    </div>
                    <span
                      className={`rounded-md px-3 py-1 text-caption ${c.active ? "bg-surface-subtle-teal text-brand-teal" : "bg-muted"}`}
                    >
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <details className="mt-3">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-body2 underline">
                      Edit clinic
                    </summary>
                    <p className="my-3 text-caption text-muted-foreground">
                      An inactive clinic also makes its doctors unavailable for
                      access and assignment.
                    </p>
                    <EditClinicForm clinic={c} />
                  </details>
                </article>
              ))}
        </div>
        {(doctorMode ? !shownDoctors.length : !shownClinics.length) && (
          <div className="p-8 text-body2">
            <p>No {kind} match this view.</p>
            <button
              className="mt-2 min-h-11 underline"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
            {doctorMode && !clinics.length && (
              <p className="mt-4">
                Start by{" "}
                <Link className="underline" href="/staff/backoffice/clinics">
                  adding a clinic
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
