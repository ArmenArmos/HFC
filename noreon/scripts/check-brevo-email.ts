import assert from "node:assert/strict";
import { sendDoctorInvitation, sendStaffPasswordRecovery } from "@/lib/messaging/brevo-email";
const config = { apiKey: "local-email-test-key-only", sender: "info@example.invalid", origin: "https://doctors.noreon.health" };
const invitation = { name: '<script>alert("name")</script>', url: "https://doctors.noreon.health/staff/real/invite#token=fixture-token&invitation=fixture", email: "doctor@example.invalid" };
let calls = 0;
const accepted: typeof fetch = async (url, init) => {
  calls++;
  assert.equal(url, "https://api.brevo.com/v3/smtp/email");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.to[0].email, invitation.email);
  assert.equal(body.sender.email, config.sender);
  assert.ok(!body.htmlContent.includes('<script>'));
  assert.ok(body.htmlContent.includes('&lt;script&gt;'));
  assert.ok(!body.textContent.toLowerCase().includes('your password is'));
  return Response.json({ messageId: "fixture-provider-receipt" }, { status: 201 });
};
assert.equal((await sendDoctorInvitation(config, invitation, accepted)).status, "accepted");
assert.equal(calls, 1);
assert.equal((await sendDoctorInvitation(config, invitation, async () => Response.json({}, { status: 400 }))).status, "failed");
assert.equal((await sendDoctorInvitation(config, invitation, async () => Response.json({}, { status: 503 }))).status, "unknown");
assert.equal((await sendDoctorInvitation(config, invitation, async () => Response.json({}))).status, "unknown");
assert.equal((await sendDoctorInvitation(config, invitation, async () => { throw Error('timeout'); })).status, "unknown");
await assert.rejects(sendDoctorInvitation(config, { ...invitation, url: "https://evil.invalid/staff/real/invite" }, accepted));
await assert.rejects(sendDoctorInvitation(config, { ...invitation, url: "https://doctors.noreon.health/staff/real/invite?token=leaks" }, accepted));
assert.equal(calls, 1, "Unsafe destinations are rejected before transport");
console.log("Brevo invitation payload, delivery ambiguity and fixed-origin checks passed");

let nursePayload: { subject: string; htmlContent: string; textContent: string } | undefined;
await sendDoctorInvitation(config, { ...invitation, role: "nurse" }, async (_url, init) => {
  nursePayload = JSON.parse(String(init?.body));
  return Response.json({ messageId: "nurse-fixture" }, { status: 201 });
});
assert.ok(nursePayload);
assert.equal(nursePayload.subject, "Set up your Noreon nurse account");
assert.ok(nursePayload.htmlContent.includes("as a nurse"));
assert.ok(nursePayload.textContent.includes("your nurse account"));
assert.ok(!nursePayload.htmlContent.includes("as a doctor"));

const recovery = {...invitation, role: 'nurse', url: 'https://doctors.noreon.health/staff/real/recover#token=fixture-token&operation=fixture&generation=1&type=recovery'};
assert.equal((await sendStaffPasswordRecovery(config, recovery, async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  assert.equal(body.subject, 'Reset your Noreon password');
  assert.match(body.textContent, /administrator requested password recovery/);
  assert.match(body.textContent, /nurse account/);
  assert.match(body.htmlContent, /&lt;script&gt;/);
  assert.doesNotMatch(body.htmlContent, /<script>/);
  return Response.json({messageId: 'local-recovery-reference'});
})).status, 'accepted');
await assert.rejects(sendStaffPasswordRecovery(config, invitation, accepted));
await assert.rejects(sendStaffPasswordRecovery(config, {...recovery, url: recovery.url.replace('/recover#', '/recover?token=leak#')}, accepted));
await assert.rejects(sendDoctorInvitation(config, recovery, accepted));
console.log('Dedicated staff recovery email copy, escaping and destination separation passed.');
