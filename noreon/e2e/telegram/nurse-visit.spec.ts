import { expect, fixtureId, sql, test } from "../fixtures";
import { BOT, chatOf } from "./config.mjs";
import { cards, deliver, failNext, pressUpdate, replyUpdate, say, sent, sweep } from "./bot";
import { nextQuestion } from "../../lib/nurse-visit/chat-order";
import { itemTitle, visitCopy } from "../../lib/nurse-visit/copy";
import type { NurseVisitReady } from "../../lib/nurse-visit/schema";

// Fictional fixtures only. The webhook, sweep, durable input, visit commands and
// outbox are real; only Telegram's HTTP API is replaced by the suite's provider.
const nurse = fixtureId(3), member = fixtureId(12), copy = visitCopy("en");
type Message = Awaited<ReturnType<typeof sent>>[number];
type Journey = { chat: number; request: string; device: string; assignment: string; binding: string; oldEnabled: boolean };
type Dialog = { prompt_message_id: string | null; visit_question_key: string | null; visit_completion_ids: Record<string, string> | null; visit_flow: { skipped?: string[] } };
let scenario = 0;
let active: Journey | undefined;

function cleanup(j: Journey) {
  sql(`begin;
    create temp table visit_cleanup on commit drop as select visit_id,command from public.nurse_visit_completions where source_id='${j.request}';
    set session_replication_role=replica;
    delete from public.telegram_nurse_intents where binding_id='${j.binding}';
    delete from public.telegram_nurse_outbox where binding_id='${j.binding}';
    delete from public.telegram_nurse_dialogs where binding_id='${j.binding}';
    delete from public.channel_inbox where nurse_binding_id='${j.binding}';
    delete from public.nurse_visit_events where source_id='${j.request}';
    delete from public.nurse_visit_marks where source_id='${j.request}';
    delete from public.nurse_visit_completions where source_id='${j.request}';
    delete from public.patient_measurements where id in (select measurement_id from public.patient_care_visit_entries where visit_id in(select visit_id from visit_cleanup));
    delete from public.patient_care_visit_entries where visit_id in(select visit_id from visit_cleanup);
    delete from public.patient_care_visit_command_receipts where user_id='${member}' and submission_id in(
      select (command->>'openSubmissionId')::uuid from visit_cleanup union all select (command->>'appendSubmissionId')::uuid from visit_cleanup);
    delete from public.patient_care_visits where id in(select visit_id from visit_cleanup);
    delete from public.patient_clinical_case_events where user_id='${member}' and (detail->>'sourceId'='${j.request}' or detail->>'visitId' in(select visit_id::text from visit_cleanup));
    delete from public.bp_device_assignments where id='${j.assignment}';
    delete from public.bp_devices where id='${j.device}';
    delete from public.patient_test_request_events where request_id='${j.request}';
    delete from public.patient_test_requests where id='${j.request}';
    delete from public.telegram_auth_bindings where id='${j.binding}';
    set session_replication_role=origin;
    update public.nurse_visit_settings set enabled=${j.oldEnabled} where singleton;
    commit;`);
}
test.afterEach(() => { if (active) { cleanup(active); active = undefined; } });

function setup(): Journey {
  const n = ++scenario, chat = chatOf(470 + n), request = fixtureId(4700 + n), device = fixtureId(4800 + n * 2), assignment = fixtureId(4801 + n * 2);
  const oldEnabled = sql("select enabled from public.nurse_visit_settings where singleton") === "t";
  const principal = JSON.stringify(["telegram", BOT.account, BOT.id, "user", chat]), account = JSON.stringify([BOT.account, BOT.id]);
  const binding = sql(`begin;
    update public.profiles set locale='en' where id='${nurse}';
    update public.patient_clinical_cases set assigned_nurse_id='${nurse}' where user_id='${member}';
    update public.telegram_nurse_settings set enabled=true where singleton;
    update public.nurse_visit_settings set enabled=true where singleton;
    update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%';
    insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
    values('${request}','${member}','confirmed','{}',
      '[{"id":"lipid-panel","title":"Fictional lipid panel","method":"lab"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"}]',
      'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',date_trunc('minute',clock_timestamp()),'timezone','Asia/Yerevan','location','Fictional visit address')));
    insert into public.bp_devices(id,model,serial,status,created_by)
      select '${device}','Fictional BP monitor','FIC-TG-${n}','assigned','${nurse}' where not exists(select 1 from public.bp_device_assignments where member_id='${member}' and ended_at is null);
    insert into public.bp_device_assignments(id,device_id,member_id,assigned_at,assigned_by,assigned_by_name,assigned_by_role)
      select '${assignment}',id,'${member}',clock_timestamp(),'${nurse}','Fictional nurse','nurse' from public.bp_devices where id='${device}';
    select public._telegram_auth_bind('${nurse}','staff','${principal}','${account}','+37499000470','${chat}',null)->>'bindingId';
    commit;`);
  expect(binding).toMatch(/^[0-9a-f-]{36}$/);
  return active = { chat, request, device, assignment, binding, oldEnabled };
}
const dialog = (j: Journey): Dialog => JSON.parse(sql(`select row_to_json(d) from public.telegram_nurse_dialogs d where binding_id='${j.binding}'`));
const detail = (j: Journey): NurseVisitReady => JSON.parse(sql(`select public._nurse_visit_detail_as('${nurse}','${j.binding}',1,'${member}','home-request','${j.request}')`));
const marks = (j: Journey) => sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}'`);
const completions = (j: Journey) => sql(`select count(*) from public.nurse_visit_completions where source_id='${j.request}'`);
async function post(update: unknown) { expect((await deliver(update)).status).toBe(200); }
async function drain() { await sweep(); await sweep(); }
async function prompt(j: Journey, previous?: Message): Promise<Message> {
  let found: Message | undefined;
  await expect.poll(async () => {
    await sweep();
    const id = dialog(j).prompt_message_id;
    found = (await sent(j.chat)).find(c => String(c.result?.message_id) === id && c.result?.message_id !== previous?.result?.message_id);
    return Boolean(found);
  }, "the current exact visit prompt arrives through the outbox").toBe(true);
  expect(found!.body.protect_content).toBe(true);
  return found!;
}
function button(j: Journey, question: Message, label: string) {
  const key = question.body.reply_markup?.inline_keyboard?.flat().find(k => k.text === label);
  expect(key, `the existing visit action is available: ${label}`).toBeDefined();
  expect(key!.callback_data).toMatch(/^ni1:/);
  return pressUpdate(j.chat, question.result!.message_id, key!.callback_data);
}
async function choose(j: Journey, question: Message, label: string) { await post(button(j, question, label)); return prompt(j, question); }
async function openVisit(j: Journey, command = "/visits") {
  const before = (await cards(j.chat)).length;
  await say(j.chat, command);
  await expect.poll(async () => { await sweep(); return (await cards(j.chat)).length; }).toBeGreaterThan(before);
  // A member can have other visits. Pick this exact request's opaque list intent.
  const ref = sql(`select v->>'intentRef' from public.telegram_nurse_outbox o cross join lateral jsonb_array_elements(o.turn->'visits') v where o.binding_id='${j.binding}' and o.turn->>'kind'='visit-list' and v->>'id'='${j.request}' order by o.sequence desc limit 1`);
  expect(ref).toMatch(/^[A-Za-z0-9_-]{16,60}$/);
  let card: Message | undefined;
  await expect.poll(async () => {
    await sweep();
    card = (await cards(j.chat)).findLast(c => c.body.reply_markup?.inline_keyboard?.flat().some(k => k.callback_data === `ni1:${ref}`));
    return Boolean(card);
  }, "the assigned visit has a delivered selectable card").toBe(true);
  const key = card!.body.reply_markup!.inline_keyboard!.flat().find(k => k.callback_data === `ni1:${ref}`)!;
  expect(key.text).toMatch(/^\d+$/);
  expect(card!.body.text).toContain("Fictional otherMember");
  await post(pressUpdate(j.chat, card!.result!.message_id, key.callback_data));
  return prompt(j);
}
async function reachFinish(j: Journey, first: Message, skipSafety = false, checkStaleReading = false) {
  let question = first;
  for (let turns = 0; turns < 40; turns++) {
    const snapshot = detail(j), next = nextQuestion(snapshot, dialog(j).visit_flow.skipped ?? []);
    expect(next, "unfinished work remains navigable").not.toBeNull();
    if (!next) throw new Error("Fictional visit has no next question");
    if (next.kind === "finish") return question;
    if (next.kind === "step") {
      expect(question.body.text).toContain(copy.stepButtons[next.step]);
      question = await choose(j, question, copy.stepButtons[next.step]);
    } else {
      const item = next.item;
      expect(question.body.text).toContain(itemTitle(item, "en"));
      if (skipSafety && item.kind === "check" && item.section === "safety") question = await choose(j, question, "Skip for now");
      else if (item.kind === "measurement") {
        expect(question.body.reply_markup?.force_reply, "readings use the reply affordance on the exact prompt").toBe(true);
        const readingPrompt = question;
        await post(replyUpdate(j.chat, question.result!.message_id, item.field === "bp" ? "148/93 72" : item.field === "weight" ? "82.5" : "91"));
        question = await prompt(j, question);
        if (checkStaleReading && item.field === "bp") {
          const before = marks(j), current = dialog(j).prompt_message_id;
          // 99 is valid for the next weight question. A delayed reading must
          // never be reinterpreted as an answer to that next measurement.
          await post(replyUpdate(j.chat, readingPrompt.result!.message_id, "99")); await drain();
          expect(marks(j), "an old reading prompt cannot answer the next item").toBe(before);
          expect(dialog(j).prompt_message_id).toBe(current);
          expect(sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}' and item='measure:weight'`)).toBe("0");
        }
      } else question = await choose(j, question, item.kind === "sample" ? copy.sampleTaken : item.kind === "device" ? copy.deviceDone : copy.done);
    }
  }
  throw new Error("Fictional visit did not reach completion in forty turns");
}
function assertProvenance(j: Journey) {
  // A mark has no session or channel column, on the web either: it is recorded for the nurse by submission id.
  // Telegram provenance is on the completion and on the read audit, never a web session.
  const marks = sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}'`);
  expect(Number(marks)).toBeGreaterThan(0);
  expect(sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}' and actor_id<>'${nurse}'`)).toBe("0");
  expect(Number(sql(`select count(*) from public.access_audit where actor_id='${nurse}' and channel='telegram' and binding_id='${j.binding}' and session_id is null`))).toBeGreaterThan(0);
  expect(sql(`select count(*) from public.access_audit where actor_id='${nurse}' and channel='telegram' and session_id is not null`)).toBe("0");
  expect(sql(`select count(*) from public.nurse_visit_completions where source_id='${j.request}' and channel='telegram' and session_id is null and binding_id='${j.binding}' and actor_id='${nurse}'`)).toBe("1");
}

test("a whole Telegram visit records existing steps, checks, samples and structured readings once", async () => {
  const j = setup(), finish = await reachFinish(j, await openVisit(j), false, true);
  expect(finish.body.text).toContain(copy.allItemsDone);
  const confirmation = await choose(j, finish, copy.completeVisit);
  expect(confirmation.body.text).toContain(copy.completeQuestion);
  expect(confirmation.body.text).toContain(copy.allDone);
  expect(sql(`select vals from public.nurse_visit_marks where source_id='${j.request}' and item='measure:bp'`)).toBe('{"pulse": 72, "systolic": 148, "diastolic": 93}');
  const update = button(j, confirmation, copy.completeVisit);
  await Promise.all([post(update), post(update)]);
  await expect.poll(async () => { await sweep(); return completions(j); }).toBe("1");
  await post(update); await drain();
  expect(completions(j)).toBe("1");
  expect(detail(j).completion?.summary).toMatchObject({ samplesPlanned: 1, samplesTaken: 1, bpTaken: true, deviceDone: true, openItems: [] });
  expect(sql(`select string_agg(step,',' order by occurred_at) from public.nurse_visit_events where source_id='${j.request}'`)).toBe("confirmed,started,samples-collected,samples-at-lab,completed");
  expect(sql(`select status from public.patient_test_requests where id='${j.request}'`)).toBe("completed");
  assertProvenance(j);
  expect((await sent(j.chat)).every(c => c.body.protect_content === true)).toBe(true);
  // Completion must release ordinary navigation on this same chat. The next
  // visit is selected through /menu, never by an internal dialog reset.
  const second = fixtureId(4950 + scenario);
  sql(`insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
    select '${second}',user_id,'confirmed',requested_terms,requirements,algorithm_version,'synthetic-second','{}',current_arrangement from public.patient_test_requests where id='${j.request}'`);
  try {
    const nextPrompt = await openVisit({...j,request:second}, "/menu");
    expect(nextPrompt.body.text).toContain(copy.confirmed);
    expect(dialog(j).visit_question_key).toBe("step:confirmed");
    expect(completions(j)).toBe("1");
  } finally {
    sql(`delete from public.patient_test_requests where id='${second}'`);
  }
});

test("a reply to an old visit comment prompt cannot be carried into the next item", async () => {
  const j = setup();
  let question = await openVisit(j);
  question = await choose(j, question, copy.confirmed);
  question = await choose(j, question, copy.started);
  const oldKey = dialog(j).visit_question_key;
  const comment = await choose(j, question, copy.addComment);
  expect(comment.body.text).toContain("Reply to this message");
  expect(comment.body.reply_markup?.force_reply).toBe(true);
  await post(replyUpdate(j.chat, comment.result!.message_id, "Fictional first safety comment."));
  question = await prompt(j, comment);
  question = await choose(j, question, copy.done);
  expect(dialog(j).visit_question_key).not.toBe(oldKey);
  const before = marks(j), current = dialog(j).prompt_message_id;
  await post(replyUpdate(j.chat, comment.result!.message_id, "Fictional stale comment must never move."));
  await drain();
  expect(marks(j), "a delayed answer writes no mark").toBe(before);
  expect(sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}' and note='Fictional stale comment must never move.'`)).toBe("0");
  expect(dialog(j).prompt_message_id, "the old reply does not replace the current question").toBe(current);
  await post(button(j, question, copy.done)); await drain();
  expect(sql(`select note is null from public.nurse_visit_marks where source_id='${j.request}' and item<>'${oldKey}' order by recorded_at desc limit 1`), "the next item inherits no comment").toBe("t");
});

test("lost visit completion confirmation resumes with the exact command ids and one business effect", async () => {
  const j = setup(), finish = await reachFinish(j, await openVisit(j));
  const confirmation = await choose(j, finish, copy.completeVisit);
  const ids = dialog(j).visit_completion_ids;
  expect(ids).not.toBeNull();
  for (const key of ["submissionId", "visitId", "openSubmissionId", "appendSubmissionId"]) expect(ids![key]).toMatch(/^[0-9a-f-]{36}$/);
  await failNext("sendMessage", "drop", j.chat);
  const update = button(j, confirmation, copy.completeVisit);
  await post(update);
  await expect.poll(async () => { await sweep(); return completions(j); }).toBe("1");
  await drain();
  const unknown = sql(`select id from public.telegram_nurse_outbox where binding_id='${j.binding}' and state='unknown'`);
  expect(unknown).toMatch(/^[0-9a-f-]{36}$/);
  await post(update); await say(j.chat, "/resume"); await drain();
  expect(completions(j)).toBe("1");
  const command = JSON.parse(sql(`select command from public.nurse_visit_completions where source_id='${j.request}'`));
  for (const key of ["submissionId", "visitId", "openSubmissionId", "appendSubmissionId"]) expect(command[key], `resume preserves ${key}`).toBe(ids![key]);
  expect(sql(`select count(*) from public.patient_care_visits where id='${ids!.visitId}'`)).toBe("1");
  expect(sql(`select count(*) from public.patient_care_visit_command_receipts where user_id='${member}' and submission_id in('${ids!.openSubmissionId}','${ids!.appendSubmissionId}')`)).toBe("2");
  expect(sql(`select state||':'||abandoned from public.telegram_nurse_outbox where id='${unknown}'`)).toBe("unknown:true");
  expect((await sent(j.chat)).filter(c => c.failed === "drop"), "an ambiguous send is never retried").toHaveLength(1);
  assertProvenance(j);
});

test("finishing with an open safety item requires a reason of at least three characters", async () => {
  const j = setup(), finish = await reachFinish(j, await openVisit(j), true);
  expect(detail(j).counts.openItems).toEqual(expect.arrayContaining(["check:urgent-symptoms", "check:severe-bp-contact"]));
  await post(button(j, finish, copy.completeVisit)); await drain();
  expect(completions(j), "the button alone cannot finish open work").toBe("0");
  const reasonPrompt = await prompt(j, finish);
  expect(reasonPrompt.body.text).toContain(copy.reasonLabel);
  expect(reasonPrompt.body.reply_markup?.force_reply).toBe(true);
  await post(replyUpdate(j.chat, reasonPrompt.result!.message_id, "ab")); await drain();
  expect(completions(j), "two characters are not an incomplete-item reason").toBe("0");
  const current = await prompt(j, reasonPrompt);
  expect(current.body.text).toContain(copy.reasonError);
  // The three-character boundary is accepted, while the safety marks stay open.
  await post(replyUpdate(j.chat, current.result!.message_id, "TBC"));
  await expect.poll(async () => { await sweep(); return completions(j); }).toBe("1");
  expect(sql(`select reason from public.nurse_visit_completions where source_id='${j.request}'`)).toBe("TBC");
  expect(sql(`select count(*) from public.nurse_visit_marks where source_id='${j.request}' and item in('check:urgent-symptoms','check:severe-bp-contact')`), "skipped safety work stays unmarked").toBe("0");
});
