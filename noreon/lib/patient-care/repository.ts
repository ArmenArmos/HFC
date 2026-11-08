import { withCurrentPublishedReview } from "./published-review";
import { currentPatientPublishedReview } from "./current-published-review";
import "server-only";
import { getReminderPreferences } from "./reminder-repository";
import { readAllPages } from "./pagination";
import { createClient } from "@/lib/supabase/server";
import { requireRegistered, getMeasurements } from "@/lib/patient/repository";
import type {
  CareData,
  CareSource,
  CareTest,
  CareAppointment,
  DoseEvent,
} from "./types";
export async function getCareData(): Promise<CareData> {
  const client = await createClient();
  const [tests, results, plans, medications, appointments, events, doseHistory, planMedications, historicalPlans, publishedReviews] =
    await Promise.all([
      client
        .from("patient_care_tests")
        .select("*")
        .order("ordered_at", { ascending: false }),
      readAllPages((from, to) =>
        client
          .from("patient_care_results")
          .select("*")
          .order("collected_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      ),
      client
        .from("patient_care_plans")
        .select("*")
        .eq("active", true)
        .lte("published_at", new Date().toISOString())
        .maybeSingle(),
      client.from("patient_care_medications").select("*"),
      client
        .from("patient_care_appointments")
        .select("*")
        .order("starts_at", { ascending: true }),
      readAllPages((from,to) => client.from("patient_dose_events").select("*")
        .gte("due_at",new Date(Date.now()-30*86400000).toISOString()).order("due_at",{ascending:false}).order("medication_id").range(from,to)),
      readAllPages((from,to) => client.from("patient_dose_event_history").select("*")
        .gte("due_at",new Date(Date.now()-30*86400000).toISOString()).order("due_at",{ascending:false}).order("medication_id").order("revision").range(from,to)),
      client.from("patient_care_plan_medications").select("*"),
      readAllPages((from,to)=>client.from("patient_care_plans").select("*").lte("published_at",new Date().toISOString()).order("published_at").order("id").range(from,to)),
      currentPatientPublishedReview(client),
    ]);
  if ([tests, plans, medications, appointments, planMedications].some((r) => r.error))
    throw new Error("Care records unavailable");
  const plan = plans.data;

  const medicationsFor=(planId:string)=>(medications.data??[]).filter(m=>m.plan_id===planId||planMedications.data?.some(link=>link.plan_id===planId&&link.medication_id===m.id)).map(m=>({id:m.id,planId,originatingPlanId:m.plan_id,effectiveAt:m.effective_at??undefined,name:m.name,dose:m.dose,instructions:m.instructions,times:m.times.map(t=>t.slice(0,5)),startDate:m.start_date,endDate:m.end_date,active:m.active}));
  const currentMedicineIds=new Set(plan?medicationsFor(plan.id).map(m=>m.id):[]);
  return {
    tests: (tests.data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      preparation: r.preparation,
      status: r.status as CareTest["status"],
      orderedBy: r.ordered_by,
      orderedAt: r.ordered_at,
      dueAt: r.due_at,
      location: r.location,
      source: r.source as CareSource,
      sourceLabel: r.source_label,
    })),
    results: results
      .filter((r) => r.reviewed_at && r.reviewed_by)
      .map((r) => ({
        id: r.id,
        testId: r.test_id,
        marker: r.marker,
        value: r.value,
        unit: r.unit,
        referenceText: r.reference_text,
        referenceLow: r.reference_low,
        referenceHigh: r.reference_high,
        collectedAt: r.collected_at,
        receivedAt: r.received_at,
        source: r.source as CareSource,
        sourceLabel: r.source_label,
        reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by,
        explanation: r.explanation,
      })),
    plan: plan
      ? withCurrentPublishedReview({
          id: plan.id,
          clinician: plan.clinician,
          publishedAt: plan.published_at,
          instructions: plan.instructions,
          acknowledgedAt: plan.acknowledged_at,
          medications: medicationsFor(plan.id),
        }, publishedReviews)
      : null,
    appointments: (appointments.data ?? []).map((r) => ({
      id: r.id,
      clinician: r.clinician,
      specialty: r.specialty,
      location: r.location,
      startsAt: r.starts_at,
      status: r.status as CareAppointment["status"],
    })),
    planHistory: historicalPlans.filter(p=>p.id!==plan?.id).map(p=>({id:p.id,clinician:p.clinician,publishedAt:p.published_at,instructions:p.instructions,acknowledgedAt:p.acknowledged_at,medications:medicationsFor(p.id)})),
    medicationHistory: (medications.data??[]).map(m=>({id:m.id,planId:m.plan_id,originatingPlanId:m.plan_id,effectiveAt:m.effective_at??undefined,name:m.name,dose:m.dose,instructions:m.instructions,times:m.times.map(t=>t.slice(0,5)),startDate:m.start_date,endDate:m.end_date,active:currentMedicineIds.has(m.id)})),
    doseHistory: doseHistory.map(r=>({planId:r.plan_id,medicationId:r.medication_id,dueAt:r.due_at,status:r.status as DoseEvent["status"],recordedAt:r.recorded_at,revision:r.revision,kind:r.kind as "baseline"|"report"})),
    events: events.map((r) => ({
      revision: r.revision,
      planId: medications.data?.find(m=>m.id===r.medication_id)?.plan_id??null,
      medicationId: r.medication_id,
      dueAt: r.due_at,
      status: r.status as DoseEvent["status"],
      recordedAt: r.recorded_at,
    })),
  };
}
export async function carePageData() {
  const registered = await requireRegistered();
  const [care, measurements, reminders] = await Promise.all([
    getCareData(),
    getMeasurements(),
    getReminderPreferences(),
  ]);
  return {
    ...registered,
    care,
    measurements,
    reminders,
    stage: care.plan ? "treatment" as const : "profile" as const,
    chartMeasurements: measurements,
  };
}
