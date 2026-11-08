import { expect, fixtureId, sql, test } from "../fixtures";
import { BOT, chatOf } from "./config.mjs";
import { cards, deliver, failNext, pressUpdate, replyUpdate, say, sent, sweep } from "./bot";

// These journeys use only the suite's fictional nurse and assigned member. The
// real webhook captures the binding; the real sweep, RPCs and outbox do the work.
const nurse = fixtureId(3), member = fixtureId(12), doctor = fixtureId(1);
let scenario = 0;
type Journey = { chat: number; task: string; future: string; title: string; binding: string };
type Message = Awaited<ReturnType<typeof sent>>[number];

function setup(): Journey {
  const n = ++scenario, chat = chatOf(430 + n), task = fixtureId(4300 + n * 2), future = fixtureId(4301 + n * 2), title = `Fictional follow-up ${n}`;
  const principal = JSON.stringify(["telegram", BOT.account, BOT.id, "user", chat]);
  const account = JSON.stringify([BOT.account, BOT.id]);
  const binding = sql(`begin;
    update public.profiles set locale='en' where id='${nurse}';
    update public.patient_clinical_cases set assigned_nurse_id='${nurse}' where user_id='${member}';
    update public.telegram_nurse_settings set enabled=true where singleton;
    update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%';
    -- Earlier scenarios keep their receipts, but no longer contribute due work.
    update public.patient_coordination_tasks set status='cancelled' where owner_id='${nurse}' and id::text like 'e2e00000-%' and status not in ('completed','cancelled');
    insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id) values
      ('${task}','${member}','contact-followup','${title}','Confirm the fictional appointment.',clock_timestamp(),'${doctor}','${nurse}'),
      ('${future}','${member}','contact-followup','Future fictional work ${n}','Do this tomorrow.',clock_timestamp()+interval '2 days','${doctor}','${nurse}');
    select public._telegram_auth_bind('${nurse}','staff','${principal}','${account}','+37499000430','${chat}',null)->>'bindingId';
    commit;`);
  expect(binding, "fixture has a current staff binding").toMatch(/^[0-9a-f-]{36}$/);
  return { chat, task, future, title, binding };
}

const state = (j: Journey) => sql(`select status||':'||revision from public.patient_coordination_tasks where id='${j.task}'`);
const completions = (j: Journey) => sql(`select count(*) from public.patient_coordination_events where task_id='${j.task}' and operation='complete'`);
const prompts = async (j: Journey) => (await sent(j.chat)).filter((c) => c.body.reply_markup?.force_reply === true);
async function post(update: unknown) { expect((await deliver(update)).status, "webhook accepts the update").toBe(200); }
async function drain() { await sweep(); await sweep(); }
async function today(j: Journey): Promise<Message> {
  const before = (await cards(j.chat)).length;
  await say(j.chat, "/today");
  await expect.poll(async () => { await sweep(); return (await cards(j.chat)).length; }, "a fresh today's task arrives through the outbox").toBeGreaterThan(before);
  const card = (await cards(j.chat)).at(-1)!;
  expect(card.body.text).toContain(j.title);
  expect(card.body.text).toContain("Fictional otherMember");
  expect(card.body.text).not.toContain("Future fictional work");
  expect(card.body.protect_content).toBe(true);
  return card;
}
function press(j: Journey, card: Message) {
  const key = card.body.reply_markup!.inline_keyboard!.flat().find((k) => /^\d+\. Mark done$/.test(k.text))!;
  expect(key, "a task has its Mark done action").toBeDefined();
  expect(key.callback_data).toMatch(/^ni1:/);
  return pressUpdate(j.chat, Number(card.result!.message_id), key.callback_data);
}
async function openNote(j: Journey, card: Message) {
  const before = (await prompts(j)).length;
  await post(press(j, card));
  await expect.poll(async () => { await sweep(); return (await prompts(j)).length; }, "one correlated note question arrives").toBe(before + 1);
  const prompt = (await prompts(j)).at(-1)!;
  expect(prompt.body.text).toContain("Completion note");
  expect(prompt.body.text).toContain(j.title);
  expect(prompt.body.text).toContain("Reply to this message");
  expect(prompt.body.reply_markup?.selective).toBe(true);
  return prompt;
}
async function savedOnce(j: Journey, note: string) {
  await expect.poll(async () => { await sweep(); return state(j); }).toBe("completed:2");
  expect(completions(j), "one business effect").toBe("1");
  expect(sql(`select count(*) from public.patient_coordination_events where task_id='${j.task}' and operation='complete' and note='${note}' and actor_id='${nurse}'`)).toBe("1");
  expect(sql(`select count(*) from public.patient_coordination_receipts where input->>'taskId'='${j.task}' and channel='telegram' and session_id is null and binding_id='${j.binding}'`), "truthful channel provenance without a web session").toBe("1");
  expect((await sent(j.chat)).every((c) => c.body.protect_content === true), "every nurse-detail message is protected").toBe(true);
  expect((await sent(j.chat)).some((c) => c.body.text?.includes(note)), "the typed nurse message is never echoed").toBe(false);
}

test("nurse task completion is a dialog: attributed action, exact reply, one save and next step", async () => {
  const j = setup(), card = await today(j), prompt = await openNote(j, card);
  const thread = await sent(j.chat);
  const ack = thread.findIndex((c) => c.body.text === `Nurse Fictional Ani: Done: ${j.title}`);
  expect(ack, "the button action is attributed to the nurse at the end").toBeGreaterThanOrEqual(0);
  expect(thread.findIndex((c) => c.result?.message_id === prompt.result?.message_id), "the answer precedes the next question").toBeGreaterThan(ack);
  expect(state(j), "mark done asks for a note before saving").toBe("open:1");
  await expect.poll(async () => { await sweep(); return (await sent(j.chat, "editMessageReplyMarkup")).length; }, "the used controls leave their old place").toBe(1);
  expect((await sent(j.chat, "editMessageReplyMarkup"))[0].body.reply_markup?.inline_keyboard).toEqual([]);

  const note = "Fictional appointment confirmed by phone.";
  const update = replyUpdate(j.chat, prompt.result!.message_id, note);
  await Promise.all([post(update), post(update)]);
  await savedOnce(j, note);
  await drain();
  expect((await sent(j.chat)).at(-1)?.body.text).toMatch(/^(Next:|No due tasks)/);
  await post(update); await post(press(j, card)); await drain();
  expect(state(j)).toBe("completed:2");
  expect(completions(j), "redelivery and an old button cannot save twice").toBe("1");
});

test("notes must reply to the current prompt; a foreign prompt and bare text do not save", async () => {
  const j = setup(), prompt = await openNote(j, await today(j));
  await post(replyUpdate(j.chat, prompt.result!.message_id + 10000, "Fictional wrong prompt."));
  await say(j.chat, "Fictional bare note without a reply.");
  await drain();
  expect(state(j)).toBe("open:1");
  expect(completions(j)).toBe("0");
  const note = "Fictional exact prompt answer.";
  await post(replyUpdate(j.chat, prompt.result!.message_id, note));
  await savedOnce(j, note);
});

test("cancelled and expired questions refuse delayed notes", async () => {
  const j = setup(), oldPrompt = await openNote(j, await today(j));
  await post(replyUpdate(j.chat, oldPrompt.result!.message_id, "/cancel"));
  await drain();
  await post(replyUpdate(j.chat, oldPrompt.result!.message_id, "Fictional cancelled answer."));
  await drain();
  expect(state(j)).toBe("open:1");
  expect(completions(j)).toBe("0");

  const before = (await prompts(j)).length;
  const card = await today(j);
  await post(press(j, card));
  await expect.poll(async () => { await sweep(); return (await prompts(j)).length; }).toBe(before + 1);
  const current = (await prompts(j)).at(-1)!;
  sql(`update public.telegram_nurse_dialogs set expires_at=clock_timestamp()-interval '1 second' where binding_id='${j.binding}';`);
  await post(replyUpdate(j.chat, current.result!.message_id, "Fictional late answer."));
  await drain();
  expect(state(j)).toBe("open:1");
  expect(completions(j)).toBe("0");
});

test("failed control removal and a lost save confirmation never repeat the task command", async () => {
  const j = setup(), card = await today(j);
  await failNext("editMessageReplyMarkup", "drop", j.chat);
  const prompt = await openNote(j, card);
  await expect.poll(async () => { await sweep(); return (await sent(j.chat, "editMessageReplyMarkup")).length; }).toBe(1);
  expect((await sent(j.chat, "editMessageReplyMarkup"))[0].failed).toBe("drop");
  // Reusing the visually surviving button must not arm a second question.
  await post(press(j, card)); await drain();
  expect(await prompts(j)).toHaveLength(1);
  await failNext("sendMessage", "drop", j.chat);
  const note = "Fictional note saved before transport failed.";
  const update = replyUpdate(j.chat, prompt.result!.message_id, note);
  await post(update); await savedOnce(j, note);
  await drain();
  const lost = (await sent(j.chat)).filter((c) => c.failed === "drop");
  expect(lost, "only one attempt at the saved result").toHaveLength(1);
  expect(sql(`select count(*) from public.telegram_nurse_outbox where binding_id='${j.binding}' and state='unknown'`)).toBe("1");
  await post(update); await drain();
  expect((await sent(j.chat)).filter((c) => c.failed === "drop")).toHaveLength(1);
  expect(completions(j)).toBe("1");
  expect(await sent(j.chat, "editMessageReplyMarkup"), "the ambiguous edit is not retried").toHaveLength(1);
});

test("a lost action acknowledgement withholds its question until explicit resume creates a fresh prompt", async () => {
  const j = setup(), card = await today(j);
  await failNext("sendMessage", "drop", j.chat);
  const update = press(j, card);
  await post(update); await drain();
  expect((await sent(j.chat)).filter((c) => c.failed === "drop")).toHaveLength(1);
  expect(await prompts(j), "no question follows an unresolved predecessor").toHaveLength(0);
  await post(update); await drain();
  expect((await sent(j.chat)).filter((c) => c.failed === "drop")).toHaveLength(1);
  expect(await prompts(j)).toHaveLength(0);
  expect(state(j)).toBe("open:1");
  const unknown = sql(`select id from public.telegram_nurse_outbox where binding_id='${j.binding}' and turn->>'kind'='action' and state='unknown'`);
  expect(unknown, "the lost action retains its exact outbox identity").toMatch(/^[0-9a-f-]{36}$/);

  await say(j.chat, "/resume");
  await expect.poll(async () => { await sweep(); return (await prompts(j)).length; }, "resume reads current work and sends a new question").toBe(1);
  const resumed = (await prompts(j))[0];
  expect(sql(`select prompt_message_id from public.telegram_nurse_dialogs where binding_id='${j.binding}'`), "the fresh provider message is the only accepted reply target").toBe(String(resumed.result!.message_id));
  expect(sql(`select state||':'||abandoned from public.telegram_nurse_outbox where id='${unknown}'`), "the uncertain item is preserved and explicitly abandoned").toBe("unknown:true");
  expect(sql(`select count(*) from public.telegram_nurse_outbox where source_inbox=(select source_inbox from public.telegram_nurse_outbox where id='${unknown}') and turn->>'kind'='task-note' and state='suppressed'`), "the original unsent dependent question cannot escape").toBe("1");
  expect((await sent(j.chat)).filter((c) => c.body.text === `Nurse Fictional Ani: Done: ${j.title}`), "resume does not resend the old action").toHaveLength(1);
  expect(state(j), "resume alone has no business effect").toBe("open:1");
  expect(completions(j)).toBe("0");

  const note = "Fictional reply to the resumed prompt.";
  await post(replyUpdate(j.chat, resumed.result!.message_id, note));
  await savedOnce(j, note);
  await drain();
  expect((await sent(j.chat)).filter((c) => c.failed === "drop"), "the original unknown send is never retried").toHaveLength(1);
  expect(sql(`select state||':'||abandoned from public.telegram_nurse_outbox where id='${unknown}'`)).toBe("unknown:true");
});

test("revoking the captured binding refuses an old note and never treats it as member input", async () => {
  const j = setup(), prompt = await openNote(j, await today(j));
  sql(`select public._telegram_revoke_binding('${j.binding}','e2e_revoked');`);
  const count = (await sent(j.chat)).length;
  await post(replyUpdate(j.chat, prompt.result!.message_id, "Fictional revoked note."));
  await drain();
  expect(state(j)).toBe("open:1");
  expect(completions(j)).toBe("0");
  expect((await sent(j.chat)).slice(count).some((c) => c.body.text?.includes(j.title)), "revoked output reveals no task detail").toBe(false);
  expect(sql(`select count(*) from public.conversation_messages where source='telegram_member' and body='Fictional revoked note.'`)).toBe("0");
});

test("the database switch blocks an already displayed nurse task", async () => {
  const j = setup(), prompt = await openNote(j, await today(j));
  sql("update public.telegram_nurse_settings set enabled=false where singleton;");
  try {
    const count = (await sent(j.chat)).length;
    await post(replyUpdate(j.chat, prompt.result!.message_id, "Fictional disabled note."));
    await drain();
    expect(state(j)).toBe("open:1");
    expect(completions(j)).toBe("0");
    expect((await sent(j.chat)).slice(count).some((c) => c.body.text?.includes(j.title))).toBe(false);
  } finally { sql("update public.telegram_nurse_settings set enabled=true where singleton;"); }
});
