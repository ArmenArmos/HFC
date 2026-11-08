import assert from "node:assert/strict";
import {
  parseSpendConfiguration,
  countSmsSegments,
  parseSpendPolicy,
  assertMessagePreflight,
} from "../lib/messaging/spend";
import { parseTwilioConfig } from "../lib/messaging/twilio";
assert.deepEqual(countSmsSegments("a".repeat(160)), {
  encoding: "gsm7",
  units: 160,
  segments: 1,
});
assert.equal(countSmsSegments("a".repeat(161)).segments, 2);
assert.equal(countSmsSegments("ա".repeat(70)).segments, 1);
assert.equal(countSmsSegments("ա".repeat(71)).segments, 2);
assert.equal(countSmsSegments("^".repeat(80)).units, 160);
assert.equal(
  countSmsSegments("a".repeat(151) + "^" + "a".repeat(151)).segments,
  3,
);
assert.equal(
  countSmsSegments("ա".repeat(65) + "😀" + "ա".repeat(65)).segments,
  3,
);
assert.throws(() => countSmsSegments(""));
assert.throws(() => countSmsSegments("\ud800"));
const now = new Date("2026-10-12T08:00:00Z");
const policy = {
  revision: 1,
  enabled: true,
  currency: "USD",
  daily_limit_micros: 1000000,
  sms_segment_ceiling_micros: 1000,
  whatsapp_message_ceiling_micros: 2000,
  max_sms_segments: 3,
  allowed_prefixes: ["+374"],
  valid_until: "2026-10-13T08:00:00Z",
};
assert.equal(parseSpendPolicy(policy, now).currency, "USD");
assert.throws(() => parseSpendPolicy({ ...policy, enabled: false }, now));
assert.throws(() =>
  parseSpendPolicy({ ...policy, valid_until: now.toISOString() }, now),
);
assert.throws(() =>
  parseSpendPolicy({ ...policy, daily_limit_micros: 1.5 }, now),
);
assert.throws(() =>
  parseSpendPolicy({ ...policy, allowed_prefixes: [""] }, now),
);
const config = parseTwilioConfig({
  accountSid: "AC" + "a".repeat(32),
  authToken: "synthetic-token-only",
  smsFrom: "+37499000001",
  whatsappFrom: "whatsapp:+37499000001",
  whatsappHyContentSid: "HX" + "b".repeat(32),
  whatsappEnContentSid: "HX" + "c".repeat(32),
  appUrl: "https://app.example.test",
  callbackUrl: "https://app.example.test/callback",
});
assert.doesNotThrow(() =>
  assertMessagePreflight(config, parseSpendPolicy(policy, now)),
);
assert.throws(() =>
  assertMessagePreflight(
    { ...config, appUrl: "https://app.example.test/" + "a".repeat(500) },
    parseSpendPolicy(policy, now),
  ),
);
assert.throws(() =>
  assertMessagePreflight(
    config,
    parseSpendPolicy({ ...policy, max_sms_segments: 1 }, now),
  ),
);
console.log(
  "Message segment counting and inactive/expired/oversized policy preflight passed",
);
assert.deepEqual(parseSpendConfiguration({ enabled: false }, now), {
  enabled: false,
});
const { revision: discardedRevision, ...configuration } = policy;
assert.equal(discardedRevision, 1);
assert.equal(parseSpendConfiguration(configuration, now).enabled, true);
assert.throws(() =>
  parseSpendConfiguration({ ...configuration, revision: 99 }, now),
);
assert.throws(() =>
  parseSpendConfiguration({ enabled: false, currency: "USD" }, now),
);

assert.doesNotThrow(() => assertMessagePreflight({...config, smsFrom:"Noreon"}, parseSpendPolicy(policy, now)));
