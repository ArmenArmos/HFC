import assert from "node:assert/strict";
// @ts-expect-error Node runtime exposes registerHooks; declarations target Node20.
import { registerHooks } from "node:module";
const state = {
  reads: 0,
  transports: 0,
  workers: 0,
  revision: 0,
  available: [] as string[],
  failRead: true,
  longBody: false,
};
Object.assign(globalThis, { __spendDispatch: state });
const prefix = "const s=globalThis.__spendDispatch;";
const source = (code: string) => ({
  url: "data:text/javascript," + encodeURIComponent(prefix + code),
  shortCircuit: true,
});
const hook = registerHooks({
  resolve(s: string, c: object, next: (s: string, c: object) => object) {
    if (s === "./runtime")
      return source(
        `export function messageDispatchRuntime(){return {config:{smsFrom:'+37499000000'},db:()=>({})}}`,
      );
    if (s === "./store")
      return source(
        `export async function readMessageSpendPolicy(){s.reads++;if(s.failRead)throw Error('unconfigured');return {revision:7,max_sms_segments:3}} export function messageWorkerStore(db,revision,available){s.available=available;s.revision=revision;return {}}`,
      );
    if (s === "./worker")
      return source(
        `export async function runMessageWorker(){s.workers++;return {halted:null}}`,
      );
    if (s === "./twilio")
      return source(
        `export function twilioAvailableChannels(){return ['sms']} export function buildPlanMessage(){return {body:s.longBody?'ա'.repeat(500):'Synthetic notice'}} export function createTwilioTransport(){s.transports++;return {}} export function submitPlanMessage(){throw Error('Unexpected provider call')}`,
      );
    return next(s, c);
  },
});
const previous = { ...process.env };
try {
  Object.assign(process.env, {
    NOREON_MESSAGE_DELIVERY_ENABLED: "true",
    NOREON_MESSAGE_RECOVERY_READY: "true",
    NEXT_PUBLIC_PATIENT_DEMO: "false",
  });
  const { dispatchMessages } = await import("@/lib/messaging/dispatch");
  await assert.rejects(dispatchMessages());
  assert.equal(state.transports, 0);
  assert.equal(state.workers, 0);
  state.failRead = false;
  state.longBody = true;
  await assert.rejects(dispatchMessages(), /segment limit/);
  assert.equal(state.transports, 0);
  assert.equal(state.workers, 0);
  state.longBody = false;
  await dispatchMessages();
  assert.equal(state.revision, 7);assert.deepEqual(state.available,['sms']);
  assert.equal(state.transports, 1);
  assert.equal(state.workers, 1);
} finally {
  hook.deregister();
  for (const k of Object.keys(process.env))
    if (!(k in previous)) delete process.env[k];
  Object.assign(process.env, previous);
}
console.log(
  "Dispatch validates spending policy and segment bounds before transport/worker, and pins the policy revision",
);
