import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_FOUND, chatHop, profileHop, zoeChatHop, type EntryEnv, type EntryFacts } from "@/lib/patient/entry-routes";
import { newChatHome } from "@/lib/patient/member-chat-config";

// Walks every redirect between the member entry pages for every member state and switch setting and fails on a cycle.
// Production looped chat -> profile -> zoe -> chat on 4 Nov (a member with no saved profile, V2 and V3 on).
type State = { name: string; signedOut?: boolean; facts: EntryFacts };
const states: State[] = [
  { name: "signed out", signedOut: true, facts: { registered: false, urgent: false, profile: false, consent: false } },
  { name: "no profile", facts: { registered: false, urgent: false, profile: false, consent: false } },
  { name: "profile without consent", facts: { registered: false, urgent: false, profile: true, consent: false } },
  { name: "consent without assessment", facts: { registered: false, urgent: false, profile: true, consent: true } },
  { name: "questionnaire not done", facts: { registered: true, urgent: false, profile: true, consent: true } },
  { name: "complete", facts: { registered: true, urgent: false, profile: true, consent: true } },
  { name: "urgent", facts: { registered: true, urgent: true, profile: true, consent: true } },
];
const pages = ["chat", "profile", "zoe", "zoe?card", "dashboard", "questions", "urgent"] as const;
type Page = (typeof pages)[number];
const bools = [false, true];
const envs: EntryEnv[] = bools.flatMap(chatOnly => bools.flatMap(chatV2 => bools.flatMap(v3 => bools.map(emergencyCard => ({ chatOnly, chatV2, v3, emergencyCard })))));

const SIGN_IN = "/patient";
function toPage(path: string): Page | "terminal" {
  if (path === NOT_FOUND || path === SIGN_IN) return "terminal";
  if (path.startsWith("/patient/zoe?card")) return "zoe?card";
  const base = path.split("?")[0];
  const found = pages.find(p => p !== "zoe?card" && `/patient/${p}` === base);
  if (!found) throw Error(`unknown redirect target ${path}`);
  return found;
}
type Rules = { zoe: (f: EntryFacts, env: EntryEnv, card: boolean) => string | null };
const modeled: Rules = {
  // The new-chat hop is the real helper; the rest is the older chat-only page (app/patient/zoe/page.tsx).
  zoe: (f, env, card) => {
    const params = card ? { card: "account" } : {};
    const chat = zoeChatHop(f, env, params);
    if (chat) return chat;
    if (env.chatOnly && f.urgent) return "/patient/urgent";
    return null;
  },
};
function hop(page: Page, state: State, env: EntryEnv, rules: Rules): string | null {
  if (state.signedOut) return SIGN_IN;
  const f = state.facts;
  switch (page) {
    case "chat": return chatHop(f, env);
    case "profile": return profileHop(f, env);
    case "zoe": return rules.zoe(f, env, false);
    case "zoe?card": return rules.zoe(f, env, true);
    case "dashboard": return !env.chatOnly ? null : !f.registered ? "/patient/profile" : f.urgent ? "/patient/urgent" : "/patient/zoe";
    case "questions": return env.chatOnly ? "/patient/zoe?card=questionnaire" : null;
    case "urgent": return f.urgent ? null : "/patient/questions";
  }
}
function walk(start: Page, state: State, env: EntryEnv, rules: Rules): string[] | null {
  const seen: Page[] = [];
  let page: Page | "terminal" = start;
  for (let i = 0; i < 12; i++) {
    if (page === "terminal") return null;
    if (seen.includes(page)) return [...seen, page];
    seen.push(page);
    const to = hop(page, state, env, rules);
    if (to === null) return null;
    page = toPage(to);
  }
  return seen;
}
function cycles(rules: Rules) {
  const found: string[] = [];
  for (const state of states) for (const env of envs) for (const start of pages) {
    const path = walk(start, state, env, rules);
    if (path) found.push(`${state.name} | ${JSON.stringify(env)} | ${path.join(" -> ")}`);
  }
  return found;
}

const loops = cycles(modeled);
assert.deepEqual(loops, [], `Redirect cycles between the entry pages:\n${loops.slice(0, 5).join("\n")}`);

// The walker must catch the 4 Nov production loop: /patient/zoe that sent every member to the new chat.
const buggy: Rules = { zoe: (f, env, card) => newChatHome(card ? { card: "account" } : {}, { NOREON_ZOE_APP_V3: env.v3 ? "true" : undefined, NOREON_MEMBER_CHAT_V2: env.chatV2 ? "true" : undefined }) ? "/patient/chat" : null };
const buggyLoops = cycles(buggy);
assert.ok(buggyLoops.some(l => l.startsWith("no profile") && l.includes("chat -> profile -> zoe -> chat")), "the walker finds chat -> profile -> zoe -> chat in the old rule");

// The pages use the helpers the walker models.
const read = (p: string) => readFileSync(p, "utf8");
assert.match(read("app/patient/zoe/page.tsx"), /zoeChatHop\(/);
assert.doesNotMatch(read("app/patient/zoe/page.tsx"), /redirect\("\/patient\/chat"\)/, "zoe never sends to the chat without the helper");
assert.match(read("app/patient/profile/page.tsx"), /profileHop\(/);
const chat = read("app/patient/chat/page.tsx");
assert.match(chat, /requireRegisteredForRender\(\)/, "the chat page sends unregistered members to the profile step");
assert.match(chat, /patientPresentation\(assessment\)\.urgent && !emergencyCard\) redirect\("\/patient\/urgent"\)/, "and urgent ones to the urgent page, as chatHop models");
assert.match(read("lib/patient/repository.ts"), /redirect\("\/patient\/profile"\)/);
// The unregistered member is shown the older chat-only page at /patient/zoe, which runs the profile step itself.
const zoeHop = zoeChatHop({ registered: false, urgent: false }, { chatV2: true, v3: true, emergencyCard: false }, {});
assert.equal(zoeHop, null, "an unregistered member is not sent to the chat");
assert.equal(zoeChatHop({ registered: true, urgent: false }, { chatV2: true, v3: true, emergencyCard: false }, {}), "/patient/chat");
assert.equal(zoeChatHop({ registered: true, urgent: false }, { chatV2: true, v3: true, emergencyCard: false }, { card: "progress" }), null, "a card deep link stays");
assert.equal(zoeChatHop({ registered: true, urgent: false }, { chatV2: true, v3: true, emergencyCard: false }, { view: "classic" }), null, "?view=classic stays");
assert.equal(zoeChatHop({ registered: true, urgent: true }, { chatV2: true, v3: true, emergencyCard: false }, {}), null, "an urgent member the chat would send to /patient/urgent is not sent to the chat first");
console.log(`check-entry-routes: no redirect cycle among ${pages.length} entry pages, ${states.length} member states and ${envs.length} switch settings; the old rule loops chat -> profile -> zoe -> chat`);
