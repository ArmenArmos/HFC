import type { Locale } from "@/lib/locale";
import { z } from "zod";
import { publicationOrder, publishWithContinuity } from "./continuity";
import { bookingApplies, bookingHasReceipt, ensureRecommendationRecords } from "./reconciliation";
import { draftSchema, validReviewDraft, publicationBlockers } from "./publication";
import type { ServiceCommand, ServiceTest, ServiceWorkflow, ServicePublication } from "./types";
import type { CareData, CareResult, CarePlan, DoseEvent } from "@/lib/patient-care/types";
import { dateInArmenia } from "@/lib/patient/validation";
export const demoPreparation: Record<Locale, string> = {
  en: "Preparation has not been confirmed by a provider. Do not fast or change medicines based on this demonstration.",
  hy: "Նախապատրաստումը դեռ չի հաստատվել բուժծառայություն մատուցողի կողմից։ Այս ցուցադրության հիման վրա մի պահեք ծոմ և մի փոխեք դեղերի ընդունումը։",
  ru: "Подготовка ещё не подтверждена медицинской организацией. Не голодайте и не меняйте приём лекарств на основании этой демонстрации.",
};
const short = z.string().trim().max(120);
const ids = z.array(z.string().min(1).max(100)).min(1).max(40);
export const serviceCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("book"),
      testIds: ids,
      at: z.string().max(40),
      mode: z.enum(["home", "clinic"]),
      address: z.string().trim().max(240),
      replacingId: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ type: z.literal("record-provider-preparation"), bookingId: short.min(1), provider: short.min(1), instructions: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal("cancel"), bookingId: short }).strict(),
  z.object({ type: z.literal("confirm-booking"), bookingId: short, testIds: ids }).strict(),
  z.object({ type: z.literal("receive"), testIds: ids }).strict(),
  z
    .object({
      type: z.literal("consultation"),
      decision: z.enum(["required", "not-required"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("appointment"),
      at: z.string().max(40),
      mode: z.enum(["video", "clinic"]),
    })
    .strict(),
  z.object({ type: z.literal("complete-consultation") }).strict(),
  z.object({ type: z.literal("save-draft"), monitoringDecisions:z.array(z.object({requirementId:z.uuid(),decision:z.enum(["retain","supersede"])}).strict()).optional(), draft: draftSchema, evidenceRevision: z.number().int().nonnegative().optional(), reportEvidenceRevision: z.number().int().nonnegative().optional(), reportEvidenceSession: z.uuid().optional() }).strict(),
  z.object({ type: z.literal("publish"), evidenceRevision: z.number().int().nonnegative().optional(), reportEvidenceRevision: z.number().int().nonnegative().optional(), reportEvidenceSession: z.uuid().optional() }).strict(),
  z.object({ type: z.literal("add-doctor"), name: short.min(1) }).strict(),
  z.object({ type: z.literal("assign"), doctorId: short }).strict(),
  z
    .object({
      type: z.literal("doctor-status"),
      doctorId: short,
      active: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function plusDay(day: string, n: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function validSlot(at: string, now: Date) {
  requireThat(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|\+04:00)$/.test(at),
    "Choose a valid date and time.",
  );
  const date = new Date(at);
  requireThat(Number.isFinite(date.getTime()), "Choose a valid date.");
  const inputDay = at.slice(0, 10);
  requireThat(
    (at.endsWith("Z")
      ? date.toISOString().slice(0, 10)
      : dateInArmenia(date)) === inputDay,
    "Choose a valid calendar date.",
  );
  const local = new Date(date.getTime() + 4 * 3600000).toISOString();
  requireThat(
    ["09:00:00.000", "11:00:00.000", "14:00:00.000"].includes(
      local.slice(11, 23),
    ),
    "Choose an available time: 09:00, 11:00 or 14:00 Armenia time.",
  );
  requireThat(
    date.getTime() > now.getTime() &&
      dateInArmenia(date) <= plusDay(dateInArmenia(now), 90),
    "Choose a future time within 90 days.",
  );
  return date.toISOString();
}
export function createWorkflow(
  tests: ServiceTest[],
  now = new Date(),
): ServiceWorkflow {
  return {
    version: 1,
    revision: 0,
    startedAt: now.toISOString(),
    tests: structuredClone(tests),
    bookings: [],
    receivedTestIds: [],
    allResultsAt: tests.length ? null : now.toISOString(),
    doctors: [{ id: "doctor-ani", name: "Demo doctor Ani", active: true }],
    assignedDoctorId: "doctor-ani",
    consultation: "undecided",
    appointment: null,
    draft: {
      explanation: "Review draft.",
      instructions:
        "Add the approved care instructions.",
      followUp: "Add follow-up arrangements.",
      medicationName: "",
      medicationDose: "",
      medicationInstructions: "",
      medicationTimes: [],
    },
    draftSaved: false,
    publication: null,
    events: [],
  };
}
export function earliestAppointmentDay(
  s: ServiceWorkflow,
  now = new Date(),
): string | null {
  if (s.recommendationsPending) return null;
  if (!s.tests.length) return dateInArmenia(now);
  const active = s.bookings.filter((b) => bookingApplies(s,b));
  if (s.tests.some((t) => !active.some((b) => b.testIds.includes(t.id))))
    return null;
  if (!active.length)
    return s.allResultsAt ? dateInArmenia(new Date(s.allResultsAt)) : null;
  const last = active.reduce((a, b) => (a.at > b.at ? a : b)).at;
  const day = plusDay(dateInArmenia(new Date(last)), 3);
  if (!s.allResultsAt && day <= dateInArmenia(now)) return null;
  return s.allResultsAt && dateInArmenia(new Date(s.allResultsAt)) > day
    ? dateInArmenia(new Date(s.allResultsAt))
    : day;
}
export function reviewWindow(
  s: ServiceWorkflow,
): { from: string; to: string } | null {
  if (!s.allResultsAt) return null;
  let day = dateInArmenia(new Date(s.allResultsAt));
  const days: string[] = [];
  while (days.length < 2) {
    day = plusDay(day, 1);
    if (![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()))
      days.push(day);
  }
  return { from: days[0], to: days[1] };
}
export function applyServiceCommand(
  state: ServiceWorkflow,
  input: ServiceCommand,
  now = new Date(),
  actor?: {role: string; id: string},
): ServiceWorkflow {
  const parsed = serviceCommandSchema.safeParse(input);
  requireThat(parsed.success, "Check the submitted details and text lengths.");
  const c = parsed.data;
  const s = structuredClone(state);
  const stamp = now.toISOString();
  ensureRecommendationRecords(s);
  if (
    s.appointment?.status === "scheduled" &&
    !s.allResultsAt &&
    earliestAppointmentDay(s, now) === null
  )
    s.appointment.status = "needs-reschedule";
  const invalidate = () => {
    if (s.appointment?.status === "completed") s.appointmentHistory=[...(s.appointmentHistory ?? []),structuredClone(s.appointment)];
    if (s.appointment) s.appointment.status = "needs-reschedule";
  };
  const known = (list: string[]) => {
    requireThat(
      new Set(list).size === list.length &&
        list.every((id) => s.tests.some((t) => t.id === id)),
      "Choose tests from your current plan.",
    );
  };
  switch (c.type) {
    case "book": {
      known(c.testIds);
      requireThat(
        !c.testIds.some((id) => s.receivedTestIds.includes(id)),
        "Received tests cannot be rebooked. Reset the case to start again.",
      );
      const selected = s.tests.filter((t) => c.testIds.includes(t.id));
      const homeLog =
        selected.length === 1 && selected[0].method === "home-log";
      requireThat(
        !homeLog || c.mode === "home",
        "Plan home records at home, not as a clinic visit.",
      );
      requireThat(
        selected.every((t) => t.method === "lab") || selected.length === 1,
        "Book non-laboratory checks separately.",
      );
      requireThat(
        c.mode !== "home" ||
          homeLog ||
          selected.every((t) => t.method === "lab"),
        "This check needs a clinic booking.",
      );
      requireThat(
        c.mode !== "home" || homeLog || c.address.length >= 5,
        "Enter the home collection address.",
      );
      const at = validSlot(c.at, now);
      const replacing = c.replacingId
        ? s.bookings.find(
            (b) => b.id === c.replacingId && b.status === "scheduled",
          )
        : null;
      requireThat(
        !c.replacingId || replacing,
        "This booking is no longer active.",
      );
      requireThat(
        !s.bookings.some(
          (b) =>
            b.status === "scheduled" &&
            b.id !== c.replacingId &&
            b.testIds.some((id) => c.testIds.includes(id)),
        ),
        "A selected test already has a booking.",
      );
      requireThat(
        replacing || s.bookings.filter(b => b.status === "scheduled").length < 20,
        "The booking limit is reached.",
      );
      if (replacing) {
        replacing.status = "cancelled";
        replacing.replacedBy = `booking-${s.revision + 1}`;
        invalidate();
      }
      s.bookings.push({
        id: `booking-${s.revision + 1}`,
        testIds: c.testIds,
        testSnapshots: structuredClone(selected),
        requirementIds: s.requirements!.filter(r=>r.retiredAtRevision===null && c.testIds.includes(r.test.id)).map(r=>r.requirementId),
        at,
        mode: c.mode,
        address: c.mode === "home" ? c.address : "",
        status: "scheduled",
      });
      break;
    }
    case "record-provider-preparation": {
      requireThat(actor?.role === "admin" && actor.id, "Only authenticated operations can record provider preparation.");
      const booking = s.bookings.find(b => b.id === c.bookingId);
      requireThat(booking && bookingApplies(s, booking) && !bookingHasReceipt(s, booking), "Review the current booking before recording provider preparation.");
      requireThat(!booking.testSnapshots?.some(t => t.method === "home-log"), "Home recording tasks do not have provider bookings.");
      const preparation = {provider:c.provider, instructions:c.instructions, recordedAt:stamp, recordedBy:actor.id};
      booking.providerPreparation = preparation;
      booking.preparationHistory = [...(booking.preparationHistory ?? []), preparation];
      break;
    }
    case "confirm-booking": {
      known(c.testIds);
      const old=s.bookings.find(b=>b.id===c.bookingId && b.status==='scheduled');
      requireThat(old?.review && !s.recommendationsPending, 'Review the current recommendations first.');
      validSlot(old.at,now);
      const remaining=old.testIds.filter(id=>s.requirements!.some(r=>r.retiredAtRevision===null && r.test.id===id && old.requirementIds!.includes(r.requirementId)));
      requireThat(JSON.stringify([...c.testIds].sort())===JSON.stringify([...remaining].sort()), 'Confirm all unchanged items shown for this reservation. Changed items need a new booking.');
      const id=`booking-${s.revision+1}`;
      old.status='cancelled';
      old.replacedBy=id;
      s.bookings.push({...structuredClone(old),id,testIds:[...remaining],replacedBy:undefined,providerPreparation:undefined,preparationHistory:[],review:null,status:'scheduled',reviewedAt:stamp,
        testSnapshots:old.testSnapshots!.filter(t=>remaining.includes(t.id)),
        requirementIds:s.requirements!.filter(r=>r.retiredAtRevision===null && remaining.includes(r.test.id)).map(r=>r.requirementId)});
      invalidate();
      break;
    }
    case "cancel": {
      const b = s.bookings.find(
        (b) => b.id === c.bookingId && b.status === "scheduled",
      );
      requireThat(b, "This booking is no longer active.");
      requireThat(
        !!b.review || !bookingHasReceipt(s,b),
        "Received tests cannot be cancelled.",
      );
      b.status = "cancelled";
      invalidate();
      break;
    }
    case "receive":
      known(c.testIds);
      requireThat(
        c.testIds.every((id) =>
          s.tests.find(test => test.id === id)?.method === "home-log" || s.bookings.some(
            (b) => bookingApplies(s,b,id),
          ),
        ),
        "Book provider tests before simulating receipt.",
      );
      for (const id of c.testIds) {
        const requirement=s.requirements!.find(r=>r.retiredAtRevision===null && r.test.id===id)!;
        if (!s.receiptHistory!.some(r=>r.requirementId===requirement.requirementId))
          s.receiptHistory!.push({testId:id,method:requirement.test.method,requirementId:requirement.requirementId,receivedAt:stamp});
      }
      s.receivedTestIds = [...new Set([...s.receivedTestIds, ...c.testIds])];
      if (s.tests.every((t) => s.receivedTestIds.includes(t.id)))
        s.allResultsAt ??= stamp;
      if (
        s.appointment &&
        new Date(s.appointment.at).getTime() < now.getTime() &&
        s.appointment.status !== "completed"
      )
        invalidate();
      break;
    case "consultation":
      s.consultation = c.decision;
      if (c.decision === "not-required" && s.appointment) {
        s.appointmentHistory=[...(s.appointmentHistory ?? []),structuredClone(s.appointment)];
        s.appointment=null;
      }
      break;
    case "appointment": {
      requireThat(
        s.consultation === "required",
        "First mark a consultation as required.",
      );
      const day = earliestAppointmentDay(s, now);
      requireThat(day, "Complete test scheduling or wait for delayed results.");
      const at = validSlot(c.at, now);
      requireThat(
        dateInArmenia(new Date(at)) >= day,
        "Choose a time at least three calendar days after the final test.",
      );
      if (s.appointment) s.appointmentHistory=[...(s.appointmentHistory ?? []),structuredClone(s.appointment)];
      s.appointment = { at, mode: c.mode, status: "scheduled" };
      break;
    }
    case "complete-consultation":
      requireThat(
        s.consultation === "required" &&
          s.appointment?.status === "scheduled" &&
          s.allResultsAt,
        "Receive all results and schedule the required consultation first.",
      );
      requireThat(Number.isFinite(Date.parse(s.appointment.at)) && Date.parse(s.appointment.at) <= now.getTime(), "Record completion after the scheduled appointment time.");
      s.appointment.status = "completed";
      s.appointment.completedAt = stamp;
      s.appointment.completedBy = s.assignedDoctorId;
      s.appointment.completedForContext = s.clinicalContext;
      s.appointment.completedForQuestionnaireRevision = s.questionnaireRevision;
      break;
    case "save-draft":
      requireThat(validReviewDraft(c.draft), "Save a valid review draft with approved instructions.");
      requireThat(c.evidenceRevision === (s.evidenceRevision ?? 0), "Review the changed evidence before saving.");
      requireThat(
        !c.draft.medicationName ||
          (c.draft.medicationDose && c.draft.medicationTimes.length > 0),
        "Add a dose and schedule for the example medicine, or remove its name.",
      );
      s.draft = c.draft;
      s.draftSaved = true;
      s.draftEvidenceRevision = c.evidenceRevision;
      s.draftReportEvidenceRevision = c.reportEvidenceRevision ?? 0;
      s.draftReportEvidenceSession = c.reportEvidenceSession;
      break;
    case "publish": {
      const blocker = publicationBlockers({ workflow: s, reportEvidenceRevision: c.reportEvidenceRevision ?? 0, reportEvidenceSession: c.reportEvidenceSession, now })[0];
      requireThat(!blocker, blocker?.message ?? "Review publication readiness.");
      requireThat(c.evidenceRevision === (s.evidenceRevision ?? 0), "Review the changed evidence before publication.");
      const published = publishWithContinuity(s, {
        evidenceRevision: s.evidenceRevision ?? 0,
        ...(c.reportEvidenceSession ? {localReportBaseline:{session:c.reportEvidenceSession,revision:c.reportEvidenceRevision??0}} : {}),
        workflowRevision: s.revision + 1,
        at: stamp,
        doctor: s.doctors.find((d) => d.id === s.assignedDoctorId)!.name,
        version: (s.publication?.version ?? 0) + 1,
        resultTestIds: [...s.receivedTestIds],
        resultReceipts: structuredClone(s.receiptHistory!.filter(r=>s.requirements!.some(q=>q.requirementId===r.requirementId && q.retiredAtRevision===null))),
        draft: structuredClone(s.draft),
      });
      Object.assign(s, published);
      break;
    }
    case "add-doctor":
      requireThat(
        s.doctors.length < 5,
        "This demonstration supports up to five doctors.",
      );
      s.doctors.push({
        id: `doctor-${s.revision + 1}`,
        name: c.name,
        active: true,
      });
      break;
    case "assign":
      requireThat(
        s.doctors.some((d) => d.id === c.doctorId && d.active),
        "Choose an active doctor.",
      );
      s.assignedDoctorId = c.doctorId;
      break;
    case "doctor-status": {
      const d = s.doctors.find((d) => d.id === c.doctorId);
      requireThat(d, "Choose a doctor from this demonstration.");
      requireThat(
        c.active || s.assignedDoctorId !== c.doctorId,
        "Assign another doctor before deactivating this one.",
      );
      d.active = c.active;
      break;
    }
    case "reset": {
      const fresh = createWorkflow(s.tests, now);
      fresh.revision = s.revision + 1;
      fresh.questionnaireRevision = s.questionnaireRevision;
      return fresh;
    }
  }
  if (JSON.stringify([s.tests, s.receivedTestIds, s.allResultsAt]) !== JSON.stringify([state.tests, state.receivedTestIds, state.allResultsAt])) s.evidenceRevision = (state.evidenceRevision ?? 0) + 1;
  s.revision++;
  s.events = [
    { at: stamp, text: `Fictional workflow: ${c.type}` },
    ...s.events,
  ].slice(0, 20);
  return s;
}
const fixtures: Record<string, [string, number, string]> = {
  "lipid-panel": ["LDL cholesterol", 3.1, "mmol/L"],
  "hba1c-glucose": ["HbA1c", 6, "%"],
  hba1c: ["HbA1c", 6, "%"],
  tsh: ["TSH", 1.5, "mIU/L"],
  "creatinine-egfr": ["Creatinine", 87, "µmol/L"],
  apob: ["Apolipoprotein B", 0.9, "g/L"],
  lpa: ["Lipoprotein(a)", 24, "mg/dL"],
};
export function workflowCare(
  s: ServiceWorkflow,
  events: DoseEvent[],
  ack: boolean | {planId: string; at: string | null}[],
): CareData {
  const p = s.publication;
  // Only current arrangements linked to their active booking establish provider
  // acceptance. Proposals and pending replacement terms are not effective yet.
  const acceptedArrangements = new Map(
    (s.bookingRequests ?? []).flatMap(request =>
      request.status !== "cancelled" && request.bookingId && request.currentArrangement
        ? [[request.bookingId, request.currentArrangement] as const]
        : [],
    ),
  );
  const publications = [...(s.publicationHistory ?? []), ...(p ? [p] : [])];
  const planFor = (publication: ServicePublication): CarePlan => {
    const planId=`workflow-plan-${publication.version}`;
    const order=publicationOrder({...s,publication});
    return {id:planId,clinician:publication.doctor,publishedAt:publication.at,
      explanation:publication.draft.explanation,
      acknowledged:typeof ack==='boolean' ? publication===p && ack : ack.some(a=>a.planId===planId),
      acknowledgedAt:typeof ack==='boolean' ? null : ack.find(a=>a.planId===planId)?.at ?? null,
      instructions:[publication.draft.instructions,publication.draft.followUp].filter(Boolean).join("\n\n"),
      medications:order ? [{id:order.id,planId,originatingPlanId:order.originatingPlanId,effectiveAt:order.effectiveAt,
        name:publication.draft.medicationName,dose:publication.draft.medicationDose,instructions:publication.draft.medicationInstructions,times:publication.draft.medicationTimes,
        startDate:dateInArmenia(new Date(order.effectiveAt)),endDate:order.retiredAt ? dateInArmenia(new Date(order.retiredAt)) : null,active:order.retiredAt===null}] : []};
  };
  const resultMap=new Map<string,CareResult>();
  for (const publication of publications) for (const testId of publication.resultTestIds) {
    const fixture=fixtures[testId];
    if (!fixture) continue;
    const receipt=publication.resultReceipts?.find(r=>r.testId===testId);
    // A single surviving legacy publication and its imported, undated receipt
    // describe one result. Keep its original ID/date; never merge dated new receipts.
    const legacy=publications.filter(p=>!p.resultReceipts && p.resultTestIds.includes(testId));
    const legacyId=legacy.length===1 ? `workflow-result-${legacy[0].version}-${testId}` : null;
    const id=receipt ? (receipt.receivedAt===null && legacyId ? legacyId : `workflow-result-${receipt.requirementId}`) : `workflow-result-${publication.version}-${testId}`;
    const prior=resultMap.get(id);
    resultMap.set(id,{id,testId,marker:fixture[0],value:fixture[1],unit:fixture[2],referenceLow:null,referenceHigh:null,
      collectedAt:prior?.collectedAt ?? receipt?.receivedAt ?? publication.at,
      receivedAt:prior?.receivedAt ?? receipt?.receivedAt ?? publication.at,
      source:'demo',sourceLabel:receipt?.receivedAt ? 'Fictional laboratory example · date is receipt, collection date not recorded' : 'Fictional laboratory example · date is first publication, collection date not recorded',
      reviewedAt:publication.at,reviewedBy:publication.doctor,explanation:publication.draft.explanation});
  }
  const results=[...resultMap.values()];
  return {
    tests: s.tests.map((t) => {
      const b = s.bookings.find(
        (b) => bookingApplies(s,b,t.id),
      );
      const arrangement = b ? acceptedArrangements.get(b.id) : undefined;
      return {
        id: t.id,
        title: t.title,
        preparation: b?.providerPreparation?.instructions ?? demoPreparation.en,
        status: s.receivedTestIds.includes(t.id) ? "collected" : b ? "booked" : "ordered",
        orderedBy: "Fictional clinical workflow",
        orderedAt: s.startedAt,
        dueAt: b?.at ?? null,
        location: arrangement
          ? arrangement.terms.location
          : b
          ? b.mode === "office" ? "Fictional office collection" : b.mode === "home"
            ? t.method === "home-log"
              ? "Home record completion"
              : "Fictional home collection"
            : "Fictional clinic"
          : null,
        source: "demo",
        sourceLabel: t.source,
      };
    }),
    results,
    plan: p ? planFor(p) : null,
    planHistory: (s.publicationHistory ?? []).map(planFor),
    medicationHistory: (s.medicationOrders ?? []).map(order=>({id:order.id,planId:order.originatingPlanId,originatingPlanId:order.originatingPlanId,
      effectiveAt:order.effectiveAt,name:order.name,dose:order.dose,instructions:order.instructions,times:order.times,
      startDate:dateInArmenia(new Date(order.effectiveAt)),endDate:order.retiredAt ? dateInArmenia(new Date(order.retiredAt)) : null,active:order.retiredAt===null})),
    appointments: [
      ...s.bookings.filter(b => b.status === "scheduled").map(b => ({
        id: b.id,
        clinician: acceptedArrangements.get(b.id)?.provider ?? null,
        specialty: b.testIds.map(id => b.testSnapshots?.find(t=>t.id===id)?.title ?? s.tests.find(t => t.id === id)?.title ?? id).join(", "),
        location: acceptedArrangements.get(b.id)?.terms.location ?? (b.mode !== "clinic" ? b.address || "Home recording task" : "Clinic · location not confirmed"),
        startsAt: b.at,
        // Scheduling a legacy demo task is not provider confirmation, and result
        // receipt records evidence rather than whether a visit was completed.
        status: acceptedArrangements.has(b.id) ? "confirmed" as const : "requested" as const,
        ...(acceptedArrangements.has(b.id) && !bookingApplies(s, b) ? { needsReview: true } : {}),
      })),
      ...(s.appointment
      ? [
          {
            id: "workflow-appointment",
            clinician:
              s.doctors.find((d) => d.id === s.assignedDoctorId)?.name ?? null,
            specialty: "GP consultation",
            location:
              s.appointment.mode === "video" ? "Demo video" : "Demo clinic",
            startsAt: s.appointment.at,
            status:
              s.appointment.status === "completed"
                ? "completed" as const
                : s.appointment.status === "scheduled"
                  ? "confirmed" as const
                  : "requested" as const,
          },
        ]
      : []),
    ],
    events: p ? structuredClone(events) : [],
  };
}
