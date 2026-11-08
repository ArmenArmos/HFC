"use client";
import { useActionState, useState } from "react";
import { assignNurse, assignRealNurse } from "@/lib/staff/nurse-actions";
import { buttonClass } from "./shell";
import {SelectField} from '@/components/ui/select-field';
export function NurseAssignment({ id, revision, assignedNurseId, nurses, native = false, onSaved }: { id: string; revision: number; assignedNurseId?: string | null; nurses: { id: string; name: string }[]; native?: boolean; onSaved?:()=>void }) {
  const [state, action, pending] = useActionState(async(previous:{status:"idle"|"success"|"error";message:string},form:FormData)=>{const result=await(native?assignRealNurse:assignNurse)(previous,form);if(result.status==='success')onSaved?.();return result;}, { status: "idle" as const, message: "" });
  const savedNurseId = assignedNurseId || "";
  const [draft, setDraft] = useState({ id, revision, savedNurseId, value: savedNurseId });
  // Revalidation is authoritative. Keep edits on failures, but replace the draft
  // before rendering a different case or a newly saved revision.
  if (draft.id !== id || draft.revision !== revision || draft.savedNurseId !== savedNurseId) {
    setDraft({ id, revision, savedNurseId, value: savedNurseId });
  }
  // Server actions reset native forms after success. Selection follows the
  // validated props above, so suppress that native reset of the select DOM.
  return <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-h3">Assigned nurse</h2><form action={action} onReset={event => event.preventDefault()} className="flex flex-wrap items-end gap-3"><input name="caseId" type="hidden" value={id} /><input name="revision" type="hidden" value={revision} /><label className="min-w-48 flex-1 text-body2">Nurse<SelectField className="mt-1" name="nurseId" value={draft.value} onValueChange={value => setDraft({ id, revision, savedNurseId, value })} disabled={pending} options={[{ value: "", label: "No assigned nurse" }, ...nurses.map(nurse => ({ value: nurse.id, label: nurse.name }))]} /></label><button disabled={pending} className={buttonClass}>{pending ? "Saving assignment…" : "Save nurse assignment"}</button>{state.message && <p className="w-full text-body2" role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}</form><p className="text-caption text-muted-foreground">Only active nurses in the assigned doctor’s clinic are eligible.</p></section>;
}
