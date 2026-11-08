import assert from "node:assert/strict";
import { memberChatOnlyEnabled, memberChatDestination, newChatHome } from "@/lib/patient/member-chat-config";
import { tx } from "@/lib/patient/copy";
import * as cardTargets from "@/lib/zoe-chat-actions/everyday-contract";
import { CHIP } from "@/lib/zoe-chat-actions/copy";
import { NO_CARDS } from "@/lib/zoe-chat-actions/registry";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
  assert.equal(memberChatOnlyEnabled({ NOREON_MEMBER_CHAT_ONLY: value }), false);
}
assert.equal(memberChatOnlyEnabled({ NOREON_MEMBER_CHAT_ONLY: "true" }), true);
assert.equal(memberChatDestination({ enabled: false, complete: true, urgent: false }), null);
assert.equal(memberChatDestination({ enabled: true, view: "classic", complete: true, urgent: false }), null);
assert.equal(memberChatDestination({ enabled: true, complete: false, urgent: true }), "/patient/urgent");
assert.equal(memberChatDestination({ enabled: true, complete: false, urgent: false }), "/patient/zoe");
assert.equal(memberChatDestination({ enabled: true, complete: true, urgent: false }), "/patient/zoe");
console.log("Chat-only flag and routing: exact true, classic, questionnaire and urgent precedence.");

// Exercise the actual route components with only auth/IO/framework boundaries supplied.
const { readFileSync } = await import("node:fs");
const { default: ts } = await import("typescript");
const { default: vm } = await import("node:vm");
const jsx = await import("react/jsx-runtime");
let enabled = true, complete = true, urgent = false, registered = true;
let prompt = { due: true, zoeScreen: true, directAnswers: false }, later = false;
let chatAvailable = true;
let currentUrl = new URL("https://synthetic.invalid/patient/zoe");
const noop = () => null;
const ProfileForm = () => null;
const MemberHomeContent = () => null;
const load = (file: string) => {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (name: string) => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react") return React;
    if (name === "next/link") return { default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { redirect: (to: string) => { throw new Error(`redirect:${to}`); }, usePathname: () => currentUrl.pathname, useSearchParams: () => currentUrl.searchParams };
    if (name === "next/headers") return { cookies: async () => ({ has: () => later, get: () => ({value:"en"}) }) };
    if (name.endsWith("/member-chat-config")) return { memberChatDestination, newChatHome, memberChatOnlyEnabled: () => enabled };
    if (name === "@/lib/patient/auth") return { patientIdentity: async () => ({ userId: "synthetic-member" }) };
    if (name === "@/lib/patient/repository") return {getPatientState:async()=>({profile:registered?{locale:"en",name:"Test Member"}:null,consentAccepted:registered,assessment:registered?{id:"synthetic",revision:0,answers:{},completedAt:complete?"2026-10-31":null}:null})};
    if (name === "@/lib/locale") return {parseLocale:()=>"en"};
    if (name === "@/lib/patient/copy") return { tx };
    if (name === "@/components/patient/profile-form") return { ProfileForm };
    if (name === "@/components/patient/member-home-content") return { MemberHomeContent };
    if (name === "./member-chat-mode") return { useMemberChatMode: () => enabled };
    if (name === "@/components/patient-care/common") return { copy: (l: "en" | "hy" | "ru", en: string, hy: string, ru: string) => tx(l, hy, en, ru) };
    if (name === "@/lib/patient/member-screens-config") return { memberScreensPrototypeEnabled: () => false };
    if (name === "@/lib/patient/validation") return {dateInArmenia:()=>"2026-11-01"};
    if (name.endsWith("/render-data")) return { requireRegisteredForRender: async () => {
      if (!registered) throw new Error("redirect:/patient/profile");
      return { profile: { locale: "en", name: "Test Member" }, assessment: { completedAt: complete ? "2026-10-31" : null } };
    } };
    if (name.endsWith("/presentation")) return { patientPresentation: () => ({ urgent }) };
    if (name.endsWith("/chat-access")) return { readZoeAccess: async () => chatAvailable ? { kind: "chat", thread: { messages: [] } } : { kind: "blocked", reason: "read_failed" } };
    if (name === "@/lib/zoe/member") return { readZoePrompt: async () => prompt };
    if (name.endsWith("/member-screen")) return { zoeEmergencyCardEnabled: () => false };
    if (name.endsWith("/zoe-chat-actions/server")) return { readZoeCards: async () => ({ enabled: false, cards: [] }) };
    if (name === "@/lib/zoe-chat-actions/everyday-contract") return cardTargets;
    if (name === "@/lib/zoe-chat-actions/copy") return { CHIP };
    if (name === "@/lib/zoe-chat-actions/registry") return { NO_CARDS };
    return new Proxy({}, { get: () => noop });
  };
  new vm.Script(code).runInNewContext({ exports, require, process: { env: {} } });
  return exports;
};
const route = (file: string) => load(file).default as (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const entry = route("app/patient/page.tsx");
await assert.rejects(entry({ searchParams: Promise.resolve({}) }), /redirect:\/patient\/dashboard$/);
await assert.rejects(entry({ searchParams: Promise.resolve({ view: "classic" }) }), /redirect:\/patient\/dashboard\?view=classic$/);
const dashboard = route("app/patient/dashboard/page.tsx");
const zoe = route("app/patient/zoe/page.tsx");
for (const [isRegistered, isComplete, isUrgent, expected] of [
  [false, false, false, "profile"], [true, false, false, "zoe"], [true, false, true, "urgent"], [true, true, false, "zoe"],
] as const) {
  registered = isRegistered; complete = isComplete; urgent = isUrgent;
  await assert.rejects(dashboard({ searchParams: Promise.resolve({}) }), new RegExp(`redirect:/patient/${expected}$`));
  if (expected === "urgent") await assert.rejects(zoe({ searchParams: Promise.resolve({}) }), /redirect:\/patient\/urgent$/);
  else await assert.doesNotReject(zoe({ searchParams: Promise.resolve({}) }));
}
registered = true; complete = true; urgent = false;
await assert.doesNotReject(dashboard({ searchParams: Promise.resolve({ view: "classic" }) }));
enabled = false;
await assert.doesNotReject(dashboard({ searchParams: Promise.resolve({}) }));
enabled = true;
// Walk the produced element tree without invoking IO or client components.
const propsOf = (node: import("react").ReactNode, name: string): Record<string, unknown>[] => {
  if (Array.isArray(node)) return node.flatMap(child => propsOf(child, name));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as import("react").ReactElement<Record<string, unknown>>;
  return [ ...(name in element.props ? [element.props] : []), ...propsOf(element.props.children as import("react").ReactNode, name) ];
};
for (const due of [false, true]) for (later of [false, true]) {
  prompt = { ...prompt, due };
  const tree = await zoe({ searchParams: Promise.resolve({}) });
  assert.equal(propsOf(tree, "data-zoe-header").length, 0, "Chat-only has no secondary Zoe/About strip");
  const chat = propsOf(tree, "chatOnly")[0];
  assert.ok(chat);
  assert.equal(!!chat.consent, !(due && !later), "Home consent is the sole prompt when due; Zoe-only grant remains available otherwise");
  const intro = chat.intro as import("react").ReactElement<Record<string, unknown>>;
  assert.equal(intro.props.promptForChat, prompt, "Home and Zoe use one consent read");
}
console.log("Actual route checks: profile/questionnaire/urgent, default and classic, one consent source including later/outdated wording states. IO supplied, no auth/database calls.");

// Unavailable cards now exit through classic Home. Follow that route and its real shell
// navigation, then retain CA2-01: account details must reach the editor, not loop to a card.
const account = route("app/patient/account/page.tsx");
const profile = route("app/patient/profile/page.tsx");
const { PatientShell } = load("components/patient/patient-shell.tsx") as typeof import("../components/patient/patient-shell");
for (chatAvailable of [true, false]) for (const target of new Set(["account", ...cardTargets.MEMBER_CARD_TARGETS])) {
  const fallback = await zoe({ searchParams: Promise.resolve({ card: target }) });
  const card = propsOf(fallback, "selectedCard")[0]?.selectedCard as import("react").ReactNode;
  const exit = propsOf(card ?? fallback, "href").find(props => props.href === "/patient/dashboard?view=classic");
  assert.ok(exit, `${target}: unavailable cards offer classic Home even without chat`);
  currentUrl = new URL(String(exit.href), "https://synthetic.invalid");
  const home = await dashboard({ searchParams: Promise.resolve(Object.fromEntries(currentUrl.searchParams)) });
  assert.ok(React.isValidElement<{ searchParams: Promise<Record<string, string>> }>(home));
  assert.equal(home.type, MemberHomeContent, "Fallback reaches Home content without redirecting to chat");
  assert.equal((await home.props.searchParams).view, "classic", "Home content keeps the classic escape");
  const navigation = renderToStaticMarkup(jsx.jsx(PatientShell, { locale: "en", children: home }));
  assert.match(navigation, /href="\/patient\/account"/, "Classic Home shows account navigation with chat-only enabled");
  const accountPage = await account({ searchParams: Promise.resolve({}) });
  const edit = propsOf(accountPage, "href").find(props => props.children === "Edit my details");
  assert.ok(edit);
  const destination = new URL(String(edit.href), "https://synthetic.invalid");
  assert.equal(destination.pathname, "/patient/profile");
  const editor = await profile({ searchParams: Promise.resolve(Object.fromEntries(destination.searchParams)) });
  assert.ok(editor && typeof editor === "object" && "type" in editor && "props" in editor);
  assert.equal(editor.type, ProfileForm, "Fallback edit reaches the profile form without redirecting to the card");
  const editorProps = editor.props as { profile: { name: string }; expectedRevision: number };
  assert.equal(editorProps.profile.name, "Test Member");
  assert.equal(editorProps.expectedRevision, 0, "Editor receives the saved profile and its revision");
}
console.log("Unavailable cards: every target → classic Home and account navigation → profile editor, with cards disabled and with chat unavailable (mocked IO; real shell rendered).");

// Off-page / unavailable-event fallback must reach the existing care-team contact.
const { MemberChatMenu } = load("components/patient/member-chat-menu.tsx") as typeof import("../components/patient/member-chat-menu");
for (const locale of ["en", "hy", "ru"] as const) {
  const html = renderToStaticMarkup(React.createElement(MemberChatMenu, { locale }));
  assert.ok(html.includes(`href="/patient/team?section=contact" data-chat-action="side_effect"`), `${locale}: side-effect fallback reaches contact, not a medicine list`);
  assert.ok(html.includes(CHIP.side_effect[locale]), `${locale}: side-effect action keeps its translated label`);
  assert.match(html, /href="\/patient\/zoe\?card=account&amp;section=reminders"/, `${locale}: reminders target their settings section`);
  const main = html.match(/data-menu-main[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.equal((main.match(/<a /g) ?? []).length, 8, `${locale}: eight primary menu destinations`);
  assert.match(html, /data-menu-more/, `${locale}: secondary destinations have a More disclosure`);
  assert.match(html, /href="\/patient\/zoe\?card=account&amp;section=language"/, `${locale}: language is directly reachable`);
}
