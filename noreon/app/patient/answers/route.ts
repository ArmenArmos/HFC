import { withRouteLogging } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { enrolAfterQuestionnaire } from "@/lib/patient-care/enrolment";
import { createPatientAnswerHandler } from "@/lib/patient/answer-http";
import { patientIdentityForSave } from "@/lib/patient/auth";
import { patientStore } from "@/lib/patient/repository";
import { anamnesisSource } from "@/lib/patient/zoe-app-v3";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Khikar 18 Oct: the questionnaire saves here, so finishing it (last answer) or a red flag enrols
// the member for the care team. after(): the save response, which the urgent screen waits for, is
// never delayed by the enrolment (Fable #277 F1/F5).
const save = createPatientAnswerHandler({user:patientIdentityForSave,store:patientStore,
  answerSource:anamnesisSource,
  onEnrol:(reason) => after(() => enrolAfterQuestionnaire(reason))});
export const POST = withRouteLogging(async function POST(request: Request) {
  const response = await save(request);
  if (response.ok) {
    revalidatePath("/patient/dashboard");
    revalidatePath("/patient/questions");
  }
  return response;
});
