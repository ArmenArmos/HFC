import type { FieldValue } from "@/lib/clinical/types";
import type { SaveResult } from "@/lib/patient/types";
export async function saveQuestionnaireAnswers(input: {
  expectedAssessmentId: string;
  expectedRevision: number;
  entries: Array<{fieldId:string;value:FieldValue|null}>;
  expectedAnswers?: string;
}): Promise<SaveResult | null> {
  const response = await fetch("/patient/answers", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"same-origin",
    cache:"no-store",
    body:JSON.stringify(input),
  });
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  if (response.ok && result.ok === true && "revision" in result && Number.isSafeInteger(result.revision) && typeof result.revision === "number" && result.revision >= 0)
    return result as SaveResult;
  if (result.ok === false && "reason" in result && ["invalid","conflict","unavailable"].includes(String(result.reason)))
    return result as SaveResult;
  return null;
}
