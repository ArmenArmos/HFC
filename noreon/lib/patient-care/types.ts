import type { Locale } from "@/lib/locale";
export type CareSource = "clinic" | "laboratory" | "member" | "demo";
export type CareTest = {
  id: string;
  title: string;
  preparation: string | null;
  status: "ordered" | "booked" | "collected" | "cancelled";
  orderedBy: string;
  orderedAt: string;
  dueAt: string | null;
  location: string | null;
  source: CareSource;
  sourceLabel: string;
};
export type CareResult = {
  id: string;
  testId: string | null;
  marker: string;
  value: number;
  unit: string;
  referenceText?: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  collectedAt: string;
  receivedAt: string;
  source: CareSource;
  sourceLabel: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  explanation: string | null;
};
export type Medication = {
  effectiveAt?: string;
  originatingPlanId?: string;
  id: string;
  planId: string;
  name: string;
  dose: string;
  instructions: string;
  times: string[];
  startDate: string;
  endDate: string | null;
  active: boolean;
};
export type CarePlan = {
  publishedReview?: { explanation: string; instructions: string; followUp: string };
  explanation?: string;
  id: string;
  clinician: string;
  publishedAt: string;
  instructions: string;
  acknowledgedAt: string | null;
  acknowledged?: boolean;
  medications: Medication[];
};
export type CareAppointment = {
  /** The provider arrangement remains accepted, but current test requirements need review. */
  needsReview?: boolean;
  id: string;
  clinician: string | null;
  specialty: string;
  location: string | null;
  startsAt: string | null;
  status: "requested" | "confirmed" | "completed" | "cancelled";
};
export type DoseEvent = {
  revision?: number;
  planId?: string | null;
  medicationId: string;
  dueAt: string;
  status: "taken" | "skipped";
  recordedAt: string;
};
export type CareData = {
  /** Shared corrections must target the current published order; native history retains its original plan. */
  doseCorrectionScope?: "current-plan";
  monitoring?:import("@/lib/service-workflow/follow-up").MemberMonitoring;
  pendingReview?: {openedAt:string} | null;
  planHistory?: CarePlan[];
  medicationHistory?: Medication[];
  tests: CareTest[];
  results: CareResult[];
  plan: CarePlan | null;
  appointments: CareAppointment[];
  events: DoseEvent[];
  doseHistory?: (DoseEvent & {revision:number;kind:"baseline"|"report"})[];
};
export type DueDose = {
  revision?: number;
  medication: Medication;
  dueAt: string;
  status: "upcoming" | "due" | "taken" | "skipped";
};
export type CareActionKind =
  | "consultation"
  | "urgent"
  | "appointment"
  | "medication"
  | "tests"
  | "results"
  | "plan"
  | "questions"
  | "measurement"
  | "waiting";
export type CareAction = {
  id: string;
  kind: CareActionKind;
  title: Record<Locale, string>;
  detail: Record<Locale, string>;
  href: string;
  button: Record<Locale, string>;
  dueAt?: string;
  dose?: DueDose;
};
export type DemoCareStage =
  | "profile"
  | "tests"
  | "waiting"
  | "review"
  | "treatment";
export const EMPTY_CARE: CareData = {
  tests: [],
  results: [],
  plan: null,
  appointments: [],
  events: [],
};
