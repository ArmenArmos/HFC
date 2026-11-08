/** The blood pressure flow, with the real rules, real commands and the real word matcher. No database or network. */
import assert from "node:assert/strict";
import {runCareAlertSweep} from "@/lib/care-alerts/server";
import { readFileSync } from "node:fs";
import { ZONE_RULES_V1 as rules } from "@/lib/clinical/zones/config-v1";
import { evaluateBp } from "@/lib/clinical/zones/evaluate";
import { answersOn, chipState, contextStrip, decide, episodeSymptoms, FLAG_RED_FLAG, flagItem, memberTasks, nextQuestion, openFlags, RED_FLAG_QUESTIONS, redOutcome, sentToFrom, symptomsFrom, UNASKED, type BpFlow } from "@/lib/zoe-chat-actions/bp-flow";
import { answerRedFlag, runBpFlow, retryRedMessages, type FlagPorts, type FlowPorts } from "@/lib/zoe-chat-actions/bp-flow-server";
import { logBp, logRepeat, type CardPorts } from "@/lib/zoe-chat-actions/commands";
import type { MemberActor } from "@/lib/zoe-chat-actions/actor";
import { allCopy, BP, FLAG_MESSAGE, FLAG_QUESTION, FLOW } from "@/lib/zoe-chat-actions/copy";
import { CHIP_KINDS, FLOW_KINDS, zoeCardsSchema, cardSchema, type ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { cardTurns, dialogThread } from "@/lib/zoe-chat-actions/thread";

const member = "00000000-0000-4000-8000-00000000000a";
const V3 = { NOREON_ZOE_APP_V3: "true" };
Object.assign(process.env, V3);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let ids = 100;

type Call = { name: string; args: Record<string, unknown> };
/** A database stand-in: it records every call and answers what the care queue and alert functions answer. */
function world({ careTeam = true, alerts = true, failQueue = "", hours = [{ weekday: 1, opens: "09:00:00", closes: "18:00:00" }] as unknown[] } = {}) {
  const calls: Call[] = [], cards: ZoeCard[] = [], readings: { id: string; submissionId:string; sbp: number; dbp: number }[] = [], tasks = new Map<string, Record<string, unknown>>();
  const state = { alerts, failQueue, readingAlert: null as null | {id:string;sentTo:"physician"|null;reason:"bp_doctor_today"|"bp_doctor_48h"}, mergeDown: false };
  const alertRefs = new Set<string>();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "zoe_bp_episode") return { ok: true, readingId: readings.at(-1)!.id, readings };
    if (name === "zoe_bp_staff_item") {
      if (state.mergeDown) throw Error("Merge unavailable");
      return {ok:true,alert:state.readingAlert};
    }
    if (name === "zoe_bp_task_raise") {
      if (state.mergeDown) throw Error("Merge unavailable");
      if (state.readingAlert) return {ok:false,code:"bp_alert",alert:state.readingAlert};
      const refs=[String(args.p_episode),...readings.flatMap(r=>[r.id,`bp:${r.submissionId}`])];
      const old=[...tasks.entries()].find(([key])=>refs.some(ref=>["yellow","orange"].some(zone=>key===`${args.p_queue}:${ref}:${zone}`)))?.[1];
      if(old){
        if(old.zone==="yellow"&&args.p_zone==="orange"&&["sent","seen"].includes(String(old.status)))Object.assign(old,{zone:args.p_zone,reason:args.p_reason,summary:args.p_summary,slaDeadline:args.p_sla});
        return {ok:true,replayed:true,task:old};
      }
      return rpc("care_queue_raise", args);
    }
    if (name === "zoe_bp_merge_retry" || name === "bp_check_retry") return {ok:true,raised:0,failed:0};
    if (name === "zoe_bp_reading_zone") return { ok: true };
    if (name === "zoe_member_clinic_hours") return hours;
    if (name === "care_alert_screen") {
      if (!state.alerts) return {ok:false,code:"alerts_off"};
      const replayed=alertRefs.has(String(args.p_source_ref));
      alertRefs.add(String(args.p_source_ref));
      return {ok:true,replayed,outcome:"escalate",alertId:uuid(9)};
    }
    if (name === "care_alert_assessments_retry" || name === "care_alert_zoe_urgent_retry") return {ok:true,raised:0,failed:0};
    if (name === "care_alert_messages_pending") return [];
    if (name === "zoe_bp_messages_pending") return cards.filter(c=>redOutcome(c)&&!c.outcome.delivery);
    if (name === "zoe_bp_delivery_record") {
      const card=cards.find(c=>c.id===args.p_card)!;
      card.outcome.delivery={requestId:args.p_request,delivered:true};
      return {ok:true};
    }
    if (name === "care_alert_bp_flags_retry") {
      let raised=0,failed=0;
      for (const card of cards) {
        const red=redOutcome(card);
        if (!red || red.alerted) continue;
        const r=await rpc("care_alert_screen",{p_source_ref:`bp-flag:${card.id}`});
        if ((r as {ok:boolean}).ok) {card.outcome.alert={alerted:true,alertId:uuid(9)};raised++;} else failed++;
      }
      return {ok:true,raised,failed};
    }
    if (name === "care_queue_raise") {
      if (!careTeam || args.p_queue===state.failQueue) return { ok: false, code: "no_care_team" };
      const key = `${args.p_queue}:${args.p_source_ref}`, replayed = tasks.has(key);
      if (!replayed) tasks.set(key, { id: uuid(ids++), memberId: member, memberName: "", queue: args.p_queue, zone: args.p_zone, reason: args.p_reason, ruleVersion: args.p_rule_version, redFlagsStatus: args.p_red_flags, suggestedAction: null, summary: args.p_summary, slaDeadline: args.p_sla, status: "sent", stateSeq: 0, sandbox: false, createdAt: new Date().toISOString(), seenAt: null, answeredAt: null });
      return {ok:true,replayed,task:tasks.get(key)};
    }
    throw Error(`Unexpected ${name}`);
  };
  const stored = (id: string) => cards.find((c) => c.id === id) ?? null;
  const flow: FlowPorts = {
    rpc, readCards: async () => ({ enabled: true, cards, clearedSeq: null }),
    post: async (_m, requestId, kind, source, sourceSeq, snapshot) => {
      const old = cards.find((c) => c.requestId === requestId);
      if (old) return { ok: true, card: old, replayed: true };
      const card = cardSchema.parse({ id: uuid(ids++), requestId, kind, source, sourceSeq, state: "open", outcome: {}, claims: {}, at: new Date().toISOString(), snapshot });
      assert.ok(card.valid, `Snapshot for ${kind} must parse`);
      cards.push(card);
      return { ok: true, card, replayed: false };
    },
  };
  const claim: CardPorts["claim"] = async (_m, cardId, item, op, payload) => {
    const c = stored(cardId)!;
    c.claims[item] ??= { op, payload };
    return { ok: true, claim: c.claims[item] };
  };
  const record: CardPorts["record"] = async (_m, cardId, item, value, close) => {
    const c = stored(cardId)!;
    if (c.outcome[item] !== undefined) return { ok: true, card: c, replayed: true };
    c.outcome[item] = { ...value, doneAt: new Date().toISOString() };
    if (close) c.state = "done";
    return { ok: true, card: c, replayed: false };
  };
  const sent: { requestId: string; text: string }[] = [];
  const ports = {
    ...flow, claim, record, readCard: async (id: string) => stored(id),
    saveBp: async (v: { systolic: number; diastolic: number; submissionId: string }) => { readings.push({ id: uuid(ids++), submissionId:v.submissionId, sbp: v.systolic, dbp: v.diastolic }); return { status: "saved" as const }; },
    afterBp: (m: string, s: { submissionId: string; systolic: number; diastolic: number }) => runBpFlow(flow, m, s),
    readBpWeek: async () => null,
  } as unknown as CardPorts & FlowPorts;
  const flagPorts: FlagPorts = { ...flow, claim, record, readCard: async (id) => stored(id), send: async (requestId, text) => { if (!sent.some(m=>m.requestId===requestId)) sent.push({ requestId, text }); return {status:"sent" as const,thread:null}; } };
  return { calls, cards, ports, flagPorts, sent, tasks, flow, state, alertRefs };
}
const who = { memberId: member, channel: "app" as const } as MemberActor;
const at = () => new Date().toISOString();
function bpCard(w: ReturnType<typeof world>) {
  const card = cardSchema.parse({ id: uuid(ids++), requestId: uuid(ids++), kind: "bp", source: "chip", sourceSeq: null, state: "open", outcome: {}, claims: {}, at: at(), snapshot: { v: 1, week: null } });
  w.cards.push(card);
  return card;
}
const reading = (systolic: number, diastolic: number) => ({ submissionId: uuid(ids++), systolic, diastolic, pulse: null, measuredAt: at() });
const flowOn = (card: ZoeCard) => (card.outcome.bp as { flow: BpFlow }).flow;
const open = (w: ReturnType<typeof world>, kind: string) => w.cards.find((c) => c.kind === kind && c.state === "open")!;
async function allNo(w: ReturnType<typeof world>) {
  const card = open(w, "red_flags");
  let last;
  for (const q of RED_FLAG_QUESTIONS) last = await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: q, answer: false, locale: "en" });
  assert.equal(last!.status, "ok");
  return (card.outcome[flagItem("faint")] as { flow: BpFlow }).flow;
}
const raised = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.name === "care_queue_raise").map((c) => c.args);

// A failed photo save cannot recover cleared provenance from its immutable claim.
for (const kind of ['bp','repeat'] as const) {
 const w=world();
 const card=bpCard(w);
 if(kind==='repeat'){
  const repeat=cardSchema.parse({...card,kind:'repeat',snapshot:{v:1,first:{systolic:185,diastolic:115},episodeId:uuid(ids++),week:null}});
  assert.ok(repeat.valid);w.cards.splice(w.cards.indexOf(card),1,repeat);
 }
 const input={cardId:card.id,...reading(185,115),photoConfirmed:true};
 const labels:boolean[]=[];
 w.ports.saveBp=async v=>{labels.push(!!v.photoConfirmed);return {status:'failed'};};
 const command=kind==='bp'?logBp:logRepeat;
 assert.equal((await command(who,w.ports,input)).status,'failed');
 assert.equal((await command(who,w.ports,{...input,photoConfirmed:false})).status,'stale','Edited fields cannot retry a photo claim');
 assert.deepEqual(labels,[true],'A cleared label never replays into a new save');
}

// A reading alert leads: neither BP queue is raised, and the receipt uses its actual routing.
for (const sentTo of ["physician", null] as const) {
  const w = world();
  w.state.readingAlert = {id:uuid(90),sentTo,reason:"bp_doctor_today"};
  const first = await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(185,112)});
  assert.equal(raised(w).length,0,"An alert suppresses both duplicate BP tasks");
  const f=flowOn(first.card!);
  assert.deepEqual([f.sentTo,f.alertId,f.taskIds,f.nurseTask],[sentTo,uuid(90),[],false]);
  assert.equal(f.slaHours,null,"The alert has no zone-task deadline to promise");
  assert.equal(f.outOfHours,false,"No nurse task exists to promise a morning review");
  await allNo(w);
  await logRepeat(who,w.ports,{cardId:open(w,"repeat").id,...reading(185,112)});
  assert.equal(raised(w).length,0,"Replay and follow-up keep the alert as the sole item");
}

// A merged task is still sent to the doctor; it is not a staff answer.
assert.equal(chipState([uuid(94)],[{id:uuid(94),queue:"physician",status:"closed",mergedIntoAlertId:uuid(90)}]),"sent");

// An old repeat card never carries yesterday's identity into today's episode.
{
 const w=world();
 const rpc:FlowPorts["rpc"]=async(name,args)=>name==="zoe_bp_episode"?{ok:true,readingId:uuid(96),readings:[{id:uuid(96),submissionId:uuid(97),sbp:185,dbp:112}]}:w.flow.rpc!(name,args);
 const r=await runBpFlow({...w.flow,rpc},member,{episodeId:uuid(95),submissionId:uuid(97),systolic:185,diastolic:112});
 assert.equal((r.next?.snapshot as {episodeId?:string}).episodeId,uuid(96));
 assert.ok(raised(w).every(t=>String(t.p_source_ref).startsWith(uuid(96))));
}

// Even with the episode lookup down, a stale tab uses this submission's identity.
{
 const w=world();
 const rpc:FlowPorts["rpc"]=async(name,args)=>{if(name==="zoe_bp_episode")throw Error("Episode unavailable");return w.flow.rpc!(name,args);};
 const r=await runBpFlow({...w.flow,rpc},member,{episodeId:uuid(95),submissionId:uuid(98),systolic:185,diastolic:112});
 assert.equal((r.next?.snapshot as {episodeId?:string}).episodeId,`bp:${uuid(98)}`);
 assert.equal(r.next?.state,"open");
 assert.ok(raised(w).every(t=>String(t.p_source_ref).startsWith(`bp:${uuid(98)}`)));
}

// Staff history may have no submission id; it still belongs in the episode.
{
 const w=world();
 const rpc:FlowPorts["rpc"]=async(name,args)=>name==="zoe_bp_episode"?{ok:true,readingId:uuid(96),readings:[{id:uuid(99),submissionId:null,sbp:185,dbp:112},{id:uuid(96),submissionId:uuid(97),sbp:185,dbp:112}]}:w.flow.rpc!(name,args);
 const r=await runBpFlow({...w.flow,rpc},member,{submissionId:uuid(97),systolic:185,diastolic:112});
 assert.equal((r.next?.snapshot as {episodeId?:string}).episodeId,uuid(99));
}

// A staff alert can exist while the zone is still waiting for confirmation.
{
 const w=world();w.state.readingAlert={id:uuid(93),sentTo:"physician",reason:"bp_doctor_48h"};
 const r=await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(170,112)});
 assert.equal(flowOn(r.card!).alertId,uuid(93));
 assert.equal(flowOn(r.card!).sentTo,"physician");
 assert.equal(flowOn(r.card!).provisional,true);
 assert.equal(raised(w).length,0);
}

// The atomic raise rechecks after the preflight, including an alert arriving between queues.
{
  const w=world();
  const rpc:FlowPorts["rpc"]=async(name,args)=>{
    if(name==="zoe_bp_task_raise")w.state.readingAlert={id:uuid(91),sentTo:"physician",reason:"bp_doctor_today"};
    return w.flow.rpc!(name,args);
  };
  // Seed a real episode through the normal save before testing the injected interleaving.
  await w.ports.saveBp({submissionId:uuid(92),systolic:185,diastolic:112,pulse:null,measuredAt:at()});
  const r=await runBpFlow({...w.flow,rpc},member,{submissionId:uuid(92),systolic:185,diastolic:112});
  assert.equal(raised(w).length,0);
  assert.deepEqual([r.flow.sentTo,r.flow.alertId],["physician",uuid(91)]);
}

// Link failure never costs the save or the next question, and never invents delivery.
{
  const w=world();w.state.mergeDown=true;
  const r=await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(185,112)});
  assert.equal(r.status,"ok");
  assert.equal(r.status==="ok"&&r.next?.kind,"red_flags");
  assert.equal(flowOn(r.card!).sentTo,null);
  assert.equal(raised(w).length,0);
}

// Scenario B: 166/98, then flags all no, then a repeat: yellow, nurse, 48 hours, chip Sent.
{
  const w = world();
  const first = await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(166, 98) });
  assert.equal(first.status, "ok");
  assert.equal(first.status === "ok" && first.next?.kind, "red_flags", "Safety questions come before the repeat wait");
  assert.equal(flowOn(first.card!).provisional, true);
  assert.equal(flowOn(first.card!).sentTo, null);
  assert.equal(raised(w).length, 0, "A provisional result raises nothing");
  const after = await allNo(w);
  assert.equal(after.next, "repeat");
  const repeat = await logRepeat(who, w.ports, { cardId: open(w, "repeat").id, ...reading(166, 98) });
  const flow = flowOn(repeat.card!);
  assert.deepEqual([flow.zone, flow.provisional, flow.sentTo, flow.slaHours], ["yellow", false, "nurse", 48]);
  const [task] = raised(w);
  assert.equal(raised(w).length, 1);
  assert.deepEqual([task.p_queue, task.p_zone, task.p_red_flags], ["nurse", "yellow", "cleared"]);
  const hours = (Date.parse(String(task.p_sla)) - Date.now()) / 3_600_000;
  assert.ok(hours > 47.9 && hours <= 48);
  assert.equal(chipState(flow.taskIds, []), "sent", "The chip shows Sent even before the first task read");
  assert.equal(chipState(flow.taskIds, [{ id: flow.taskIds[0], queue: "nurse", status: "seen" }]), "seen_nurse");
  assert.equal(chipState(flow.taskIds, [{ id: flow.taskIds[0], queue: "nurse", status: "answered" }]), "answered");
  assert.deepEqual(w.calls.filter((c) => c.name === "zoe_bp_reading_zone").at(-1)?.args.p_zone, "yellow");
  assert.equal(w.calls.filter((c) => c.name === "care_alert_screen").length, 0);
}

// 183/112 with chest pain: red, the care alert, no queue task, the questions stop, the outcome carries 103.
{
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(183, 112) });
  const card = open(w, "red_flags");
  const r = await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: "chest_pain", answer: true, locale: "hy" });
  assert.equal(r.status, "ok");
  assert.equal(card.state, "done", "Any yes ends the questions at once");
  assert.equal(nextQuestion(answersOn(card)), null);
  assert.equal(w.tasks.size, 2, "Red adds no queue tasks; the first same-day save already raised its tasks");
  const alert = w.calls.filter((c) => c.name === "care_alert_screen");
  assert.equal(alert.length, 1);
  assert.deepEqual([alert[0].args.p_source, alert[0].args.p_source_ref, alert[0].args.p_outcome, alert[0].args.p_red_flags], ["zoe", `bp-flag:${card.id}`, "escalate", ["RF-01"]]);
  const red = redOutcome(card)!;
  assert.deepEqual([red.alerted, red.text], [true, FLAG_MESSAGE.chest_pain.hy]);
  assert.deepEqual(w.sent, [{ requestId: red.requestId, text: FLAG_MESSAGE.chest_pain.hy }], "The member's message goes through the chat path");
  assert.equal(w.calls.filter((c) => c.name === "zoe_bp_reading_zone").at(-1)?.args.p_zone, "red");
  assert.equal(contextStrip(w.cards)?.zone, "red");
  // A second device reads the same from the card alone.
  assert.deepEqual(redOutcome(cardSchema.parse(JSON.parse(JSON.stringify(card)))), red);
}

// Every question, in every language: a yes is red from the rules, whatever the word list says.
for (const q of RED_FLAG_QUESTIONS) for (const locale of ["hy", "en", "ru"] as const) {
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(170, 105) });
  const card = open(w, "red_flags");
  for (const earlier of RED_FLAG_QUESTIONS.slice(0, RED_FLAG_QUESTIONS.indexOf(q))) await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: earlier, answer: false, locale });
  await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: q, answer: true, locale });
  assert.equal(redOutcome(card)?.question, q);
  assert.equal(w.sent[0].text, FLAG_MESSAGE[q][locale]);
  assert.deepEqual(w.calls.find((c) => c.name === "care_alert_screen")?.args.p_red_flags, [FLAG_RED_FLAG[q]]);
  assert.equal(evaluateBp({ readings: [{ sbp: 170, dbp: 105 }], symptoms: symptomsFrom({ [q]: true }) }).zone, "red");
}
// The headache question counts as neuro and fainting as syncope; neither stays unknown or turns into a no.
assert.equal(symptomsFrom({ headache_dizziness: true }).neuro, true);
assert.equal(symptomsFrom({ neuro: false }).neuro, null, "One of the two is not a no for both");
assert.equal(symptomsFrom({ neuro: false, headache_dizziness: false }).neuro, false);
assert.equal(symptomsFrom({ faint: true }).syncope, true);
assert.match(FLAG_QUESTION.headache_dizziness.en, /sudden severe/);
assert.doesNotMatch(FLAG_QUESTION.headache_dizziness.en, /mild/i);

// With alerts off, 103 still shows and the card does not claim anyone was told.
{
  const w = world({ alerts: false });
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(183, 112) });
  const card = open(w, "red_flags");
  await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: "faint", answer: true, locale: "en" });
  assert.equal(card.outcome[flagItem("faint")] === undefined, true, "Questions are in order: the fifth is refused first");
  await answerRedFlag(who, w.flagPorts, { cardId: card.id, opId: uuid(ids++), question: "chest_pain", answer: true, locale: "en" });
  assert.deepEqual([redOutcome(card)?.alerted, card.state], [false, "done"]);
}

// A failed chat send never costs the 103 outcome.
{
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(183, 112) });
  const card = open(w, "red_flags");
  const r = await answerRedFlag(who, { ...w.flagPorts, send: async () => { throw Error("Offline"); } }, { cardId: card.id, opId: uuid(ids++), question: "chest_pain", answer: true, locale: "en" });
  assert.equal(r.status, "ok");
  assert.ok(redOutcome(card));
}

// 185/100, no symptoms, confirmed: orange, nurse and doctor, 4 hours.
{
  const w = world({ hours: [] });
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(185, 100) });
  await allNo(w);
  const r = await logRepeat(who, w.ports, { cardId: open(w, "repeat").id, ...reading(185, 100) });
  const flow = flowOn(r.card!);
  assert.deepEqual([flow.zone, flow.sentTo, flow.slaHours, flow.outOfHours], ["orange", "physician", 4, false]);
  assert.deepEqual([...w.tasks.values()].map((t) => t.queue), ["nurse", "physician"]);
  assert.equal(new Set(raised(w).map((t) => t.p_source_ref)).size, 1, "One source for the episode");
}

// Out of hours: orange only, and only when something was really sent.
{
  const closed = [{ weekday: 1, opens: "00:00:00", closes: "00:00:01" }];
  const orange = world({ hours: closed });
  await logBp(who, orange.ports, { cardId: bpCard(orange).id, ...reading(185, 100) });
  await allNo(orange);
  const r = await logRepeat(who, orange.ports, { cardId: open(orange, "repeat").id, ...reading(185, 100) });
  assert.equal(flowOn(r.card!).outOfHours, true);
  const yellow = world({ hours: closed });
  await logBp(who, yellow.ports, { cardId: bpCard(yellow).id, ...reading(150, 95) });
  const y = await logRepeat(who, yellow.ports, { cardId: open(yellow, "repeat").id, ...reading(150, 95) });
  assert.deepEqual([flowOn(y.card!).zone, flowOn(y.card!).outOfHours], ["yellow", false]);
  const none = world({ hours: closed, careTeam: false });
  await logBp(who, none.ports, { cardId: bpCard(none).id, ...reading(185, 100) });
  await allNo(none);
  const n = await logRepeat(who, none.ports, { cardId: open(none, "repeat").id, ...reading(185, 100) });
  assert.equal(flowOn(n.card!).outOfHours, false, "The out-of-hours text promises a nurse, so it needs a task");
}

// A half-entered repeat stays provisional and raises nothing.
{
  const half = decide([{ sbp: 170, dbp: 104 }, { sbp: 168, dbp: null as unknown as number }], { chestPain: false, dyspnea: false, neuro: false, syncope: false });
  assert.deepEqual([half.result.provisional, half.next], [true, "repeat"]);
  assert.ok(half.result.reasons.includes("bp_reading_incomplete"));
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(150, 95) });
  assert.equal(raised(w).length, 0);
  assert.ok(open(w, "repeat"), "The repeat stays open until a whole second reading is saved");
}

// A member with no care team: nothing says sent.
{
  const w = world({ careTeam: false });
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(166, 98) });
  await allNo(w);
  const r = await logRepeat(who, w.ports, { cardId: open(w, "repeat").id, ...reading(166, 98) });
  const flow = flowOn(r.card!);
  assert.deepEqual([flow.zone, flow.sentTo, flow.taskIds], ["yellow", null, []]);
  assert.equal(chipState(flow.taskIds, []), null, "No chip");
  assert.equal(sentToFrom([]), null);
  assert.equal(sentToFrom(["nurse"]), "nurse", "Only the doctor's task landing lets the reply name the doctor");
}

// Green: neutral, nothing raised, no strip.
{
  const w = world();
  const r = await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(120, 75) });
  assert.deepEqual([flowOn(r.card!).zone, r.status === "ok" ? r.next : null, raised(w).length], ["green", undefined, 0]);
  assert.equal(contextStrip(w.cards), null);
}

// A failed episode read still runs the rules on this reading; a total failure stays neutral and the reading is kept.
{
  const w = world();
  const rpc: FlowPorts["rpc"] = async (name, args) => { if (name === "zoe_bp_episode") throw Error("Down"); return w.flow.rpc!(name, args); };
  const r = await runBpFlow({ ...w.flow, rpc }, member, { submissionId: uuid(1), systolic: 150, diastolic: 95 });
  assert.equal(r.flow.next, "repeat");
  const none = await runBpFlow({ ...w.flow, rpc: null, post: async () => ({ ok: false, code: "unavailable" }) }, member, { submissionId: uuid(2), systolic: 150, diastolic: 95 });
  assert.deepEqual([none.flow.sentTo, none.flow.next, none.next], [null, null, null]);
}

// A same-day reading whose lookup failed keeps one identity: the confirmation doesn't double its tasks.
{
  const w = world();
  let down = true;
  const rpc: FlowPorts["rpc"] = async (name, args) => { if (down && name === "zoe_bp_episode") throw Error("Down"); return w.flow.rpc!(name, args); };
  await w.ports.saveBp({submissionId:uuid(3),systolic:180,diastolic:80,pulse:null,measuredAt:at()});
  const first = await runBpFlow({ ...w.flow, rpc }, member, { submissionId: uuid(3), systolic: 180, diastolic: 80 });
  assert.equal(w.tasks.size, 2);
  const ids = [...w.tasks.keys()];
  down = false;
  const episodeId = (first.next?.snapshot as { episodeId?: string } | undefined)?.episodeId;
  assert.equal(episodeId, `bp:${uuid(3)}`, "The repeat card carries the episode it belongs to");
  await w.ports.saveBp({submissionId:uuid(4),systolic:182,diastolic:82,pulse:null,measuredAt:at()});
  await runBpFlow({ ...w.flow, rpc }, member, { submissionId: uuid(4), systolic: 182, diastolic: 82, episodeId });
  assert.deepEqual([...w.tasks.keys()], ids, "The tasks are the same two tasks");
}

// A retry replays: one task, one next card, the same message.
{
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(166, 98) });
  const before = w.cards.length;
  await runBpFlow(w.flow, member, { submissionId: uuid(3), systolic: 166, diastolic: 98 });
  assert.equal(w.cards.length, before, "The same episode posts the same card");
}

// Turns, order and reload: answered blocks collapse, and a reparsed copy of the cards reads the same.
{
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(166, 98) });
  const flags = open(w, "red_flags");
  assert.equal(cardTurns(flags).length, 0, "An open question is a card, not a turn");
  await allNo(w);
  await logRepeat(who, w.ports, { cardId: open(w, "repeat").id, ...reading(166, 98) });
  assert.equal(cardTurns(flags).length, 1, "Five answers collapse into one turn");
  const order = (cards: ZoeCard[]) => dialogThread([], cards).map((e) => (e.type === "turn" ? `${e.card.kind}:${e.item}` : e.type));
  const shown = order(w.cards);
  assert.deepEqual(shown, ["turn", "turn", "turn"].map((_, i) => ["bp:bp", "red_flags:a:faint", "repeat:bp"][i]));
  assert.deepEqual(order(zoeCardsSchema.parse(JSON.parse(JSON.stringify({ enabled: true, cards: w.cards, clearedSeq: null }))).cards), shown, "Reload keeps the order");
}


// BP4-R1: failure is durable, and recovery needs no member action.
{
 const w=world({alerts:false});
 await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(170,105)});
 const card=open(w,"red_flags");
 await answerRedFlag(who,w.flagPorts,{cardId:card.id,opId:uuid(ids++),question:"chest_pain",answer:true,locale:"en"});
 assert.equal(redOutcome(card)?.alerted,false);
 w.state.alerts=true;
 const report=await runCareAlertSweep(w.flow.rpc!);
 assert.equal(report.escalated,1,"The normal sweep recovers the failed BP alert");
 assert.equal(redOutcome(card)?.alerted,true);
 await runCareAlertSweep(w.flow.rpc!);
 assert.equal(w.alertRefs.size,1,"One alert idempotency key, including after a second sweep");
 assert.ok(redOutcome(cardSchema.parse(JSON.parse(JSON.stringify(card)))),"103 never closes during recovery");
}

// A worse zone promotes the same episode task instead of opening a second physician item.
{
 const w=world();
 await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(170,110)});
 await allNo(w);
 await logRepeat(who,w.ports,{cardId:open(w,"repeat").id,...reading(170,110)});
 const old=[...w.tasks.values()].find(t=>t.queue==="physician")!;
 assert.equal(old.zone,"yellow");
 const r=await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(250,150)});
 const f=flowOn(r.card!);
 const actual=[...w.tasks.values()].find(t=>t.id===f.taskIds.find(id=>w.tasks.size&&[...w.tasks.values()].some(t=>t.id===id&&t.queue==="physician")))!;
 assert.deepEqual([actual.zone,f.zone,f.slaHours],["orange","orange",4]);
 assert.equal(actual.id,old.id,"A worse zone keeps the same physician task");
 assert.equal([...w.tasks.values()].filter(t=>t.queue==="physician").length,1);
}

// Same-day work is raised at the first save, survives abandonment, and confirmation replays it.
{
 const w=world();
 const first=await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(185,100)});
 assert.deepEqual([flowOn(first.card!).provisional,flowOn(first.card!).sentTo],[true,"physician"]);
 assert.equal(w.tasks.size,2,"Both same-day queues already have their task before any answers");
 const deadlines=[...w.tasks.values()].map(t=>t.slaDeadline);
 await allNo(w);
 await logRepeat(who,w.ports,{cardId:open(w,"repeat").id,...reading(185,100)});
 assert.equal(w.tasks.size,2,"Confirmation does not double the same-day task");
 assert.deepEqual([...w.tasks.values()].map(t=>t.slaDeadline),deadlines);
 const lower=world();
 await logBp(who,lower.ports,{cardId:bpCard(lower).id,...reading(185,100)});
 await allNo(lower);
 await logRepeat(who,lower.ports,{cardId:open(lower,"repeat").id,...reading(100,70)});
 assert.equal(lower.tasks.size,2,"A lower confirmation does not duplicate the original same-day tasks");
 const last=lower.cards.findLast(c=>c.kind==='repeat')!;
 assert.deepEqual([flowOn(last).zone,flowOn(last).sentTo,flowOn(last).slaHours],["orange","physician",4],"Receipt still describes the actual same-day work");
}

// BP4-R6: completion and successful conversation delivery are independent.
for (const failure of ["throw","result"] as const) {
 const w=world();
 await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(170,105)});
 const card=open(w,"red_flags"),v={cardId:card.id,opId:uuid(ids++),question:"chest_pain" as const,answer:true,locale:"en" as const};
 const send:FlagPorts["send"]=async()=>{if(failure==="throw")throw Error("Offline");return {status:"failed"};};
 await answerRedFlag(who,{...w.flagPorts,send},v);
 assert.ok(redOutcome(card),"103 is visible despite failed delivery");
 assert.equal(card.outcome.delivery,undefined);
 await retryRedMessages(w.flagPorts,member);
 await retryRedMessages(w.flagPorts,member);
 assert.equal(w.sent.length,1,"Exactly one message is stored on recovery");
 assert.equal((card.outcome.delivery as {delivered:boolean}|undefined)?.delivered,true);
}


// BP4-R5: partial failures preserve only owners/deadlines that exist.
for (const failQueue of ["nurse","physician",""]) {
 const w=world({failQueue,hours:[{weekday:1,opens:"00:00:00",closes:"00:00:01"}]});
 const r=await logBp(who,w.ports,{cardId:bpCard(w).id,...reading(185,100)});
 const f=flowOn(r.card!);
 assert.equal(f.sentTo,failQueue==="physician"?"nurse":"physician");
 assert.equal(f.nurseTask,failQueue!=="nurse");
 const stored=[...w.tasks.values()].find(t=>t.queue===f.sentTo)!;
 assert.equal(f.slaDeadline,stored.slaDeadline,"Receipt uses stored deadline");
 assert.equal(f.slaHours,4);
 assert.equal(f.outOfHours,true);
}

// The strip and the composer lock.
{
  const w = world();
  await logBp(who, w.ports, { cardId: bpCard(w).id, ...reading(166, 98) });
  const flags = open(w, "red_flags");
  assert.deepEqual(contextStrip(w.cards), { zone: "yellow", pending: { kind: "red_flags", left: 5 } });
  await answerRedFlag(who, w.flagPorts, { cardId: flags.id, opId: uuid(ids++), question: "chest_pain", answer: false, locale: "en" });
  assert.deepEqual(contextStrip(w.cards)?.pending, { kind: "red_flags", left: 4 });
  assert.equal(openFlags(w.cards)?.id, flags.id);
  const later = Date.parse(flags.at) + (rules.repeatEpisodeMinutes + 1) * 60_000;
  assert.equal(openFlags(w.cards, later), null, "An abandoned question never locks the chat");
  assert.deepEqual(episodeSymptoms(w.cards, later), UNASKED, "Answers from another episode are not reused");
  assert.deepEqual(contextStrip(w.cards, Date.parse(flags.at) + (rules.readingFreshHours + 1) * 3_600_000), null, "A zone older than a day is not shown");
}

// V3 off: no flow, no extra read, the save is as on main.
{
  const w = world();
  delete process.env.NOREON_ZOE_APP_V3;
  await runBpFlow(w.flow,member,{submissionId:uuid(1),systolic:185,diastolic:112});
  assert.equal(w.calls.length,0,"Calling the flow while V3 is off makes no database call");
  Object.assign(process.env,V3);
  let reads = 0;
  assert.equal(await memberTasks(async () => { reads++; return null; }, {}), undefined);
  assert.equal(reads, 0, "Switched off, the tasks are never read");
  const r = await logBp(who, { ...w.ports, afterBp: undefined }, { cardId: bpCard(w).id, ...reading(166, 98) });
  assert.equal("flow" in (r.card!.outcome.bp as object), false);
  assert.equal(w.cards.length, 1);
  assert.equal(w.calls.length, 0);
}

// Flow cards are the flow's: never a chip, never opened from the browser, never drawn in another channel.
assert.deepEqual(FLOW_KINDS.filter((k) => (CHIP_KINDS as readonly string[]).includes(k)), []);
const actions = readFileSync("lib/zoe-chat-actions/actions.ts", "utf8");
assert.match(actions, /if\(FLOW_KINDS\.includes\(parsed\.data\.kind\)\)return \{status:'invalid'\};/);
const words = readFileSync("components/chat-v2/bp-flow-cards.tsx", "utf8");
assert.doesNotMatch(words, /noNotify/, "The old no-notify line is gone under the flow");
assert.doesNotMatch(readFileSync("lib/zoe-chat-actions/bp-flow-server.ts", "utf8"), /urgent-staging|zoeTextRoute|urgentDecision|complete\(/, "No word matcher or model decides");
for (const line of allCopy()) for (const text of Object.values(line)) assert.doesNotMatch(text, /[!—]/, `Voice: ${text}`);
assert.ok(FLOW.outOfHours.hy.startsWith("Պոլիկլինիկայի բուժքույրը Ձեր տվյալը կտեսնի առավոտյան"));
assert.ok(FLOW.nurse48.en === "Your nurse will look at this within 48 hours." && BP.noNotify);
console.log("Blood pressure flow: all checks passed");
