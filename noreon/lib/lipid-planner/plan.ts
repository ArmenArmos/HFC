import { runRules, type EngineResult } from "./engine";
import { lipidFacts, type GoalCheck, type LipidRecordFacts, type LipidTest } from "./facts";
import { LIPID_RULES, type LipidOpenId } from "./rules";
import type { LipidPlannerOn } from "./schema";
import type { LipidSourceId } from "./sources";

export type LipidPlan = EngineResult<LipidTest, LipidSourceId, LipidOpenId> & {
  goalCheck: GoalCheck;
  adherence: LipidRecordFacts["adherence"];
  reports: LipidRecordFacts["reports"];
  doctorNextTestOn: string | null;
};

/** The doctor's card for one member, worked out on each read and stored nowhere. Null when the LDL record is off. */
export function buildLipidPlan(read: LipidPlannerOn): LipidPlan | null {
  const facts = lipidFacts(read);
  if (!facts) return null;
  const { goalCheck, adherence, reports, doctorNextTestOn } = facts;
  return { ...runRules(LIPID_RULES, facts), goalCheck, adherence, reports, doctorNextTestOn };
}
