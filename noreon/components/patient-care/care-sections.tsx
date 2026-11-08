"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { PatientLocale } from "@/lib/patient/copy";
import { pick } from "@/lib/locale";

const sections = ["plan", "medicines", "appointments"] as const;
type Section = (typeof sections)[number];
const sectionEvent = "noreon-care-section";
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(sectionEvent, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(sectionEvent, listener);
  };
}
/** A server action's refresh drops the hash, which sent a member logging several doses back to Plan after the first. */
let chosen: Section | null = null;
function currentSection(): Section {
  const hash = window.location.hash;
  if (hash === "#medicines" || hash === "#reminders") chosen = "medicines";
  else if (hash === "#appointments") chosen = "appointments";
  else if (hash) chosen = "plan";
  return chosen ?? "plan";
}

/** Server-rendered content stays on the server side of the client boundary. */
export function CareSections({ locale, plan, medicines, visits }: {
  locale: PatientLocale;
  plan: ReactNode;
  medicines: ReactNode;
  visits: ReactNode;
}) {
  const selected = useSyncExternalStore(subscribe, currentSection, () => "plan" as const);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => () => { chosen = null; }, []);
  const labels = pick(locale, { hy: ["Պլան", "Դեղեր", "Այցեր"], en: ["Plan", "Medicines", "Visits"], ru: ["План", "Лекарства", "Визиты"] });
  const contents = [plan, medicines, visits];
  function select(section: Section) {
    const url = new URL(window.location.href);
    url.hash = section;
    // Preserve Next's history state and any query parameters on this page.
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(sectionEvent));
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft") next = (index + sections.length - 1) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    else return;
    event.preventDefault();
    select(sections[next]);
    buttons.current[next]?.focus();
  }
  return <div className="min-w-0 space-y-4">
    <div className="sticky top-0 z-10 bg-background py-1">
      <div role="tablist" aria-label={pick(locale, { hy: "Խնամքի պլանի բաժիններ", en: "Care plan sections", ru: "Разделы плана лечения" })} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {sections.map((section, index) => <button
          key={section}
          ref={element => { buttons.current[index] = element; }}
          type="button"
          role="tab"
          id={`${id}-tab-${section}`}
          aria-controls={`${id}-panel-${section}`}
          aria-selected={selected === section}
          tabIndex={selected === section ? 0 : -1}
          onClick={() => select(section)}
          onKeyDown={event => navigate(event, index)}
          className={`min-h-11 min-w-0 rounded-lg px-2 py-2 text-body2 font-semibold whitespace-normal break-words focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected === section ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >{labels[index]}</button>)}
      </div>
    </div>
    {sections.map((section, index) => <div
      key={section}
      role="tabpanel"
      id={`${id}-panel-${section}`}
      aria-labelledby={`${id}-tab-${section}`}
      hidden={selected !== section}
      tabIndex={0}
      className="min-w-0 space-y-4 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >{contents[index]}</div>)}
  </div>;
}
