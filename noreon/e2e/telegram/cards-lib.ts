// Helpers for the card journeys: reading what the fake Telegram saw, pressing buttons, and the limits every message must keep.
import { expect, sql } from "../fixtures";
import { CHIP } from "../../lib/zoe-chat-actions/copy";
import { allCalls, answerTo, deliver, person, pressUpdate, say, sweep, zoeFinished, type Call } from "./bot";

const units = (s: string) => s.length; // JS length is UTF-16 code units, which is how Telegram counts the 4096.
const ARMENIAN = /[Ա-֏]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

/** What every message the app sends must satisfy, whatever the card. Returns the problems found, empty when none. */
export function problems(call: Call, locale?: "hy" | "en"): string[] {
  const out: string[] = [], b = call.body;
  if (call.method === "sendMessage" || call.method === "editMessageText") {
    const t = b.text ?? "";
    if (units(t) < 1) out.push("empty text");
    if (units(t) > 4096) out.push(`text ${units(t)} units > 4096`);
    if (b.parse_mode) out.push(`parse_mode ${b.parse_mode}`);
    if (/undefined|NaN|\[object|Invalid Date|\bnull\b/.test(t)) out.push("leaked placeholder in text");
    if (/—|!/.test(t)) out.push("em dash or exclamation mark in text");
    if (EMOJI.test(t)) out.push("emoji in text");
    const rows = b.reply_markup?.inline_keyboard ?? [];
    if (rows.flat().length > 100) out.push("more than 100 buttons");
    for (const row of rows) {
      if (row.length > 8) out.push("more than 8 buttons in a row");
      for (const k of row) {
        if (k.callback_data !== undefined && (Buffer.byteLength(k.callback_data) < 1 || Buffer.byteLength(k.callback_data) > 64)) out.push(`callback_data ${Buffer.byteLength(k.callback_data)} bytes`);
        if (!k.text || k.text.length > 64) out.push(`button text length ${k.text?.length}`);
      }
    }
    if (locale === "hy" && !ARMENIAN.test(t)) out.push("Armenian member, no Armenian letters");
    if (locale === "en" && ARMENIAN.test(t)) out.push("English member, Armenian letters in the text");
  }
  if (call.method === "answerCallbackQuery" && b.text !== undefined && units(b.text) > 200) out.push("answer text over 200");
  return out;
}

/** English wording must not appear in an Armenian member's card chrome, and the reverse. Checks the fixed lines only. */
export function wrongLanguageLines(text: string, locale: "hy" | "en"): string[] {
  const other = locale === "hy" ? "en" : "hy";
  const lines = Object.values(CHIP).map((l) => l[other]);
  return lines.filter((l) => l.length > 6 && text.includes(l));
}

export const buttons = (call: Call) => (call.body.reply_markup?.inline_keyboard ?? []).flat();
export const labels = (call: Call) => buttons(call).map((k) => k.text);
export const refOf = (call: Call, text: string | RegExp) => {
  const k = buttons(call).find((b) => (typeof text === "string" ? b.text === text : text.test(b.text)));
  if (!k) throw new Error(`No button ${text} on ${JSON.stringify(labels(call))}`);
  return k.callback_data;
};
/** Everything the app said to this chat so far that breaks a limit. */
export async function chatProblems(chat: number, locale?: "hy" | "en") {
  const calls = (await allCalls()).filter((c) => c.body.chat_id === chat || c.method === "answerCallbackQuery");
  return calls.flatMap((c) => problems(c, locale).map((p) => `${c.method}: ${p} :: ${(c.body.text ?? "").slice(0, 60)}`));
}

/** Types something and runs Zoe and the send sweep until her run has finished and the card (if any) is out. */
export async function typeAndSettle(who: Parameters<typeof person>[0], text: string) {
  const m = person(who);
  await say(m.chat, text);
  await zoeFinished(m.id);
  await sweep();
  return m;
}

/** A press, as Telegram delivers it, then the sweep that runs it. Returns the update, for answers(). */
export async function press(chat: number, messageId: number, data: string) {
  const u = pressUpdate(chat, messageId, data);
  expect((await deliver(u)).status).toBe(200);
  await sweep();
  return u;
}
export const answers = async (u: { callback_query: { id: string } }) => (await answerTo(u)).map((c) => c.body.text ?? "");
export const edits = async (chat: number) => (await allCalls()).filter((c) => c.method === "editMessageText" && c.body.chat_id === chat);

/** The member's saved readings, oldest first. */
export const readings = (id: string) => sql(`select coalesce(string_agg(systolic||'/'||diastolic||'/'||coalesce(pulse::text,'-'),',' order by measured_at,id),'') from public.patient_measurements where user_id='${id}'`);
export const cardRows = (id: string) => sql(`select coalesce(string_agg(kind||':'||state||':'||coalesce(source_seq::text,'-'),',' order by created_at),'') from public.zoe_chat_cards where member_id='${id}'`);
/** Unlinks a member exactly as the app's "Disconnect Telegram" does: the member's own session calling telegram_unlink(). */
export const unlinkSql = (id: string) => sql(`begin; select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true); set local role authenticated; select public.telegram_unlink(); commit;`);
