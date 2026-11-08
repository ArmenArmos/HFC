import assert from "node:assert/strict";
import {
  INTERVENTIONS,
  selectIntervention,
} from "../lib/zoe-synthetic/library";

const choose = (
  topic: "bp" | "medicine",
  barriers: Parameters<typeof selectIntervention>[0]["barriers"],
  excludedIds: string[] = [],
) => selectIntervention({ topic, barriers, excludedIds });
assert.equal(choose("bp", ["forgot"]).intervention?.kind, "routine");
assert.equal(choose("bp", ["anxiety"]).intervention?.kind, "human");
assert.equal(choose("medicine", ["travel"]).intervention?.kind, "reflection");
assert.equal(choose("bp", ["importance"]).intervention?.kind, "reflection");
assert.equal(
  choose("medicine", ["travel", "symptoms"]).intervention?.kind,
  "human",
);
assert.equal(choose("bp", ["forgot", "device"]).intervention?.kind, "human");
assert.equal(choose("medicine", ["time-zone"]).intervention?.kind, "human");
assert.equal(choose("medicine", []).reason, "unconfirmed");
assert.equal(choose("bp", ["unknown"]).reason, "unconfirmed");
assert.equal(choose("bp", ["unknown", "forgot"]).reason, "clarify");
assert.equal(choose("bp", ["forgot", "importance"]).reason, "clarify");
const first = choose("bp", ["forgot"]).intervention!;
const alternative = choose("bp", ["forgot"], [first.id]).intervention!;
assert.notEqual(first.id, alternative.id);
assert.equal(
  choose("bp", ["forgot"], [first.id, alternative.id]).reason,
  "exhausted",
);
assert.equal(
  new Set(INTERVENTIONS.map((i) => i.id)).size,
  INTERVENTIONS.length,
);
for (const item of INTERVENTIONS) {
  assert.equal(item.approval, "synthetic-only");
  assert.ok(item.version && item.source && item.copy.en && item.copy.hy);
}
console.log(
  "Synthetic Zoe library: four scenarios, concern precedence, ambiguity and alternatives passed",
);
