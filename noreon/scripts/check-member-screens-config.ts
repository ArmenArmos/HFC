import assert from "node:assert/strict";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
for (const value of [undefined, "false", "1", "TRUE", ""]) {
  assert.equal(memberScreensPrototypeEnabled({ NOREON_MEMBER_SCREENS_PROTOTYPE: value }), false);
}
assert.equal(memberScreensPrototypeEnabled({ NOREON_MEMBER_SCREENS_PROTOTYPE: "true" }), true);
console.log("Member screens flag: only the exact server value true enables the prototype.");
