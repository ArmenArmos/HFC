"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DayDivider, MemberBubble, Note, Thread, Typing, ZoeTurn } from "../thread";
import { KIT, t, type KitLocale, type Line } from "../copy";

/**
 * The preview's script runner. A journey is a list of steps; each step is one Zoe turn that may post a card and
 * may ask one thing. Answering posts the member's bubble, removes the control (or leaves its snapshot) and Zoe
 * types the next turn. Nothing here calls the server: a "write" waits half a second and, with failures on, fails
 * once so the error and retry state can be seen.
 */
export type Ctx = { l: KitLocale; answers: Record<string, unknown> };
export type Act = {
  /** Post the member's answer (null posts no bubble) and move on; returns the error line for a failed write. */
  answer: (said: string | null, value?: unknown, next?: string | null) => Promise<string | null>;
  /** Go back to a step ("Change an answer"): nothing is saved here, so nothing can fail. */
  revisit: (said: string, value: string) => Promise<string | null>;
};
export type Voice = { kind: "nurse" | "doctor"; name: Line; initials: Line; role: Line };
export type Step = {
  id: string;
  day?: Line;
  voice?: Voice;
  at: string;
  progress?: (c: Ctx) => string;
  say?: (c: Ctx) => string[];
  urgent?: boolean;
  /** What this turn opens with, before its words (the done row of the step before). */
  lead?: (c: Ctx) => ReactNode;
  /** A snapshot card posted with the turn; it stays as it was. */
  card?: (c: Ctx) => ReactNode;
  /** The live control; only the newest turn has one. */
  ask?: (c: Ctx, act: Act) => ReactNode;
  /** What the control leaves behind once answered (a card in its done state), if anything. */
  keep?: (c: Ctx) => ReactNode;
  /** A write: with failures on, the first answer fails. */
  writes?: boolean;
  /** The next step's id; null ends the journey. Default: the following step. */
  next?: (value: unknown, c: Ctx) => string | null;
};
export type Journey = { key: string; chip: Line; steps: Step[] };

/** A posted turn is drawn once, from a copy of the answers at that moment: later answers never redraw it. */
type Posted = { step: Step; said: string | null; view: ReactNode };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const END: Line = { hy: "Այս ճանապարհն ավարտվեց։ Ընտրեք մեկ ուրիշը ներքևում։", en: "That is the whole journey. Choose another below.", ru: "Этот сценарий закончен. Выберите другой внизу." };

export function Conversation({ journey, locale: l, failures }: { journey: Journey; locale: KitLocale; failures: boolean }) {
  const [posted, setPosted] = useState<Posted[]>([]);
  const [current, setCurrent] = useState<number | null>(0);
  const [typing, setTyping] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const question = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const step = current === null ? null : journey.steps[current];

  // A new question takes focus on its text (not its control), so a screen reader reads the question first.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!typing) question.current?.focus({ preventScroll: true });
    // To the very bottom, so the dock sits in flow under the newest turn and never covers its button.
    const root = document.scrollingElement;
    if (root) window.scrollTo({ top: root.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [current, typing]);

  const turn = (s: Step, run: boolean, live: boolean, x: Ctx) => (
    <>
      {s.day && <DayDivider label={t(l, s.day)} />}
      <ZoeTurn ref={live ? question : undefined} locale={l} voice={s.voice?.kind ?? "zoe"} name={s.voice && t(l, s.voice.name)} initials={s.voice && t(l, s.voice.initials)}
        role={s.voice && t(l, s.voice.role)} run={run && !s.day} progress={s.progress?.(x)} lead={s.lead?.(x)} say={s.say?.(x)} urgent={s.urgent} at={s.at}>
        {s.card?.(x)}
        {live ? s.ask?.(x, act(s)) : s.keep?.(x)}
      </ZoeTurn>
    </>
  );
  const act = (s: Step): Act => {
    const move = async (said: string | null, value?: unknown, next?: string | null) => {
      const frozen: Ctx = { l, answers: { ...answers, [s.id]: value ?? said, [`said:${s.id}`]: said } };
      const to = next !== undefined ? next : s.next ? s.next(value, frozen) : journey.steps[journey.steps.indexOf(s) + 1]?.id ?? null;
      setAnswers(frozen.answers);
      const run = posted.length > 0 && posted[posted.length - 1].said === null && posted[posted.length - 1].step.voice === s.voice;
      setPosted(p => [...p, { step: s, said, view: turn(s, run, false, frozen) }]);
      setTyping(true);
      setCurrent(null);
      await wait(650);
      setTyping(false);
      setCurrent(to === null ? null : journey.steps.findIndex(x => x.id === to));
      return null;
    };
    return {
      answer: async (said, value, next) => {
        if (s.writes) {
          await wait(500);
          if (failures && !failed.includes(s.id)) { setFailed(f => [...f, s.id]); return t(l, KIT.saveFailed); }
        }
        return move(said, value, next);
      },
      revisit: (said, value) => move(said, value, value),
    };
  };

  // A turn that asks nothing (Zoe tells, or posts a card) is followed by the next one after a short pause.
  useEffect(() => {
    if (!step || step.ask || typing) return;
    const id = setTimeout(() => { void act(step).answer(null); }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, typing]);

  // The posted history is the polite log; the live turn sits outside it, so typing in a control is not announced.
  return (
    <>
      <Thread label={t(l, KIT.zoe)}>
        {posted.map((p, i) => (
          <div key={i} className="contents">
            {p.view}
            {p.said !== null && <MemberBubble locale={l} text={p.said} at={p.step.at} />}
          </div>
        ))}
        {!typing && current === null && posted.length > 0 && <Note>{t(l, END)}</Note>}
      </Thread>
      {typing && <Typing locale={l} />}
      {/* Consecutive turns of one voice with no member answer between them are one run: the "from" row shows once. */}
      {step && <div className="zk-live">{turn(step, posted.length > 0 && posted[posted.length - 1].said === null && posted[posted.length - 1].step.voice === step.voice, true, { l, answers })}</div>}
    </>
  );
}
