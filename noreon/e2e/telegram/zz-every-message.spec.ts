// Runs last (zz): scans every message the fake Telegram saw during the run against Telegram's limits and the voice rules.
import { expect, test } from "../fixtures";
import { allCalls } from "./bot";
import { problems } from "./cards-lib";
import { telegramPeople, chatOf, FAKE_REPLY } from "./config.mjs";

test("every message the app sent in this run keeps the limits and the member's language", async () => {
  const calls = await allCalls();
  const lang = new Map<number, "hy" | "en">(Object.values(telegramPeople).filter((p) => p[2]).map((p) => [chatOf(p[0] as number), p[2] as "hy" | "en"]));
  const bad: string[] = [];
  for (const c of calls) {
    // The placeholder templates are not card text; only card messages are held to the language rule.
    const isCard = c.method !== "answerCallbackQuery" && (c.body.text ?? "").startsWith("Zoe:") && !Object.values(FAKE_REPLY).some((r) => (c.body.text ?? "").includes(r));
    for (const p of problems(c, isCard ? lang.get(c.body.chat_id ?? 0) : undefined)) bad.push(`${c.method} chat ${c.body.chat_id}: ${p} :: ${(c.body.text ?? "").slice(0, 80).replaceAll("\n", " | ")}`);
  }
  expect(bad).toEqual([]);
  expect(calls.length, "the scan saw messages").toBeGreaterThan(0);
  expect(calls.filter((c) => c.method === "sendMessage" && c.body.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data) && !c.body.protect_content), "every card is protected").toEqual([]);
});
