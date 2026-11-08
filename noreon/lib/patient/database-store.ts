import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Answers } from "@/lib/clinical/types";
import type { PatientState } from "./types";
import { parseLocale } from "@/lib/locale";
import type { PatientStore } from "./service";
import { CONSENT_VERSION } from "./service";
import { persistMeasurement } from "./measurement-store";

export function createDatabasePatientStore(
  readClient: () => Promise<SupabaseClient<Database>>,
  writeClient: () => SupabaseClient<Database>,
): PatientStore {
  return {
    async read(userId, options): Promise<PatientState> {
      const client = await readClient();
      const assessment = () => client.from("patient_assessments").select("*").maybeSingle();
      const profile = () => client.from("profiles").select("*").single();
      const consent = () => client.from("patient_consents").select("version")
        .eq("version", CONSENT_VERSION).maybeSingle();
      const snapshot = async () => {
        if (!options?.coherentProfile)
          return Promise.all([profile(), assessment(), consent()]);
        // Profile writes atomically advance the assessment revision. Bracket the
        // form values with that version so independently timed REST reads cannot
        // pair an old demographic value with a newer compare-and-swap token.
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = await assessment();
          if (before.error) throw new Error("Patient storage unavailable");
          const [p, c] = await Promise.all([profile(), consent()]);
          const after = await assessment();
          if (p.error || c.error || after.error)
            throw new Error("Patient storage unavailable");
          if (before.data?.id === after.data?.id &&
              before.data?.revision === after.data?.revision)
            return [p, after, c] as const;
        }
        throw new Error("Patient storage unavailable");
      };
      const [p, a, c] = await snapshot();
      if (p.error || a.error || c.error)
        throw new Error("Patient storage unavailable");
      const patientProfile =
        p.data.birth_date && p.data.biological_sex && p.data.display_name
          ? {
              userId,
              name: p.data.display_name,
              birthDate: p.data.birth_date,
              biologicalSex: p.data.biological_sex as "male" | "female",
              locale: parseLocale(p.data.ui_locale ?? p.data.locale, "hy"),
            }
          : null;
      return {
        profile: patientProfile,
        consentAccepted: Boolean(c.data),
        assessment: a.data
          ? {
              id: a.data.id,
              revision: a.data.revision,
              assessmentDate: a.data.assessment_date,
              answers: a.data.answers as unknown as Answers,
              completedAt: a.data.completed_at,
              urgentRule: a.data.urgent_rule,
            }
          : null,
      };
    },
    async profile(userId, input, answers, expectedRevision, urgentRule) {
      const { data, error } = await writeClient().rpc("save_patient_profile", {
        p_user_id: userId,
        p_name: input.name,
        p_birth_date: input.birthDate,
        p_sex: input.biologicalSex,
        p_locale: input.locale,
        p_consent_version: CONSENT_VERSION,
        p_answers: answers as never,
        p_expected_revision: expectedRevision,
        p_urgent_rule: urgentRule as never,
      });
      if (error) throw new Error("Patient save failed");
      return data;
    },
    async assessment(userId, revision, answers, complete, urgentRule, sources) {
      const args = {
        p_user_id: userId,
        p_expected_revision: revision,
        p_answers: answers as never,
        p_complete: complete,
        p_urgent_rule: urgentRule as never,
      };
      const { data, error } = sources
        // Not yet in the generated types: lib/db/types.ts needs a database to regenerate.
        ? await (writeClient() as unknown as { rpc(name: string, args: unknown): PromiseLike<{ data: number; error: unknown }> }).rpc("save_patient_assessment_sourced", { ...args, p_sources: sources })
        : await writeClient().rpc("save_patient_assessment", args);
      if (error) throw new Error("Patient save failed");
      return data as number;
    },
    async measurement(userId, input) {
      await persistMeasurement(writeClient(), userId, input);
    },
  };
}
