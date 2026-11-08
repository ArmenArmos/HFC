import {resolveTestModule} from './care-alert-resolve-test-module';
import assert from "node:assert/strict";
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CareAlert} from '@/lib/care-alerts/contracts';
import { readFileSync } from "node:fs";
import { AWAITING_S1_LEXICON, createUrgentMatcher, type UrgentLexicon } from "@/lib/zoe/urgent";
import { AWAITING_Q3_LAB_RULES, messageScreeningReadsText, screenFromZoe, screenLabValue, screenMessage, type CriticalLabRules } from "@/lib/care-alerts/screen";
import { runCareAlertSweep, screenLabResult, screenPendingMessages, screenZoeTurn } from "@/lib/care-alerts/server";
import { alertReason, alertResolutions, closeResolutions, careAlertInboxSchema, careAlertsEnabled, noticeLabel, resolutionLabel, sourceLabel, alertSources } from "@/lib/care-alerts/contracts";
import { runTelegramSweep } from "@/lib/telegram-runtime/dispatch";

/**
 * SYNTHETIC checks for care-team alert screening and the staff inbox guards. SQL is
 * check-care-alerts.sql. The word list and lab rules below are TEST-ONLY fixtures: they are
 * not clinical content, are never imported by the app, and exist only to exercise the path
 * that S1 (urgent words) and Q3 (critical labs) will switch on after clinical sign-off.
 */
const TEST_ONLY_LEXICON: UrgentLexicon = { version: "test-only-1", status: "signed_off", signedBy: "test-fixture-not-clinical", entries: [{ id: "t1", locale: "en", phrase: "zzsynthetic-urgent", redFlag: "RF-01" }, { id: "t2", locale: "hy", phrase: "զզփորձնական", redFlag: "RF-03" }] };
const TEST_ONLY_LAB_RULES: CriticalLabRules = { version: "test-only-q3", status: "signed_off", evaluate: v => (v.analyte === "synthetic-analyte" ? (v.value! > 100 ? "critical" : "not_critical") : null) };

// Dark by default.
assert.equal(careAlertsEnabled({}), false);
assert.equal(careAlertsEnabled({ NOREON_CARE_ALERTS_ENABLED: "1" }), false, "Only exactly true switches it on");
assert.equal(careAlertsEnabled({ NOREON_CARE_ALERTS_ENABLED: "true" }), true);

// The shipped list is empty and unsigned: screening is skipped, never "not urgent", and reads no text.
const shipped = createUrgentMatcher();
assert.equal(AWAITING_S1_LEXICON.entries.length, 0, "No urgent words ship before S1");
assert.equal(messageScreeningReadsText(shipped), false);
assert.deepEqual(screenMessage("zzsynthetic-urgent"), { outcome: "skipped", reason: "lexicon_awaiting_s1_signoff", rule: "care_alert.urgent_lexicon", ruleVersion: "s1-unsigned-0", redFlags: [] });
// A signed list without a signer, or empty, still reads nothing.
assert.equal(messageScreeningReadsText(createUrgentMatcher({ ...TEST_ONLY_LEXICON, signedBy: null })), false);
assert.equal(messageScreeningReadsText(createUrgentMatcher({ ...TEST_ONLY_LEXICON, entries: [] })), false);
// With the test-only list: escalate with red flags, or recorded.
const testMatcher = createUrgentMatcher(TEST_ONLY_LEXICON);
assert.deepEqual(screenMessage("I have ZZSYNTHETIC-URGENT and զզփորձնական", testMatcher).redFlags, ["RF-01", "RF-03"]);
assert.equal(screenMessage("I have ZZSYNTHETIC-URGENT", testMatcher).outcome, "escalate");
assert.equal(screenMessage("nothing listed", testMatcher).outcome, "recorded");

// Zoe: escalate passes through with its red flags; an escalate without one is not invented into an alert.
const zoeEscalate = testMatcher.decide("zzsynthetic-urgent");
assert.deepEqual(screenFromZoe(zoeEscalate), { outcome: "escalate", reason: "urgent_words_matched", rule: "zoe.urgent_lexicon", ruleVersion: "test-only-1", redFlags: ["RF-01"] });
assert.equal(screenFromZoe(shipped.decide("x")).outcome, "skipped");
assert.equal(screenFromZoe({ ...zoeEscalate, attributes: {} }).outcome, "skipped");

// Lab: no rules until Q3; unverified values are never screened as normal.
const value = { resultId: "lab-1", memberId: "00000000-0000-4000-8000-000000000001", analyte: "synthetic-analyte", value: 150, unit: "u", verified: true };
assert.equal(screenLabValue(value).reason, "lab_rules_awaiting_q3");
assert.equal(AWAITING_Q3_LAB_RULES.evaluate(value), null);
assert.equal(screenLabValue(value, TEST_ONLY_LAB_RULES).outcome, "escalate");
assert.equal(screenLabValue({ ...value, value: 50 }, TEST_ONLY_LAB_RULES).outcome, "recorded");
assert.equal(screenLabValue({ ...value, verified: false }, TEST_ONLY_LAB_RULES).reason, "value_not_verified");
assert.equal(screenLabValue({ ...value, value: null }, TEST_ONLY_LAB_RULES).outcome, "skipped");
assert.equal(screenLabValue({ ...value, analyte: "other" }, TEST_ONLY_LAB_RULES).reason, "no_rule_for_analyte");

// Server: pending messages are fetched without text while unsigned; every one is journaled.
{
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "care_alert_messages_pending") return [{ messageId: "00000000-0000-4000-8000-0000000000a1", memberId: value.memberId, text: null }];
    if (name === "care_alert_screen") return { ok: true, replayed: false, outcome: args.p_outcome, alertId: null };
    throw Error(name);
  };
  assert.deepEqual(await screenPendingMessages(rpc), { screened: 1, escalated: 0, failed: 0 });
  assert.equal(calls[0].args.p_with_text, false, "Unsigned list never asks for text");
  assert.equal(calls[1].args.p_outcome, "skipped");
  assert.equal(calls[1].args.p_source, "message");
}
{
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "care_alert_messages_pending") { assert.equal(args.p_with_text, true); return [{ messageId: "00000000-0000-4000-8000-0000000000a2", memberId: value.memberId, text: "zzsynthetic-urgent" }]; }
    if (name === "care_alert_screen") { assert.deepEqual(args.p_red_flags, ["RF-01"]); return { ok: true, replayed: false, outcome: "escalate", alertId: "00000000-0000-4000-8000-0000000000b1" }; }
    throw Error(name);
  };
  assert.deepEqual(await screenPendingMessages(rpc, testMatcher), { screened: 1, escalated: 1, failed: 0 });
  // A refused or failing screen is counted, never thrown.
  assert.deepEqual(await screenPendingMessages(async n => (n === "care_alert_messages_pending" ? [{ messageId: "00000000-0000-4000-8000-0000000000a3", memberId: value.memberId, text: null }] : { ok: false, code: "alerts_off" })), { screened: 0, escalated: 0, failed: 1 });
  assert.deepEqual(await screenPendingMessages(async () => { throw Error("down"); }), { screened: 0, escalated: 0, failed: 1 });
}
{
  const seen: Record<string, unknown>[] = [];
  const rpc = async (_n: string, args: Record<string, unknown>) => { seen.push(args); return { ok: true, replayed: false }; };
  await screenLabResult(rpc, value);
  await screenZoeTurn(rpc, value.memberId, "zoe-turn-1", zoeEscalate);
  assert.equal(seen[0].p_source, "lab");
  assert.equal(seen[0].p_outcome, "skipped");
  assert.equal(seen[1].p_source, "zoe");
  assert.equal(seen[1].p_outcome, "escalate");
}

// Care-alert pass: questionnaire retry, then the Zoe urgent retry (Astra Z366-02), then messages; a failing retry still runs the rest.
{
  const order: string[] = [];
  const rpc = async (name: string) => {
    order.push(name);
    if (name === "care_alert_assessments_retry") return { ok: true, raised: 1, failed: 0 };
    if (name === "care_alert_zoe_urgent_retry") return { ok: true, raised: 2, failed: 0 };
    if (name === "bp_check_retry") return { ok: true, raised: 0, failed: 0 };
    if (name === "care_alert_bp_flags_retry") return { ok: true, raised: 1, failed: 0 };
    if (name === "zoe_bp_merge_retry") return {ok:true,raised:0,merged:2,failed:0};
    if (name === "care_alert_escalate_due") return { ok: true, raised: 3, failed: 0 };
    if (name === "care_alert_messages_pending") return [];
    throw Error(name);
  };
  assert.deepEqual(await runCareAlertSweep(rpc), { screened: 4, escalated: 4, failed: 0 });
  assert.deepEqual(order, ["care_alert_assessments_retry", "care_alert_zoe_urgent_retry", "bp_check_retry", "care_alert_bp_flags_retry", "zoe_bp_merge_retry", "care_alert_escalate_due", "care_alert_messages_pending"]);
  const seen: string[] = [];
  const r = await runCareAlertSweep(async name => { seen.push(name); if (name.endsWith("_retry")) throw Error("down"); return []; });
  // The five retries throw, and the escalation call returns nothing it can read: six failures, none silent.
  assert.deepEqual(r, { screened: 0, escalated: 0, failed: 6 });
  assert.deepEqual(seen, ["care_alert_assessments_retry", "care_alert_zoe_urgent_retry", "bp_check_retry", "care_alert_bp_flags_retry", "zoe_bp_merge_retry", "care_alert_escalate_due", "care_alert_messages_pending"]);
  // A failing escalation call is counted, and the sweep goes on to screen messages.
  const failEsc = await runCareAlertSweep(async name => { if (name === "care_alert_escalate_due") throw Error("down"); if (name === "care_alert_messages_pending") return []; return { ok: true, raised: 0, failed: 0 }; });
  assert.deepEqual(failEsc, { screened: 0, escalated: 0, failed: 1 });
}

// Sweep hook: screening runs after the inbox and before sends; a failure never stops the sweep; absent means not called.
{
  const order: string[] = [];
  const rpc = async (name: string) => {
    order.push(name);
    if (name === "channel_inbox_next") return [];
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    throw Error(name);
  };
  const report = await runTelegramSweep({ rpc, adapter: null, accountRef: "x", screenMessages: async () => { order.push("screen"); throw Error("down"); } });
  assert.deepEqual(order, ["channel_inbox_next", "screen", "delivery_reconcile_stale"]);
  assert.deepEqual(report.screening, { screened: 0, escalated: 0, failed: 1 });
  const off = await runTelegramSweep({ rpc, adapter: null, accountRef: "x" });
  assert.equal(off.screening, undefined);
}

// Copy: every source and resolution has EN and HY; reasons read as words; notices never claim "read".
for (const s of alertSources) for (const l of ["en", "hy"] as const) assert.ok(sourceLabel(s, l));
// Closing is a person's act with a reason: 'duplicate' is history only and never offered (Armen's audit S0-2).
assert.ok(!(closeResolutions as readonly string[]).includes("duplicate") && closeResolutions.every(r => (alertResolutions as readonly string[]).includes(r)));
for (const r of alertResolutions) for (const l of ["en", "hy"] as const) assert.ok(resolutionLabel(r, l));
assert.match(alertReason({ reason: "questionnaire_red_flag", redFlags: ["RF-03"] }, "en"), /Red flag RF-03/);
assert.equal(alertReason({ reason: "some_new_code", redFlags: [] }, "en"), "some new code");
// FB-01: the three Zoe urgent reasons read as words in EN and HY, within the copy rules.
for (const reason of ["zoe_urgent_route", "zoe_refused_103", "zoe_self_harm"]) for (const l of ["en", "hy"] as const) {
  const text = alertReason({ reason, redFlags: [] }, l);
  assert.ok(!text.includes("_") && !/—|!|patient|user/i.test(text), `zoe reason copy: ${text}`);
}
assert.match(alertReason({ reason: "zoe_urgent_route", redFlags: ["RF-01"] }, "en"), /103 \(RF-01\)/);
for (const st of ["queued", "held", "sending", "accepted_by_provider", "definitely_failed", "unknown"]) for (const l of ["en", "hy"] as const) assert.doesNotMatch(noticeLabel(st, l), /read/i);
assert.throws(() => careAlertInboxSchema.parse({ ok: true, asOf: "", role: "nurse", alerts: [] }), "Nurses are not an inbox role");
for (const text of [...alertSources.map(s => sourceLabel(s, "en")), ...alertResolutions.map(r => resolutionLabel(r, "en"))]) assert.ok(!/—|!|patient|user/i.test(text), `copy rules: ${text}`);

// Page and actions: flag first, then staff, then the read or write; no member message text.
const page = readFileSync("app/staff/real/(review)/alerts/page.tsx", "utf8");
const flag = page.indexOf("if(!careAlertsEnabled())notFound()"), staff = page.indexOf("await requireRealStaff()"), read = page.indexOf("client.rpc(");
assert.ok(flag > 0 && staff > flag && read > staff, "page: flag, then staff, then the read");
assert.ok(!/—/.test(page), "page: no em dashes");
const nurseView = page.slice(page.indexOf("async function NurseAlertsView"), page.indexOf("/** Care-team alerts for admins"));
assert.ok(page.indexOf("identity.role==='nurse')return <NurseAlertsView") > staff && page.indexOf("identity.role==='nurse')return <NurseAlertsView") < read, "page: the nurse view is chosen after the staff check and never reaches the doctor inbox read");
assert.ok(nurseView.includes("readNurseAlerts(") && !/acknowledgeCareAlert|resolveCareAlert|<form/.test(nurseView), "page: the nurse view delegates scoped commands to shared controls");
const actions = readFileSync("lib/care-alerts/actions.ts", "utf8");
assert.ok(actions.indexOf("if(!careAlertsEnabled())") < actions.indexOf("await requireRealStaff()"), "actions: flag before staff");
assert.ok(!readFileSync("lib/care-alerts/screen.ts", "utf8").includes("test-only"), "Test-only lists never ship in the app");
console.log("PASS care alerts: dark flag, unsigned list reads no text, test-only list escalates, lab awaits Q3, Zoe passthrough, sweep hook, copy, page guards");

// Mount the actual legacy rows with controlled navigation and actions. No page IO runs.
const {default:vm}=await import('node:vm'),{default:ts}=await import('typescript');
const jsx=await import('react/jsx-runtime');
const {AlertCardLines}=await import('@/components/staff/alert-card');
const {alertCardFields}=await import('@/lib/staff/alert-card');
const {st}=await import('@/lib/staff/staff-locale-copy');
const contracts=await import('@/lib/care-alerts/contracts');
const inbox=await import('@/lib/doctor-inbox/contracts');
const {stamp}=await import('@/components/patient-care/common');
const {RED_FLAG_REGISTRY}=await import('@/lib/clinical/rules/rules');
const fixture:CareAlert={id:'11111111-1111-4111-8111-111111111111',memberId:'22222222-2222-4222-8222-222222222222',memberName:'Fictional member',source:'questionnaire',priority:'urgent',reason:'questionnaire_red_flag',redFlags:['RF-01'],state:'open',stateSeq:3,occurrences:2,createdAt:'2026-11-04T05:06:00Z',lastSeenAt:'2026-11-04T07:08:00Z',doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]};
let chatOn=false,viewer='doctor';
for(const [file,name] of [['today','AlertRow'],['alerts','AlertCard']] as const){
 const exports:Record<string,unknown>={};
 const source=readFileSync(`app/staff/real/(review)/${file}/page.tsx`,'utf8')+`\nexport {${name}};`;
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:(path:string)=>{
  if(path==='react/jsx-runtime')return jsx;
  if(path==='@/components/staff/care-alert-resolve')return resolveTestModule();
  if(path==='next/link')return {default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props,children)};
  if(path==='@/components/staff/alert-card')return {AlertCardLines};
  if(path==='@/lib/staff/alert-card')return {alertCardFields};
  if(path==='@/lib/care-alerts/contracts')return {...contracts,careAlertsEnabled:()=>true};
  if(path==='@/lib/staff-zoe/workspace-config')return {doctorChatV2Enabled:()=>chatOn};
  if(path==='@/lib/staff/staff-locale')return {staffLocale:async()=>'en'};
  if(path==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>({identity:{role:viewer,name:'Doctor Example'},client:{rpc:async()=>({data:{ok:true,role:viewer,asOf:fixture.createdAt,alerts:[fixture]},error:null})}})};
  if(path==='@/lib/doctor-inbox/urgent-inbox-server')return {readDoctorUrgentInbox:async()=>({alerts:[{memberId:fixture.memberId,alert:fixture}],windows:[],windowsTotal:0,capped:false,unavailable:[],asOf:fixture.createdAt})};
  if(path==='@/lib/doctor-inbox/urgent-windows')return {urgentCount:()=>1};
  if(path==='@/lib/doctor-inbox/contracts')return inbox;
  if(path==='@/lib/staff/staff-locale-copy')return {st};
  if(path==='@/components/patient-care/common')return {stamp,CareSection:({children}:{children:React.ReactNode})=>React.createElement('section',null,children),Status:({children}:{children:React.ReactNode})=>React.createElement('span',null,children)};
  if(path==='@/components/ui/select-field')return {SelectField:()=>React.createElement('select',{name:'resolution'})};
  if(path==='@/lib/care-alerts/actions')return {acknowledgeCareAlert:()=>{},resolveCareAlert:()=>{}};
  return {};
 }});
 if(file==='alerts'){
  const Alerts=exports.default as (props:{searchParams:Promise<{view?:string}>})=>Promise<React.ReactElement>;
  for(const enabled of [false,true])for(const role of ['doctor','admin'])for(const view of ['live','resolved']){
   chatOn=enabled;viewer=role;
   const markup=renderToStaticMarkup(await Alerts({searchParams:Promise.resolve({view})}));
   assert.equal(markup.includes(`/staff/real/doctor-chat-v2/patient/${fixture.memberId}`),enabled&&role==='doctor',`${role}, chat ${enabled}, ${view}: classic alert chat link`);
  }
 }
 const Row=exports[name] as React.ComponentType<Record<string,unknown>>;
 for(const locale of ['en','hy','ru'] as const){
  for(const reason of [...contracts.alertReasons,'future_reason_code']){
   const a={...fixture,reason,redFlags:RED_FLAG_REGISTRY.map(r=>r.id),lastReason:'zoe.unknown_reason'};
   const item={id:`care_alert:${a.id}`,kind:'care_alert',alert:a,memberId:a.memberId,memberName:a.memberName,sources:[{type:'rule',rule:'RF-01',ref:'care_alert.internal'}]};
   const html=renderToStaticMarkup(React.createElement(Row,{a,item,l:locale,actions:true}));
   const visible=html.replace(/<[^>]*>/g,'');
   assert.equal((html.match(/data-alert-field=/g)??[]).length,5,`${file}/${locale}: five fields`);
   assert.doesNotMatch(visible,/RF-\d|_|care_alert|NRN|zoe\.|rule/i,`${file}/${locale}/${reason}: no technical labels`);
   assert.ok(visible.includes(renderToStaticMarkup(React.createElement(React.Fragment,null,alertCardFields(a,locale).symptom))));
   assert.ok(visible.includes(renderToStaticMarkup(React.createElement(React.Fragment,null,alertCardFields(a,locale).next))));
   assert.ok(html.includes(`/staff/real/members/${a.memberId}`),'Keep the member link');
   assert.ok(html.includes('name="alertId"')&&html.includes('name="seq"'),'Keep action bindings');
   assert.ok(visible.includes(st(locale,'Acknowledge','Հաստատել','Подтвердить')));
   assert.ok(visible.includes(st(locale,'Resolve','Լուծել','Закрыть')));
  }
 }
}
console.log('PASS legacy Today and Alerts rows: mounted copy in en/hy/ru, all reasons and flags, five fields, no codes, original member links and action bindings');
