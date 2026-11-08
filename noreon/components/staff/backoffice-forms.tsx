"use client";

import { useActionState } from "react";
import {
  activateDoctor,
  activateNurse,
  createNurse,
  assignCase,
  createClinic,
  createDoctor,
  editClinic,
  type BackofficeFormState,
} from "@/lib/staff/actions";
import {SelectField} from '@/components/ui/select-field';

const initialState: BackofficeFormState = { status: "idle", message: "" };
const inputClass = "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-body2 outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-body2 font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring";

function FormMessage({ state }: { state: BackofficeFormState }) {
  if (!state.message) return null;
  return <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className={`text-caption ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{state.message}</p>;
}

export function CreateClinicForm() {
  const [state, action, pending] = useActionState(createClinic, initialState);
  return <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
    <label className="text-caption">Clinic name<input className={`${inputClass} mt-1`} name="name" required defaultValue={state.values?.name ?? ""} /></label>
    <label className="text-caption">Address<input className={`${inputClass} mt-1`} name="address" required defaultValue={state.values?.address ?? ""} /></label>
    <button className={`${buttonClass} self-end bg-primary text-primary-foreground`} type="submit" disabled={pending}>{pending ? "Adding…" : "Add clinic"}</button>
    <div className="sm:col-span-3"><FormMessage state={state} /></div>
  </form>;
}

export function EditClinicForm({ clinic }: { clinic: { id: string; name: string; address: string; active: boolean } }) {
  const [state, action, pending] = useActionState(editClinic, initialState);
  const values = state.values;
  return <form action={action} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
    <input type="hidden" name="clinicId" value={clinic.id} />
    <label className="text-caption">Name<input className={`${inputClass} mt-1`} name="name" defaultValue={values?.name ?? clinic.name} required /></label>
    <label className="text-caption">Address<input className={`${inputClass} mt-1`} name="address" defaultValue={values?.address ?? clinic.address} required /></label>
    <label className="flex min-h-11 items-center gap-2 text-caption"><input className="size-4" type="checkbox" name="active" value="true" defaultChecked={values ? values.active === "true" : clinic.active} /> Active</label>
    <button className={buttonClass} type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    <div className="sm:col-span-4"><FormMessage state={state} /></div>
  </form>;
}

export function CreateDoctorForm({ clinics, nurse = false }: { clinics: Array<{ id: string; name: string }>; nurse?: boolean }) {
  const [state, action, pending] = useActionState(nurse ? createNurse : createDoctor, initialState);
  return <form action={action} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-caption">Full name<input className={`${inputClass} mt-1`} name="name" autoComplete="name" required defaultValue={state.values?.name ?? ""} /></label>
      <label className="text-caption">Email<input className={`${inputClass} mt-1`} name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} /></label>
    </div>
    <label className="block text-caption">Temporary password<input className={`${inputClass} mt-1`} name="password" type="password" autoComplete="new-password" minLength={12} required /><span className="mt-1 block text-caption text-muted-foreground">Use at least 12 characters and share it securely with the staff member.</span></label>
    <label className="block text-caption">Clinic<SelectField className="mt-1" name="clinicId" required defaultValue={state.values?.clinicId ?? ""} placeholder="Select a clinic" options={clinics.map((clinic) => ({ value: clinic.id, label: clinic.name }))}/></label>
    <button className={`${buttonClass} bg-primary text-primary-foreground`} type="submit" disabled={pending || clinics.length === 0}>{pending ? "Creating…" : nurse ? "Create nurse account" : "Create doctor account"}</button>
    {clinics.length === 0 && <p className="text-caption text-muted-foreground">Create an active clinic before adding staff.</p>}
    <FormMessage state={state} />
  </form>;
}

export function DoctorAccessForm({ doctorId, active, clinicActive, nurse = false }: { doctorId: string; active: boolean; clinicActive: boolean; nurse?: boolean }) {
  const [state, action, pending] = useActionState(nurse ? activateNurse : activateDoctor, initialState);
  const canActivate = clinicActive || active;
  return <form action={action} className="flex flex-col items-start gap-1">
    <input type="hidden" name={nurse ? "nurseId" : "doctorId"} value={doctorId} /><input type="hidden" name="active" value={String(!active)} />
    <button className={buttonClass} type="submit" disabled={pending || !canActivate}>{pending ? "Updating…" : active ? "Deactivate" : "Activate"}</button>
    {!clinicActive && <span className="max-w-48 text-caption text-muted-foreground">Clinic inactive. Reactivate the clinic before enabling this staff member.</span>}
    <FormMessage state={state} />
  </form>;
}

export function AssignCaseForm({ caseId, memberName, assignedDoctorId, doctors }: { caseId: string; memberName: string; assignedDoctorId: string | null; doctors: Array<{ id: string; name: string; clinicName: string }> }) {
  const [state, action, pending] = useActionState(assignCase, initialState);
  const selectedDoctorId = state.values?.doctorId ?? assignedDoctorId ?? doctors[0]?.id ?? "";
  return <form action={action} className="flex flex-col items-start gap-2">
    <input type="hidden" name="caseId" value={caseId} />
    <div className="flex flex-wrap gap-2">
      <SelectField className="max-w-80" name="doctorId" aria-label={`Assigned GP for ${memberName}`} required disabled={doctors.length === 0} defaultValue={selectedDoctorId} placeholder={doctors.length === 0 ? "No active doctors available" : undefined} options={doctors.map((doctor) => ({ value: doctor.id, label: doctor.name, description: doctor.clinicName }))}/>
      <button className={buttonClass} type="submit" disabled={pending || doctors.length === 0}>{pending ? "Saving…" : "Save GP assignment"}</button>
    </div>
    {doctors.length === 0 && <p className="max-w-64 text-caption text-muted-foreground">Activate a doctor at an active clinic to assign cases.</p>}
    <FormMessage state={state} />
  </form>;
}
