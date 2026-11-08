import assert from "node:assert/strict";
import {
  signDemoBody,
  verifyDemoBody,
  boundedBody,
} from "@/lib/reports/demo-bridge";
const secret = "test-only-secret".repeat(4),
  time = String(Date.now()),
  body = JSON.stringify({ requestId: "one", payload: "fictional" });
const signature = signDemoBody(secret, time, body);
assert(verifyDemoBody(secret, time, body, signature));
assert(!verifyDemoBody(secret, time, body + " ", signature));
assert(!verifyDemoBody(secret, time, body, signature, Number(time) + 61000));
assert(!verifyDemoBody(secret, time, body, "invalid"));
assert(!verifyDemoBody("short", time, body, signature));
const request = (value: string) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: value,
  });
assert.equal(await boundedBody(request(body), 1000), body);
await assert.rejects(() => boundedBody(request(body), 5));
await assert.rejects(
  () =>
    boundedBody(new Request("https://example.test", { method: "POST", body })),
  /invalid_request/,
);
console.log(
  "Demo bridge: signature tampering, expiry, weak key, malformed signature and body limits passed.",
);
