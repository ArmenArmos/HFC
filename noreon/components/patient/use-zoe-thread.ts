"use client";
import {FOCUS_CHAT_CARD} from '@/lib/zoe-chat-actions/thread-events';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AccountSection } from "./zoe-account";
import { CHAT_TASKS, chatTask } from "@/lib/chat/tasks";
import { MEMBER_CARD_TARGETS, isMemberCardTarget, isEverydayView, type EverydayView } from "@/lib/zoe-chat-actions/everyday-contract";
import { openEverydayCard } from "@/lib/zoe-chat-actions/everyday-actions";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
import { keepDraft, readDraft } from "./tab-draft";
import { openZoeCard } from "@/lib/zoe-chat-actions/actions";
import { CHIP_KINDS, NO_CARDS, type CardKind, type ZoeCards } from "@/lib/zoe-chat-actions/registry";
import { cardOffer, fetchZoeCards, mergeCards, upsertCard, withCards } from "@/lib/zoe-chat-actions/thread";
import { couldBeZoeEmergency, isZoeEmergency, type ZoeEmergencyCheck } from "@/lib/zoe/member-screen";
import { sendZoeChatMessage, startNewZoeQuestion } from "@/app/patient/zoe/chat-actions";
import { answeredCount, keepThreadNotices, canStartNewQuestion, chatItems, fetchZoeThread, pollAfterRead, pollAfterSend, pollDue, pollMayReplace, pollOnReturn, readWithin, ZOE_POLL, ZOE_POLL_IDLE, type ZoeRefusal, type ZoeThread } from "@/lib/zoe/app-chat-contracts";
/** A stable empty list: no member settings card is offered unless the chat switches it on. */
const NO_SETTINGS_KINDS: readonly CardKind[] = [];
type Pending = { requestId: string; text: string; toDoctor: boolean; state: "sending" | "failed"; voiceReceipt?: string; voiceDraft?: boolean; voiceUrgent?: boolean };
type Emergency = { request: string | null; text: string; toDoctor: boolean };
// A stale context gets one second for an authoritative send reply, then local guidance wins.
const EMERGENCY_WAIT_MS = 1_000;
export type Notice = "empty" | "too_long" | "rate_limited" | "unavailable" | ZoeRefusal | "doctor_sent" | null;

export function useZoeThread<Input extends HTMLInputElement | HTMLTextAreaElement = HTMLTextAreaElement>({ initial, emergencyCheck = null, cards: initialCards = NO_CARDS, chatOnly = false, bpOnly = false, onboarding = false, cardKey, accountSection, fillOpenQuestion, settingsKinds = NO_SETTINGS_KINDS }: {
  initial: ZoeThread;
  emergencyCheck?: ZoeEmergencyCheck | null;
  cards?: ZoeCards;
  chatOnly?: boolean;
  bpOnly?: boolean;
  /** V3 onboarding: this chat also opens the profile and medicines blocks. */
  onboarding?: boolean;
  cardKey?: string;
  accountSection?: AccountSection;
  /** True when the text answered the question on screen, so it is not a message to Zoe. */
  fillOpenQuestion?: (text: string) => boolean;
  /** WP F: the member settings cards (caregiver, consents) this chat has switched on; only these are offered or opened. */
  settingsKinds?: readonly CardKind[];
}) {
  const [localEmergencies, setEmergencies] = useState<Record<string, Emergency>>({});
  const [thread, setThread] = useState(initial);
  const [screening, setScreening] = useState(emergencyCheck);
  // Restore cards at their original messages, as history only. The server alarm-window read
  // controls Zoe's follow-up warning; historical text never controls chat layout or call actions.
  const emergencies = useMemo(() => {
    if (!emergencyCheck) return localEmergencies;
    const saved: Record<string, Emergency> = {};
    for (const m of thread.messages) {
      if (couldBeZoeEmergency(m.text, screening ?? emergencyCheck)) {
        saved[m.requestId ?? `m${m.seq}`] = { request: m.requestId, text: m.text, toDoctor: false };
      }
    }
    return { ...saved, ...localEmergencies };
  }, [thread.messages, localEmergencies, screening, emergencyCheck]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [voiceDraft, setVoiceDraft] = useState(false);
  const [voiceReceipt, setVoiceReceipt] = useState<string | undefined>();
  const [voiceUrgent, setVoiceUrgent] = useState(false);
  const [writingDoctor, setWritingDoctor] = useState(false);
  // The composer's text for send callbacks that finish later (a refusal must not overwrite a new draft).
  const draft = useRef("");
  useEffect(() => { draft.current = text; }, [text]);
  const [notice, setNotice] = useState<Notice>(null);
  const [, startTransition] = useTransition();
  const input = useRef<Input>(null);

  // A pending message disappears once the stored thread carries its request id.
  const stored = useMemo(() => new Set(thread.messages.map((m) => m.requestId).filter(Boolean)), [thread]);
  const shown = pending.filter((p) => !stored.has(p.requestId) || (!!emergencies[p.requestId] && !thread.messages.some((m) => m.requestId === p.requestId && m.text === p.text)));
  // What is typed or still unsent survives a reload and a new sign-in (BC-05, BC-11). A draft that did go out is dropped;
  // one that may have gone keeps its request id, so sending it again can never store it twice (Astra BC-R2).
  const [restored, setRestored] = useState<{ text: string; requestId?: string } | null>(null);
  const newest = shown.at(-1);
  const unsent = voiceDraft ? "" : text
    ? JSON.stringify(restored?.text === text ? restored : { text })
    : newest && !newest.voiceDraft ? JSON.stringify({ text: newest.text, requestId: newest.requestId }) : "";
  // Nothing is kept until the draft has been read: the first pass must not delete it before it is back in the box.
  const [draftRead, setDraftRead] = useState(false);
  useEffect(() => {
    // Typed on a slow phone before hydration: the box shows it, and React has not seen it yet.
    const typed = input.current?.value ?? "";
    try {
      const recovery = JSON.parse(readDraft("zoe-emergencies") ?? "{}") as Record<string, Emergency>;
      const recovered: Record<string, Emergency> = {};
      for (const [id, e] of Object.entries(recovery)) {
        if (emergencyCheck && /^[0-9a-f-]{36}$/i.test(id) && e && typeof e.text === "string" && typeof e.toDoctor === "boolean") {
          // Storage never confirms delivery. Only an exact saved message can name its status.
          recovered[id] = { ...e, request: null };
        }
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one account-bound recovery read after hydration
      setEmergencies(recovered);
      setPending(Object.entries(recovered).filter(([id, e]) => !initial.messages.some((m) => m.requestId === id && m.text === e.text))
        .map(([requestId, e]) => ({ requestId, text: e.text, toDoctor: e.toDoctor, state: "failed" })));
    } catch {}
    try {
      const saved = JSON.parse(readDraft("zoe") ?? "null") as { text: string; requestId?: string } | null;
      if (saved && initial.messages.at(-1)?.text !== saved.text) {
        // The same words typed over a saved draft keep its request id, so a resend cannot store it twice.
        if (!typed || typed === saved.text) {
          setRestored(saved);
          setText(saved.text);
        }
        // Recover drafts written by the older card too, before separate emergency storage existed.
        if (emergencyCheck && saved.requestId && couldBeZoeEmergency(saved.text, emergencyCheck)) {
          setEmergencies((all) => ({ ...all, [saved.requestId!]: { request: null, text: saved.text, toDoctor: false } }));
          setPending((all) => all.some((p) => p.requestId === saved.requestId) ? all : [...all, { requestId: saved.requestId!, text: saved.text, toDoctor: false, state: "failed" }]);
        }
      }
    } catch {}
    if (typed) setText(typed);
    setDraftRead(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the thread the page opened with
  }, []);
  useEffect(() => { if (draftRead) keepDraft("zoe", unsent); }, [draftRead, unsent]);
  useEffect(() => { if (draftRead) keepDraft("zoe-emergencies", Object.keys(localEmergencies).length ? JSON.stringify(localEmergencies) : ""); }, [draftRead, localEmergencies]);
  const items = useMemo(() => chatItems(thread), [thread]);
  const [cards, setCards] = useState(initialCards);
  const entries = useMemo(() => withCards(items, cards.cards), [items, cards.cards]);
  const offer = useMemo(() => cardOffer(thread, cards, settingsKinds), [thread, cards, settingsKinds]);
  // The card just posted takes focus (its heading), so a screen reader announces it.
  const [focusCard, setFocusCard] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  useEffect(()=>{
    const focus=(event:Event)=>{const id=(event as CustomEvent<unknown>).detail;if(typeof id==='string'&&cards.cards.some(c=>c.id===id)){setFocusCard(id);setFocusVersion(v=>v+1);}};
    window.addEventListener(FOCUS_CHAT_CARD,focus);
    return ()=>window.removeEventListener(FOCUS_CHAT_CARD,focus);
  },[cards.cards]);
  const [accountTab, setAccountTab] = useState<AccountSection | undefined>(accountSection);
  const [attachments, setAttachments] = useState<{id:string;name:string;duplicate:boolean}[]>([]);
  // An open in flight or that failed: "Try again" reuses its request id, so a retry never posts two cards.
  const [opening, setOpening] = useState<{ kind: CardKind|EverydayView; seq: number | null; requestId: string; state: "busy" | "failed" | "rate_limited" | "signed_out" | "held_urgent"; call103?: boolean } | null>(null);
  const cardOpening = useRef(false);
  const requestedVisit = useRef<{kind: string; id: string} | null>(null);

  // The fast windows after a send and how many answers and replies there were then (ZOE_POLL).
  const fast = useRef(ZOE_POLL_IDLE);
  const lastRefresh = useRef(0);
  // One refresh at a time: a slow read is never stacked by the 2 s tick, and a hung one is aborted.
  const inFlight = useRef(false);
  // Sends that finished: a poll started before one of them carries an older thread and is dropped.
  const sends = useRef(0);
  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastRefresh.current = Date.now();
    const sendsAtStart = sends.current;
    startTransition(async () => {
      try {
        const [next, nextCards] = await Promise.all([
          readWithin((signal) => fetchZoeThread(signal), ZOE_POLL.TIMEOUT_MS),
          initialCards.enabled ? readWithin((signal) => fetchZoeCards(signal), ZOE_POLL.TIMEOUT_MS) : null,
        ]);
        if (!nextCards && onboarding) setCards(on => ({...on,nextStepStatus:'unavailable'}));
        if (nextCards) setCards((on) => { const merged = mergeCards(on, nextCards); return JSON.stringify(on) === JSON.stringify(merged) ? on : merged; });
        if (emergencyCheck) setScreening(shown => JSON.stringify(shown) === JSON.stringify(next?.emergencyCheck ?? null) ? shown : next?.emergencyCheck ?? null);
        if (!next) { setThread(shown => shown.suggestionState === null ? shown : ({...shown, suggestionState:null})); return; }
        setThread((shown) => (pollMayReplace(next, shown, sendsAtStart, sends.current) ? keepThreadNotices(next, shown) : shown));
        if (sendsAtStart === sends.current) fast.current = pollAfterRead(fast.current, answeredCount(next));
      } finally {
        inFlight.current = false;
      }
    });
  }, [initialCards.enabled, emergencyCheck, onboarding]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (pollDue(fast.current, Date.now(), lastRefresh.current)) refresh();
    };
    // Back on the screen (tab shown, page restored from the back-forward cache, window focused):
    // read now, and poll fast again if a recent send is still unanswered.
    const back = () => {
      if (document.visibilityState !== "visible") return;
      fast.current = pollOnReturn(fast.current, Date.now());
      refresh();
    };
    const id = window.setInterval(tick, ZOE_POLL.TICK_MS);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    window.addEventListener("focus", back);
    window.addEventListener(CARD_REPLY_LOST, back);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("focus", back);
      window.removeEventListener(CARD_REPLY_LOST, back);
    };
  }, [refresh]);

  const emergencyTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = emergencyTimers.current;
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, []);
  const deliver = (p: Pending) => {
    sending.current.add(p.text);
    // These are the server's existing rules with its public matcher switches and intake state.
    // Set the safety UI outside the send transition: IO, a refusal or a lost reply cannot delay 103.
    const check = screening ?? emergencyCheck;
    const urgent = !!p.voiceUrgent || (!!check && isZoeEmergency(p.text, check));
    const possibleUrgent = urgent || (!!check && couldBeZoeEmergency(p.text, check));
    const showEmergency = () => {
      setEmergencies((all) => ({...all, [p.requestId]: all[p.requestId] ?? {request:null,text:p.text,toDoctor:p.toDoctor}}));
    };
    if (urgent || (possibleUrgent && !screening?.intake)) showEmergency();
    const timer = possibleUrgent && !urgent ? setTimeout(showEmergency, EMERGENCY_WAIT_MS) : undefined;
    if (timer) emergencyTimers.current.add(timer);
    setPending((all) => [...all.filter((x) => x.requestId !== p.requestId), { ...p, state: "sending" }]);
    startTransition(async () => {
      let result;
      try {
        result = await sendZoeChatMessage(p.requestId, p.text, p.toDoctor, !!emergencyCheck, p.voiceReceipt);
      } catch {
        // The reply is lost, not necessarily the message: the read shows it if it was stored.
        refresh();
        result = { status: "failed" as const };
      } finally {
        sending.current.delete(p.text);
        if (timer) { clearTimeout(timer); emergencyTimers.current.delete(timer); }
      }
      // Flag off or an older client: the action redirects and the router is already navigating.
      if (!result) return;
      if (result.status === "urgent") {
        setEmergencies((all) => ({...all, [p.requestId]: {request:result.request,text:p.text,toDoctor:p.toDoctor}}));
        setPending((all) => all.map((x) => x.requestId===p.requestId ? {...x,state:result.request ? "sending" : "failed"} : x));
        // Read failures cannot replace the card. Its notice reads only this saved message's database status.
        refresh();
        return;
      }
      if (result.status === "sent") {
        sends.current += 1;
        setWritingDoctor(false);
        setNotice(p.toDoctor ? "doctor_sent" : null);
        fast.current = pollAfterSend(Date.now(), answeredCount(result.thread ?? thread));
        // Stored. The bubble goes once the thread carries its request id; when the thread could not
        // be read with the reply, it stays and the next read (now) replaces it.
        if (result.thread) setThread(shown => keepThreadNotices(result.thread!, shown));
        refresh();
        return;
      }
      if (possibleUrgent) showEmergency();
      if (result.status === "failed" || possibleUrgent) {
        setPending((all) => all.map((x) => (x.requestId === p.requestId ? { ...x, state: "failed" } : x)));
        return;
      }
      // Not stored. Into an empty composer the text goes back with the reason; while the member is
      // typing something else it stays on screen as a "Not sent" bubble, so neither text is lost.
      if (draft.current) {
        setPending((all) => all.map((x) => (x.requestId === p.requestId ? { ...x, state: "failed" } : x)));
      } else {
        setPending((all) => all.filter((x) => x.requestId !== p.requestId));
        setText(p.text);
        if(p.voiceDraft){setVoiceDraft(true);setVoiceReceipt(p.voiceReceipt);setVoiceUrgent(!!p.voiceUrgent);}
      }
      setNotice(result.status);
    });
  };

  // "New question": a divider after the newest message, so Zoe answers the next one on its own (no model call here).
  const [dividing, setDividing] = useState(false);
  const newQuestion = () => {
    if (dividing) return;
    setDividing(true);
    // A new question is Zoe's (Gohar QA 97): the composer leaves "Writing to your doctor".
    setWritingDoctor(false);
    setNotice(null);
    startTransition(async () => {
      try {
        const r = await startNewZoeQuestion();
        if (r.ok && r.thread) {
          sends.current += 1;
          setThread(shown => keepThreadNotices(r.thread!, shown));
        } else if (!r.ok) setNotice(r.signedOut ? "sign_in_again" : "unavailable");
      } catch {
        setNotice("unavailable");
      } finally {
        setDividing(false);
        input.current?.focus({ preventScroll: true });
      }
    });
  };

  // Zoe posts a card: from a chip (no member text), or from her offer under a message her checks cleared.
  const openCard = useCallback((kind: CardKind|EverydayView, seq: number | null, requestId: string = crypto.randomUUID()) => {
    if ((bpOnly && kind !== "bp" && !(onboarding && (kind === "profile" || kind === "medicines" || kind === "results" || kind === "message" || kind === "plan" || kind === "visit" || kind === "document" || kind === "symptom_gate" || kind === "consult_questions" || settingsKinds.includes(kind as CardKind)))) || cardOpening.current) return false;
    cardOpening.current = true;
    setOpening({ kind, seq, requestId, state: "busy" });
    startTransition(async () => {
      const r = await (isEverydayView(kind)?openEverydayCard({requestId,view:kind}):openZoeCard({ requestId, kind, sourceSeq: seq, reuseCurrent: seq === null })).catch(() => null);
      cardOpening.current = false;
      if (r?.status === "ok") {
        setCards((on) => upsertCard(on, r.card));
        setFocusCard(r.card.id);
        setFocusVersion(version => version + 1);
        setOpening(null);
      } else if (r?.status === "not_cleared") {
        // A newer message, or the offer was already used: the offer goes and nothing opens.
        setCards((on) => ({ ...on, clearedSeq: null, readingSeq: null }));
        setOpening(null);
      } else if (r?.status === "held_urgent") {
        setOpening({ kind, seq, requestId, state: "held_urgent", call103: r.call103 });
      } else setOpening({ kind, seq, requestId, state: r?.status === "rate_limited" || r?.status === "signed_out" ? r.status : "failed" });
    });
    return true;
  }, [startTransition, bpOnly, onboarding, settingsKinds]);

  // This screen sends requests as messages first. Only the existing server-cleared BP offer
  // opens automatically; hidden kinds remain ordinary Zoe messages.
  const attemptedReading = useRef<number | null>(null);
  useEffect(() => {
    if (!bpOnly) return;
    const recovered = opening && opening.state !== "busy" && cards.cards.find(c => c.requestId === opening.requestId);
    if (recovered) {
      // Authoritative polling can recover a card whose opening reply was lost.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the pending request with its stored card
      setOpening(null);
      setFocusCard(recovered.id);
      setFocusVersion(version => version + 1);
      return;
    }
    if (offer?.kind !== "bp" || opening?.state === "busy" || opening?.seq === offer.seq || cards.cards.some(c => c.kind === "bp" && c.sourceSeq === offer.seq)) return;
    if (attemptedReading.current === offer.seq) return;
    const requestId = crypto.randomUUID();
    if (openCard("bp", offer.seq, requestId)) attemptedReading.current = offer.seq;
  }, [bpOnly, offer, opening, cards.cards, openCard]);

  useEffect(() => {
    if (!chatOnly || !isMemberCardTarget(cardKey) || !cards.enabled || requestedVisit.current?.kind === cardKey) return;
    // Keep one request id across Strict Mode's repeated effect and a lost response.
    requestedVisit.current = {kind: cardKey, id: crypto.randomUUID()};
    openCard(cardKey, null, requestedVisit.current.id);
  }, [chatOnly, cardKey, cards.enabled, openCard]);

  useEffect(() => {
    const listeners = [...new Set([...MEMBER_CARD_TARGETS, ...CHIP_KINDS])].map(kind => {
      const show = (event: Event) => {
        if (!chatOnly) return;
        if (cards.enabled) {
          event.preventDefault();
          if (kind === "account") setAccountTab((event as CustomEvent<{section?:AccountSection}>).detail?.section);
          openCard(kind, null);
        }
        else if (kind === "message" || kind === "side_effect") {
          event.preventDefault();
          setWritingDoctor(true);
          input.current?.focus({ preventScroll: true });
        }
      };
      window.addEventListener(`noreon:member-${kind}-open`, show);
      return () => window.removeEventListener(`noreon:member-${kind}-open`, show);
    });
    return () => listeners.forEach(remove => remove());
  }, [chatOnly, cards.enabled, openCard]);

  useEffect(() => {
    const show = (event: Event) => {
      if (!chatOnly) return;
      event.preventDefault();
      setWritingDoctor(false);
      setNotice(null);
      if (canStartNewQuestion(items)) newQuestion();
      else input.current?.focus({ preventScroll: true });
    };
    window.addEventListener("noreon:member-new-question-open", show);
    return () => window.removeEventListener("noreon:member-new-question-open", show);
  });

  // Ordinary sends keep the existing lock. A distinct urgent message must still show 103 and
  // queue its save when another request hangs; repeated taps on that same text never send twice.
  const sending = useRef(new Set<string>());
  const submit = (from: "button" | "enter" = "button", value = text) => {
    if (!value.trim()) {
      // Enter on an empty box does nothing; the button explains.
      if (from === "button") setNotice("empty");
      return;
    }
    const urgent = (voiceDraft && voiceUrgent && value === text) || (!!emergencyCheck && couldBeZoeEmergency(value, screening ?? emergencyCheck));
    // A plain answer to the question on screen is that answer, not a health message. Urgent words never get here.
    if (!urgent && !writingDoctor && fillOpenQuestion?.(value)) {
      setNotice(null);
      setText("");
      setVoiceDraft(false);
      setVoiceReceipt(undefined);setVoiceUrgent(false);
      setRestored(null);
      return;
    }
    // Exact task phrases only open controls. Mixed text still takes the full safety/send path.
    const task = chatOnly && cards.enabled && !urgent ? chatTask(value) : null;
    if (task) {
      setNotice(null);
      if (!openCard(CHAT_TASKS[task].kind, null)) { setText(value); return; }
      setText("");
      setVoiceDraft(false);
      setVoiceReceipt(undefined);setVoiceUrgent(false);
      setRestored(null);
      return;
    }
    if (sending.current.size && (!urgent || sending.current.has(value))) return;
    setNotice(null);
    setFocusCard(null);
    setText("");
    const requestId = (restored?.text === value && restored.requestId) || crypto.randomUUID();
    setRestored(null);
    setVoiceDraft(false);
    setVoiceReceipt(undefined);setVoiceUrgent(false);
    deliver({ requestId, text: value, toDoctor: writingDoctor, state: "sending", ...(voiceDraft ? {voiceDraft:true,voiceReceipt,voiceUrgent:urgent} : {}) });
  };

  return { thread, emergencies, localEmergencies, shown, text, setText: (value:string) => {setText(value);setVoiceUrgent(false);if(!value){setVoiceDraft(false);setVoiceReceipt(undefined);}},
    setVoiceText: (value:string,receipt?:string,urgent=false) => {setVoiceDraft(true);setVoiceReceipt(receipt);setVoiceUrgent(urgent);setText(value);}, writingDoctor, setWritingDoctor,
    notice, setNotice, input, items, cards, setCards, entries, offer, focusCard, setFocusCard, focusVersion,
    accountTab, attachments, setAttachments, opening, openCard, dividing, newQuestion, deliver, submit };
}
