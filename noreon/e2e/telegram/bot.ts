import type { Page } from "@playwright/test";
import { accounts, env, expect, fixtureId, sql } from "../fixtures";
import { BOT, chatOf, CRON_SECRET, telegramPeople } from "./config.mjs";

/** The Bot API calls the app made and the model calls it asked for, as fake-api.mjs saw them. */
type Key = { text: string; callback_data: string };
type Body = { chat_id?: number; message_id?: number; text?: string; callback_query_id?: string; protect_content?: boolean; parse_mode?: string; reply_markup?: { inline_keyboard?: Key[][]; keyboard?: { request_contact?: boolean }[][]; force_reply?: boolean; selective?: boolean } };
export type Call = { method: string; body: Body; failed: string | null; result?: { message_id: number } };
type ModelCall = { purpose: string; modelId: string; user: string };
const fake = `http://127.0.0.1:${process.env.NOREON_E2E_TELEGRAM_PORT}/__e2e`;
const control = (path: string, body?: unknown) => fetch(`${fake}/${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
const seen = async () => (await control("calls")).json() as Promise<{ calls: Call[]; model: ModelCall[] }>;

export const allCalls = async () => (await seen()).calls;
export const failNext = (method: string, mode: "drop" | "refuse", chatId?: number) => control("fail", { method, mode, chatId });
/** The next answer the stand-in model gives for this purpose. */
export const modelSays = (purpose: string, answer: Record<string, unknown>) => control("script", { purpose, answer });
export const model = async (purpose?: string) => (await seen()).model.filter((c) => !purpose || c.purpose === purpose);

let update = Date.now() % 1_000_000_000;
const from = (chat: number) => ({ id: chat, is_bot: false, first_name: "Fictional" });
const privateChat = (chat: number) => ({ id: chat, type: "private", first_name: "Fictional" });
const now = () => Math.floor(Date.now() / 1000);
/** Telegram sends an unanswered or refused update again with the same id, and so does this: a slow machine must not read as a broken app. */
async function redelivering(call: () => Promise<Response>) {
  for (let i = 0; ; i++) {
    const response = await call().catch(() => null);
    if ((response && response.status < 500) || i === 5) return response ?? call();
    await new Promise((r) => setTimeout(r, 2000));
  }
}
/** One signed update, as Telegram delivers it. */
export const deliver = (body: unknown, secret = BOT.secret) => redelivering(() => fetch(`${env.site}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(body) }));
export const textUpdate = (chat: number, text: string) => ({ update_id: ++update, message: { message_id: ++update, date: now(), from: from(chat), chat: privateChat(chat), text } });
/** A typed answer using Telegram's reply affordance, correlated to the exact bot prompt. */
export const replyUpdate = (chat: number, promptId: number, text: string) => {
  const event = textUpdate(chat, text);
  return { ...event, message: { ...event.message, reply_to_message: { message_id: promptId, date: now(), from: { id: BOT.id, is_bot: true, first_name: "Noreon", username: BOT.username }, chat: privateChat(chat), text: "Nurse prompt" } } };
};
export const pressUpdate = (chat: number, messageId: number, data: string) => ({ update_id: ++update, callback_query: { id: `cb_${++update}`, from: from(chat), chat_instance: "-555", data,
  message: { message_id: messageId, date: now(), from: { id: BOT.id, is_bot: true, first_name: "Noreon", username: BOT.username }, chat: privateChat(chat), text: "Zoe card", has_protected_content: true } } });
export const answerTo = async (update: { callback_query: { id: string } }) => (await seen()).calls.filter((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === update.callback_query.id);
export const contactUpdate = (chat: number, phone: string) => ({ update_id: ++update, message: { message_id: ++update, date: now(), from: from(chat), chat: privateChat(chat), contact: { phone_number: phone, first_name: "Fictional", user_id: chat } } });

export async function say(chat: number, text: string) {
  const response = await deliver(textUpdate(chat, text));
  expect(response.status, "the webhook stored the update").toBe(200);
}

export async function sent(chat: number, method = "sendMessage") { return (await seen()).calls.filter((c) => c.method === method && c.body.chat_id === chat); }
export const texts = async (chat: number) => (await sent(chat)).map((c) => String(c.body.text));

/** A dose time due now, for member_medicines and plan medicines: five minutes ago, or midnight when today is younger than that. */
export const dueNow = `array[to_char(greatest((clock_timestamp() at time zone 'Asia/Yerevan')-interval '5 minutes',date_trunc('day',clock_timestamp() at time zone 'Asia/Yerevan')),'HH24:MI')::time]`;
/** The Telegram card messages sent to this chat. */
export const cards = async (chat: number) => (await sent(chat)).filter((c) => c.body.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data));
/** Plain logging is a fixed logistics reply with no model call; the dose still needs a card press. */
export async function askForDoseCard(chat: number, id: string) {
  await say(chat, "I took my pill, can you log it");
  await zoeFinished(id);
  expect(runs(id), "the message ended as a fixed logging reply").toBe("chatted/logging_request_no_model");
  await expect.poll(async () => { await sweep(); return (await cards(chat)).length; }, "the card arrives").toBe(1);
  return (await cards(chat))[0];
}
/** The doctor's real reply: write, review (which saves the draft), approve, then the real send sweep. */
export async function doctorReplies(page: Page, memberId: string, text: string) {
  await page.goto(`${env.site}/staff/real/conversations/${memberId}?locale=en`);
  await page.getByLabel("Reply to the member").fill(text);
  // The private summary is optional and sits in a disclosure; "Review exact reply" saves the draft.
  await page.locator("summary", { hasText: "Private summary (optional)" }).click();
  await page.getByLabel("Private factual summary").fill("The member asked a question. Fictional summary.");
  await page.getByRole("button", { name: "Review exact reply" }).click();
  await page.getByRole("button", { name: "Approve exact reply" }).click();
  await expect(page.getByRole("heading", { name: "Approved replies and delivery" })).toBeVisible();
  await expect.poll(() => sql(`select count(*) from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id join public.conversations c on c.id=d.conversation_id where c.member_id='${memberId}'`)).not.toBe("0");
}
/** Who is who: each person's chat, member id and sign-in. */
export function person(name: keyof typeof telegramPeople) {
  const n = telegramPeople[name][0];
  return { chat: chatOf(n), id: fixtureId(n), name, account: accounts[name] };
}
/** The real cron sweep: sends queued replies and processes whatever the webhook's own sweep left. */
export async function sweep() { await cron("telegram/dispatch"); }
export const zoeCron = () => cron("zoe/run");
async function cron(job: string) {
  const r = await redelivering(() => fetch(`${env.site}/api/internal/${job}`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  expect(r.status, `${job} ran`).toBe(200);
}
/** Runs Zoe's real cron and the send sweep until this person's newest message has a finished run. The webhook's own sweep leaves Zoe to the cron when short of time. */
export async function zoeFinished(id: string) {
  await expect.poll(async () => {
    await zoeCron(); await sweep();
    return sql(`select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
      where c.member_id='${id}' and m.seq=(select max(x.seq) from public.conversation_messages x where x.conversation_id=c.id and x.source='telegram_member')
      and exists(select 1 from public.zoe_runs r where r.conversation_id=c.id and r.message_seq=m.seq and r.state='finished')`);
  }, { intervals: [500, 2000, 4000], timeout: 120_000 }).toBe("1").catch((error) => {
    // IDs and machine states only: distinguish a rejected finish from a missing message or claim.
    const state = sql(`select coalesce(json_agg(json_build_object('messageId',m.id,'seq',m.seq,
      'runId',r.id,'state',r.state,'tier',r.tier,'outcome',r.outcome,'reason',r.reason_code))::text,'[]')
      from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
      left join public.zoe_runs r on r.conversation_id=c.id and r.message_seq=m.seq
      where c.member_id='${id}' and m.source='telegram_member'
      and m.seq=(select max(x.seq) from public.conversation_messages x where x.conversation_id=c.id and x.source='telegram_member')`);
    throw new Error(`Zoe did not finish the newest Telegram message: ${state}`, { cause: error });
  });
  await sweep();
}
/** This person's conversation: source and text of each stored message. */
export const stored = (id: string) => sql(`select coalesce(string_agg(m.source||':'||m.body,E'\\n' order by m.seq),'') from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${id}'`);
/** Zoe signs her Telegram texts in the member's language (lib/brand.ts zoeSignature, _zoe_text_enqueue). */
export const ZOE_SIGNATURES = ["Zoe: ", "Զոյա՝ ", "Зоя: "] as const;
export const isZoeText = (t: string) => ZOE_SIGNATURES.some((s) => t.startsWith(s));
export const zoeSaid = async (chat: number) => (await texts(chat)).filter(isZoeText);
export const runs = (id: string) => sql(`select coalesce(string_agg(coalesce(outcome,state)||'/'||coalesce(reason_code,''),',' order by message_seq,started_at),'') from public.zoe_runs where member_id='${id}'`);
