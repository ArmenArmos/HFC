// Loaded into the app server for the Telegram suite only, with the network guard. Two swaps, no product code touched:
//  1. https requests to api.telegram.org go to fake-api.mjs on this machine.
//  2. Zoe's model calls reach this stand-in through the AI SDK's own default provider hook, never a network.
// Zoe keeps a stand-in provider's text from members (lib/zoe/server.ts), so the plain fake provider cannot reach the
// answer paths. Here the app runs as on staging, in gateway mode, and every model call ends in this file and is recorded.
import "../net-guard.mjs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { FAKE_REPLY } from "./config.mjs";

const port = Number(process.env.NOREON_E2E_TELEGRAM_PORT);
const control = (path, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
    let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => resolve(JSON.parse(text || "{}")));
  });
  req.on("error", reject); req.end(JSON.stringify(body));
});

const realRequest = https.request;
https.request = (options, ...rest) => (options?.hostname === "api.telegram.org"
  ? http.request({ host: "127.0.0.1", port, path: options.path, method: options.method, headers: options.headers, signal: options.signal }, ...rest)
  : realRequest(options, ...rest));
syncBuiltinESMExports();

const PURPOSES = [
  ["urgency_check", "independent second safety check"],
  ["topic_check", "You sort messages in a member"],
  ["judge", "You check one message that an AI"],
  ["health_summary", "You write the doctor's summary"],
  ["reply_draft", "You prepare a reply for the member's doctor"],
  ["conversation", "has written a short social message"],
  ["symptom_intake", "A member has told you about a symptom"],
  ["health_answer", "You are Zoe, Noreon's AI health coach"],
  ["intake_draft", "You talk with members and help their doctor"],
];
const LANGUAGE = { "Armenian (hy)": "hy", "Russian (ru)": "ru", "English (en)": "en" };
const FLAGS = ["advice", "medicine_or_dose", "diagnosis_or_cause", "reassurance", "discourages_care", "time_promise", "claims_human_or_doctor", "claims_status", "unsafe_instruction", "other_unsafe",
  "diagnosis", "treatment", "risk_or_targets", "tests_or_interpretation", "false_reassurance", "urgency_understated", "lifestyle_or_sport", "disrespect", "promise_or_identity", "symptom_causes"];

function standIn(purpose, lang) {
  const reply = FAKE_REPLY[lang];
  switch (purpose) {
    case "urgency_check": return { emergency: true, urgency: "emergency", reason: "stand-in" };
    case "topic_check": return { topic: "same", doctor_matter: "unsure" };
    case "judge": return { ...Object.fromEntries(FLAGS.map((f) => [f, false])), reason: "stand-in" };
    case "health_summary": return { summary: { asked: "The member asked a health question (stand-in).", questions_asked: null } };
    case "reply_draft": return { asked: "The member asks what to do (stand-in).", acknowledgement_id: "A1", plan_item_ids: [], doctor_decides: [], outside_plan: true, language: lang };
    case "conversation": return { reply, category: "other", language: lang };
    case "symptom_intake": return { reply: "Thank you.", asked: [], answers: [], member_stopped: false, red_flag_suspected: false, about_someone_else: false, language: lang };
    case "health_answer": return { reply, urgency: "planned", forward: "none", forward_reason: "none", summary: { asked: "The member asked a health question (stand-in)." }, language: lang };
    case "intake_draft": return { summary: "Stand-in summary.", draft_reply: null, no_draft_reason_code: "needs_doctor", missing_info: [], language: lang, direct_answer: null };
    default: return null;
  }
}

const textOf = (prompt) => prompt.flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((p) => p.type === "text").map((p) => p.text))).join("\n");
const model = (modelId) => ({
  specificationVersion: "v4", provider: "noreon.e2e", modelId, supportedUrls: {},
  async doGenerate({ prompt }) {
    const system = prompt.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const user = textOf(prompt.filter((m) => m.role !== "system"));
    const purpose = PURPOSES.find(([, mark]) => system.includes(mark))?.[0] ?? "unknown";
    const lang = LANGUAGE[/Reply language: ([^.\n]+)\./.exec(user)?.[1]] ?? "en";
    // The test may script this purpose's next answer; the model calls are recorded either way, member text included.
    const { override } = await control("/__e2e/model", { purpose, modelId, user });
    const answer = { ...standIn(purpose, lang), ...override };
    if (purpose === "unknown") throw new Error("Unknown model purpose in the E2E stand-in");
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
    return { content: [{ type: "text", text: JSON.stringify(answer) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [], response: { id: `e2e-${purpose}`, modelId, timestamp: new Date() } };
  },
});
globalThis.AI_SDK_DEFAULT_PROVIDER = { specificationVersion: "v4", languageModel: model };
