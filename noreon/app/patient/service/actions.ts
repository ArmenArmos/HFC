"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import { careAfterPublication } from "@/lib/service-workflow/care-continuity";
import { evaluate } from "@/lib/clinical/rules/engine";
import { revalidatePath } from "next/cache";
import { demoEnabled, readDemo, saveDemo } from "@/lib/patient/demo";
import { workflowForDemo } from "@/lib/service-workflow/server";
import {
  applyServiceCommand,
  serviceCommandSchema,
} from "@/lib/service-workflow/model";
import type { ServiceCommand } from "@/lib/service-workflow/types";
import { legacyBookingFailure } from "@/lib/demo-booking/legacy-guard";
import type { Json } from "@/lib/db/types";
import { workspaceAdmin } from "@/lib/staff/auth";
import { getStaff } from "@/lib/staff/auth";
import { getWorkspaceCase, persistWorkspaceCase, sharedDemoEnabled, assignedCaseDoctor, findWorkspaceCase } from "@/lib/staff/cases";
export const serviceCommand=loggedAction("serviceCommand",async function serviceCommand(
  command: ServiceCommand,
  revision: number,
  caseId?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!demoEnabled())
    return {
      ok: false,
      error: "This workflow is available in the demo environment.",
    };
  const parsed = serviceCommandSchema.safeParse(command);
  if (!parsed.success || !Number.isSafeInteger(revision) || revision < 0)
    return { ok: false, error: "Check the submitted details." };
  if (!sharedDemoEnabled() &&
    (parsed.data.type === "save-draft" || parsed.data.type === "publish") &&
    !parsed.data.reportEvidenceSession) {
    return { ok: false, error: "Reload the evidence and review the draft before saving or publishing." };
  }
  if (parsed.data.type === "record-provider-preparation" && (!sharedDemoEnabled() || !caseId))
    return {ok:false,error:"Open the authenticated operations case to record provider preparation."};
  const staff = caseId ? await getStaff() : null;
  if (caseId && !staff) return { ok: false, error: "Sign in to your staff workspace." };
  const item = caseId && staff ? await getWorkspaceCase(caseId, staff) : null;
  const data = item?.state ?? await readDemo();
  if (sharedDemoEnabled()) {
    const permitted = staff?.role === "doctor"
      ? ["receive", "consultation", "complete-consultation", "save-draft", "publish"]
      : staff?.role === "admin" ? ["receive", "reset", "record-provider-preparation"] : staff ? [] : ["book", "cancel", "confirm-booking", "appointment"];
    if (!permitted.includes(parsed.data.type)) return { ok: false, error: "This action is not available in your workspace." };
  }
  if (!data?.state.profile || !data.state.consentAccepted)
    return { ok: false, error: "Sign in and complete your profile first." };
  if (
    data.state.assessment &&
    (data.state.assessment.urgentRule ||
      evaluate({ answers: data.state.assessment.answers, observations: [] })
        .urgency === "red") &&
    ["book", "confirm-booking", "record-provider-preparation", "appointment", "complete-consultation", "publish"].includes(
      parsed.data.type,
    )
  ) {
    return {
      ok: false,
      error:
        "Urgent questionnaire guidance takes priority. Open the member urgent guidance or update the questionnaire before continuing routine care.",
    };
  }
  const workflow = workflowForDemo(data);
  const doctorItem = item ?? (sharedDemoEnabled() ? await findWorkspaceCase(data.userId) : null);
  if (workflow && sharedDemoEnabled()) {
    const doctor = doctorItem ? await assignedCaseDoctor(doctorItem) : null;
    workflow.doctors = doctor ? [doctor] : [];
    workflow.assignedDoctorId = doctor?.id ?? "";
    if (parsed.data.type === "appointment" && !doctor?.active) return { ok: false, error: "Your GP assignment is pending. Please check again later." };
  }
  if (!workflow || workflow.revision !== revision)
    return {
      ok: false,
      error: "This case has changed. Refresh and try again.",
    };
  // Provider tests now use request → proposal → acceptance. Old controls remain
  // valid only for historical bookings and home recording tasks.
  if (sharedDemoEnabled()) {
    const error = legacyBookingFailure(workflow, parsed.data);
    if (error) return { ok: false, error };
  }
  if (
    parsed.data.type !== "reset" &&
    !data.state.assessment?.completedAt &&
    (sharedDemoEnabled() || !data.care || data.care.stage === "profile")
  )
    return {
      ok: false,
      error:
        "Complete the questionnaire before arranging care.",
    };
  try {
    const command = parsed.data;
    if (item && staff && (command.type === "save-draft" || command.type === "publish")) {
      if (command.evidenceRevision === undefined) throw new Error("Reload the evidence before saving or publishing.");
      // Validate against this authenticated case version; SQL rechecks under lock.
      applyServiceCommand(workflow, command);
      const args = {p_id:item.id,p_actor:staff.id,p_expected_revision:item.revision,p_expected_evidence_revision:command.evidenceRevision};
      const result = command.type === "save-draft"
        ? await workspaceAdmin().rpc("workspace_save_review_draft", {...args,p_draft:command.draft as unknown as Json,p_monitoring_decisions:command.monitoringDecisions??[]})
        : await workspaceAdmin().rpc("workspace_publish_review", args);
      if (result.error) throw new Error(result.error.message);
    } else {
      data.workflow = applyServiceCommand(workflow, command, new Date(), staff ? {role:staff.role,id:staff.id} : undefined);
      if (command.type === "publish") data.care=careAfterPublication(data.care,workflow.publication);
      if (command.type === "reset") data.care={stage:data.care?.stage ?? "profile",events:[],acknowledged:false};
      if (item && staff && command.type === "reset") {
        const result = await workspaceAdmin().rpc("workspace_reset_review",{p_id:item.id,p_actor:staff.id,p_expected_revision:item.revision,p_workflow:data.workflow as unknown as Json});
        if (result.error) throw new Error(result.error.message);
      } else if (item) await persistWorkspaceCase(data, null, staff?.id ?? null);
      else await saveDemo(data);
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The change could not be saved.",
    };
  }
  // The shared doctor editor refreshes its coherent snapshot and keeps unsaved
  // text on failure. Revalidating its server tree here would replace that editor
  // with an error boundary if the read after a committed write fails.
  if (!item || staff?.role !== "doctor") {
    revalidatePath("/patient", "layout");
    revalidatePath("/staff", "layout");
  }
  return { ok: true };
});
