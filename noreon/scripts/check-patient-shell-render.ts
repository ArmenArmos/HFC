import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node20.
import { registerHooks } from "node:module";
// Only the browser pathname and provider state are supplied; render the real shell,
// links, icons and translated labels. No navigation or writes occur in SSR.
let pathname = "/patient/dashboard";
const pendingScope = globalThis as typeof globalThis & { __shellTestPending?: boolean };
pendingScope.__shellTestPending = false;
const linkModule = import.meta.resolve("next/link");
const hook = registerHooks({
  resolve(specifier: string, context: object, next: (s: string, c: object) => object) {
    if (specifier === "next/image") return { url: `data:text/javascript,import {createElement} from "${import.meta.resolve("react")}";export default function Image({priority,...props}){return createElement("img",props)}`, shortCircuit: true };
    if (specifier === "next/navigation") return { url: `data:text/javascript,
      export const usePathname=()=>globalThis.__shellTestPath;
      export const useSearchParams=()=>new URLSearchParams(globalThis.__shellTestQuery ?? '');
      export const useRouter=()=>({refresh(){throw Error('Unexpected refresh during render')},replace(){throw Error('Unexpected navigation during render')}});
      export const redirect=()=>{throw Error('Unexpected redirect during render')};
      export const notFound=()=>{throw Error('Unexpected notFound during render')};
    `, shortCircuit: true };
    if (specifier === "next/link") return { url: `data:text/javascript,export {default} from "${linkModule}";export const useLinkStatus=()=>({pending:!!globalThis.__shellTestPending});`, shortCircuit: true };
    return next(specifier, context);
  },
});
try {
  const { PatientShell } = await import("@/components/patient/patient-shell");
  const { MemberChatModeProvider } = await import("@/components/patient/member-chat-mode");
  const { ProgressNavigation } = await import("@/components/patient-care/progress-navigation");
  for (const locale of ["en", "hy"] as const) {
    for (pathname of ["/patient/dashboard", "/patient/progress", "/patient/zoe", "/patient/team", "/patient/care", "/patient/account"]) {
      (globalThis as typeof globalThis & { __shellTestPath?: string }).__shellTestPath = pathname;
      const props = { locale, children: "content" };
      const html = renderToStaticMarkup(createElement(PatientShell, props));
      // Zoe is the middle of five destinations in both navigations (founder feedback 17 Oct).
      const order = [...html.matchAll(/class="journey-nav-link[^"]*"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="journey-nav-link/g)].map((m) => m[1] ?? m[2]);
      assert.deepEqual(order, [...Array(2)].flatMap(() => ["/patient/dashboard", "/patient/progress", "/patient/zoe", "/patient/care", "/patient/account"]), "Zoe is the centre item on desktop and mobile");
      assert.equal((html.match(/journey-nav-zoe/g) ?? []).length, 2, "Zoe is marked prominent in both navigations");
      const current = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      assert.equal(current.length, 2, "Each desktop and mobile navigation marks the current destination");
      for (const anchor of current) assert.ok(anchor.includes(`href="${pathname === "/patient/team" ? "/patient/account" : pathname}"`), "Only the current destination is highlighted");
    }
    const props = { locale, children: "content" };
    pendingScope.__shellTestPending = true;
    const pending = renderToStaticMarkup(createElement(PatientShell, props));
    assert.equal((pending.match(/role="status"/g) ?? []).length, 10, "Five core destinations in both navigations expose pending feedback");
    assert.ok(pending.includes(locale === "en" ? "Opening Home" : "Բացվում է՝ Գլխավոր"));
    assert.ok(pending.includes("motion-safe:animate-spin"), "Reduced motion leaves a static indicator");
    const tabs = renderToStaticMarkup(createElement(ProgressNavigation, { locale, active: "tests" }));
    assert.equal((tabs.match(/role="status"/g) ?? []).length, 4, "Each progress tab exposes pending feedback");
    assert.ok(tabs.includes(locale === "en" ? "Opening Tests" : "Բացվում է՝ Թեստեր"));
    pendingScope.__shellTestPending = false;
    const idleTabs = renderToStaticMarkup(createElement(ProgressNavigation, { locale, active: "tests" }));
    assert.ok(!idleTabs.includes('role="status"'), "Idle links make no loading announcement");
  }
  for (const locale of ["en", "hy", "ru"] as const) {
    const globals = globalThis as typeof globalThis & { __shellTestQuery?: string };
    for (const query of ["", "view=classic"]) {
      globals.__shellTestQuery = query;
      const shellProps = { locale, memberName: "Test Member", children: "content" };
      const modeProps = { enabled: true, children: createElement(PatientShell, shellProps) };
      const html = renderToStaticMarkup(createElement(MemberChatModeProvider, modeProps));
      if (query) assert.match(html, /journey-tabbar/);
      else {
        assert.doesNotMatch(html, /journey-tabbar|journey-nav-link|data-tabbar/);
        assert.match(html, /data-member-chat-menu/);
        assert.match(html, /href="tel:103"/);
        for (const path of ["zoe?card=account", "zoe?card=medicines", "zoe?card=questionnaire", "zoe?card=visit", "zoe?card=help", "dashboard?view=classic", "zoe?card=progress", "zoe?card=plan", "zoe?card=results", "zoe?card=previous_plans", "zoe?card=bp_week", "zoe?card=bp", "zoe?card=lessons", "zoe?card=earlier", "zoe?card=result_history", "zoe?card=reports", "zoe?card=team", "zoe?card=account&amp;section=reminders", "zoe?card=account&amp;section=language"]) assert.ok(html.includes(`href="/patient/${path}"`), `Chat menu includes ${path}`);
        assert.doesNotMatch(html, /href="\/patient\/service"/, "Booking opens a card in chat");
      }
    }
    delete globals.__shellTestQuery;
  }
  console.log("Actual member shell highlights all destinations; supplied pending states render localized feedback for main/progress navigation. Browser checks establish actual Link pending behavior.");
} finally {
  delete pendingScope.__shellTestPending;
  delete (globalThis as typeof globalThis & { __shellTestPath?: string }).__shellTestPath;
  hook.deregister();
}
