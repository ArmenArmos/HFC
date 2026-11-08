"use client";
import { useRef, useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { saveProfileFromCard } from "@/lib/zoe-chat-actions/onboarding-actions";
import { COMMON, MEDICINES, PROFILE, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import type { ValidCard, ZoeCard } from "@/lib/zoe-chat-actions/registry";
import type { SavedProfile } from "@/lib/zoe-chat-actions/thread";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
import { DialogTurn } from "./dialog-turn";

const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const clock = (time: string) => time.replace(/^0/, "");
/** "Text, 7:00 to 22:00": what the member chose, in their own message. */
export const profileWords = (l: CardLocale, v: SavedProfile) => say(l, PROFILE.said(say(l, v.channel === "voice" ? PROFILE.voice : PROFILE.text), clock(v.wake), clock(v.sleep))) + (v.caregiver ? `, ${say(l, PROFILE.caregiverSaid)}` : "");

export function SavedProfileTurn({ saved, locale: l, time, onMedicines }: { saved: SavedProfile; locale: CardLocale; time: string; onMedicines?: (() => void) | null }) {
  return <DialogTurn action={profileWords(l, saved)} time={time}>
    <p data-zoe-profile-saved>{say(l, PROFILE.reply)}</p>
    {onMedicines && <button type="button" className="cv2-link" onClick={onMedicines}>{say(l, MEDICINES.offer)}</button>}
  </DialogTurn>;
}

export function ProfileCard({ card, locale: l, onCard, onAct }: { card: Extract<ValidCard, { kind: "profile" }>; locale: CardLocale; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void }) {
  const [channel, setChannel] = useState<"text" | "voice" | null>(null);
  const [wake, setWake] = useState(card.snapshot.wake), [sleep, setSleep] = useState(card.snapshot.sleep);
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null), [contactBad, setContactBad] = useState(false);
  const [busy, start] = useTransition();
  // One operation per card: a retry repeats the same save.
  const [opId] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const [unsure, setUnsure] = useState(false);
  const locked = busy || unsure;
  if (card.state === "done") return null;
  const save = () => {
    if (!channel || sending.current) return;
    const contact = { name: name.trim(), phone: phone.trim() };
    const bad = (!!contact.name || !!contact.phone) && !(contact.name && PHONE.test(contact.phone));
    setContactBad(bad);
    if (bad) { setProblem(say(l, PROFILE.badContact)); return; }
    if (wake === sleep) { setProblem(say(l, PROFILE.sameTimes)); return; }
    sending.current = true;
    onAct(card.id, true);
    start(async () => {
      setProblem(null);
      let r: Awaited<ReturnType<typeof saveProfileFromCard>> | null = null;
      try { r = await saveProfileFromCard({ cardId: card.id, opId, channel, wake, sleep, caregiver: contact.name ? contact : null }); }
      catch (error) {
        if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error;
        window.dispatchEvent(new Event(CARD_REPLY_LOST));
      }
      if (r?.card) onCard(r.card);
      if (r?.status !== "ok") {
        // The answer may have landed: only these same details can go again, so the form holds still until they have.
        setUnsure(true);
        setProblem(r === null ? say(l, COMMON.unconfirmed) : r.status === "signed_out" ? "signed_out" : r.status === "stale" ? say(l, COMMON.staleInChat) : r.status === "closed" ? say(l, COMMON.closed) : say(l, COMMON.saveFailed));
        if (r) onAct(card.id, false);
      }
      sending.current = false;
    });
  };
  return <article className="cv2-msg cv2-zoe" data-zoe-card="profile" data-chat-card-id={card.id} data-state="open" onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
    <section className="cv2-reading cv2-block" aria-label={say(l, PROFILE.channel)}>
      <h3><MessageCircle size={18} aria-hidden />{say(l, { en: "How should we reach you?", hy: "Ինչպե՞ս կապվենք ձեզ հետ", ru: "Как с вами связаться?" })}</h3>
      <p>{say(l, PROFILE.lead)}</p>
      <fieldset disabled={locked}>
        <legend>{say(l, PROFILE.channel)}</legend>
        <div className="cv2-seg">{(["text", "voice"] as const).map(id => <button type="button" key={id} aria-pressed={channel === id} onClick={() => setChannel(id)}>{say(l, id === "text" ? PROFILE.text : PROFILE.voice)}</button>)}</div>
      </fieldset>
      <div className="cv2-pair">
        <label className="cv2-field">{say(l, PROFILE.wake)}<input type="time" value={wake} disabled={locked} onChange={event => setWake(event.target.value)} /></label>
        <label className="cv2-field">{say(l, PROFILE.sleep)}<input type="time" value={sleep} disabled={locked} onChange={event => setSleep(event.target.value)} /></label>
      </div>
      <details open={contactBad || undefined}>
        <summary>{say(l, PROFILE.caregiver)}</summary>
        <div>
          <p className="cv2-hint">{say(l, PROFILE.caregiverHint)}</p>
          <label className="cv2-field">{say(l, PROFILE.name)}<input type="text" autoComplete="off" maxLength={80} value={name} disabled={locked} aria-invalid={contactBad && !name.trim()} onChange={event => setName(event.target.value)} /></label>
          <label className="cv2-field">{say(l, PROFILE.phone)}<input type="tel" autoComplete="off" maxLength={20} value={phone} disabled={locked} aria-invalid={contactBad && !PHONE.test(phone.trim())} onChange={event => setPhone(event.target.value)} /></label>
        </div>
      </details>
      <button type="button" className="cv2-reading-save" disabled={busy || !channel} aria-busy={busy} onClick={save}>{say(l, PROFILE.save)}</button>
      {problem === "signed_out" ? <SignInEnded locale={l} /> : problem && <p role="alert">{problem}</p>}
    </section>
  </article>;
}
