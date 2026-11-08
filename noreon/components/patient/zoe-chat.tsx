"use client";
import {ReportedBpLabel} from "@/components/chat-v2/reported-bp-label";
import {memberStaffName} from "@/lib/member-staff-name.mjs";
import {ChatSuggestions} from '@/components/conversation/chat-suggestions';
import {suggestionsFor} from '@/lib/chat/suggestions';
import {CHAT_TASKS} from '@/lib/chat/tasks';
import {chatTask,TASK_REPLY} from '@/lib/chat/tasks';
import {formatMemberDate} from '@/lib/patient/date-format';
import type {AccountSection} from './zoe-account';
import { useChatFollow, useChatViewport } from "@/components/patient/use-chat-viewport";
import {memberCardTarget} from "@/lib/zoe-chat-actions/everyday-contract";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import { MessageCircle, MessageSquarePlus, RotateCw, Send, Sparkles } from "lucide-react";
import { ZoeAttach } from "@/components/patient/zoe-attach";
import { ZoeQuickActions, zoeChip } from "@/components/patient/zoe-quick-actions";
import { ZoeCardView } from "@/components/patient/zoe-cards";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { CHIP_KINDS, NO_CARDS, type ZoeCard, type ZoeCards } from "@/lib/zoe-chat-actions/registry";
import { CHIP, COMMON, say } from "@/lib/zoe-chat-actions/copy";
import { cardKeyOf, upsertCard } from "@/lib/zoe-chat-actions/thread";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { ZoeEmergencyCard } from "@/components/patient/zoe-emergency-card";
import { type ZoeEmergencyCheck } from "@/lib/zoe/member-screen";
import { canStartNewQuestion, ZOE_CHAT_MAX, type ZoeThread } from "@/lib/zoe/app-chat-contracts";
import { useZoeThread } from "./use-zoe-thread";
import { ComposerWaiting, useHydrated } from "./use-hydrated";
import { ZoeNotice } from "./zoe-notice";
export { ZoeNotice } from "./zoe-notice";
export type { Notice } from "./use-zoe-thread";

const noticeLink =
  "inline-flex min-h-11 items-center font-semibold text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";


/** Recorded attempts can be unavailable or unknown. Only a new, explicit success may open another form. */
function hasConfirmedSave(before: ZoeCard, after: ZoeCard): boolean {
  if (before.id !== after.id || !after.valid) return false;
  const added = (key: string) => !(key in before.outcome) && key in after.outcome;
  const receipt = (key: string) => after.outcome[key] as Record<string, unknown> | undefined;
  if (after.kind === "account") return added("account") && receipt("account")?.ok === true;
  if (after.kind === "medicines") return added("medicines") && ["added", "saved", "stopped", "answered", "sent", "already", "closed"].includes(String(receipt("medicines")?.status));
  if (after.kind === "visit") return added("accepted") || added("booking") && receipt("booking")?.ok === true && receipt("booking")?.outcomeUnknown !== true;
  if (after.kind === "menu" && after.snapshot.view) return added("everyday:result") && receipt("everyday:result")?.status === "saved";
  return false;
}

const when = (at: string, locale: PatientLocale) => formatMemberDate(at, locale, {
  timeZone: "Asia/Yerevan", dateStyle: "medium", timeStyle: "short",
});

/**
 * The member's one conversation with their care team, the same one as in Telegram. Zoe's part is
 * the fixed acknowledgement and her own answers to logistics and app-help questions (labelled as
 * Zoe, never as the doctor); health answers are the doctor's approved replies. A message is sent
 * with an id made here, so "Try again" replays it and can never store it twice.
 */
function ChatDock({ children }: { children: ReactNode }) { return <div className="member-chat-dock">{children}</div>; }

export function ZoeChat({
  locale: l,
  initial,
  upload,
  kit = false,
  chatOnly = false, intro = null, selectedCard = null, cardKey, memberName, accountSection,
  emergencyCheck = null,
  consent = null,
  cards: initialCards = NO_CARDS,
}: {
  locale: PatientLocale;
  initial: ZoeThread;
  upload: boolean;
  kit?: boolean;
  chatOnly?: boolean;
  intro?: ReactNode;
  selectedCard?: ReactNode;
  cardKey?: string;
  memberName?: string;
  accountSection?: AccountSection;
  emergencyCheck?: ZoeEmergencyCheck | null;
  /** The inline "Zoe is off for you" card, above the composer (Zoe chat screen). */
  consent?: ReactNode;
  /** Zoe's action cards (zoe_chat_actions_enabled); off, the chat is as before. */
  cards?: ZoeCards;
}) {
  const hydrated = useHydrated();
  const { thread, emergencies, localEmergencies, shown, text, setText, writingDoctor, setWritingDoctor,
    notice, setNotice, input: inputRef, items: threadItems, cards, setCards, entries: threadEntries, offer, focusCard, setFocusCard, focusVersion,
    accountTab, attachments, setAttachments, opening, openCard, dividing, newQuestion, deliver, submit } = useZoeThread({ initial, emergencyCheck, cards: initialCards, chatOnly, cardKey, accountSection });
  const items = useMemo(() => threadItems.filter(item => item.kind !== "notice"), [threadItems]);
  const entries = useMemo(() => threadEntries.filter(entry => entry.type !== "item" || entry.item.kind !== "notice"), [threadEntries]);
  const threadBox = useRef<HTMLElement>(null);
  const keyboardOpen = useChatViewport(chatOnly);
  useChatFollow(chatOnly && !cardKey && !selectedCard && !focusCard, threadBox, { returnToNewest: true });
  const emergencyCard = (id:string|null, text:string) => {
    const emergency = id ? emergencies[id] : null;
    if (!id || !emergency || emergency.text !== text) return null;
    // A lost send response may still be followed by its saved message. Match both id and text,
    // so an id refused for reuse with different text can never borrow that message's care alert.
    const confirmed = thread.messages.find((m) => (m.requestId ?? `m${m.seq}`) === id && m.text === text);
    return <ZoeEmergencyCard locale={l} request={emergency.request ?? confirmed?.requestId ?? null} />;
  };
  // The box grows with the text up to about six lines, then scrolls.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [text, inputRef]);

  // Follow the newest item on open, send and receive, after the composer has resized.
  // A new answer can replace a typing/status item without changing the item count.
  const messageTail = items.map(item => item.key).join(",");
  const previousMessageTail = useRef(messageTail);
  const tail = `${entries.map((entry) => entry.type === "card" ? `c${entry.card.id}` : entry.item.key).join(",")}:${shown.map((p) => `${p.requestId}:${p.state}`).join(",")}:${Object.keys(emergencies).join(",")}:${attachments.map(file => file.id).join(",")}`;
  useEffect(() => {
    if (previousMessageTail.current !== messageTail) {
      previousMessageTail.current = messageTail;
      setFocusCard(null);
    }
    // The installed app scrolls its member shell; ordinary browsers scroll the document.
    // Keep the composer in view as well as the newest message. Never target an old card.
    const targets = chatOnly ? [document.querySelector("[data-zoe-thread]")] : [document.scrollingElement, document.querySelector(".member-journey")];
    for (const el of targets) el?.scrollTo({ top: chatOnly && entries.length === 0 && shown.length === 0 ? 0 : el.scrollHeight });
    // The tail captures every displayed entry and pending message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail, chatOnly]);
  useEffect(() => {
    if (!chatOnly || !focusCard) return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-chat-card-id="${focusCard}"]`);
      const box = threadBox.current;
      if (card && box) box.scrollTop += card.getBoundingClientRect().top - box.getBoundingClientRect().top;
    });
    return () => cancelAnimationFrame(frame);
  }, [chatOnly, focusCard, focusVersion]);
  // Selecting the same server reader again still starts at its heading; other readers navigate normally.
  useEffect(() => {
    const show = (event: Event) => {
      if (!chatOnly || !selectedCard || (event as CustomEvent<{card:string}>).detail?.card !== cardKey) return;
      event.preventDefault();
      const card = document.querySelector<HTMLElement>("[data-chat-selected-card] [data-member-chat-card]");
      const heading = card?.querySelector<HTMLElement>("h1, h2");
      if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
      const box = threadBox.current;
      if (card && box) box.scrollTop += card.getBoundingClientRect().top - box.getBoundingClientRect().top;
    };
    window.addEventListener("noreon:member-reader-open", show);
    return () => window.removeEventListener("noreon:member-reader-open", show);
  }, [chatOnly, selectedCard, cardKey]);
  // Opening a full reader starts at its heading. Later messages stay below it and scroll into view.
  useEffect(() => {
    if (!chatOnly || !cardKey) return;
    const card = document.querySelector<HTMLElement>("[data-chat-selected-card] [data-member-chat-card]");
    const heading = card?.querySelector<HTMLElement>("h1, h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    const thread = document.querySelector<HTMLElement>("[data-zoe-thread]");
    if (card && thread) thread.scrollTop += card.getBoundingClientRect().top - thread.getBoundingClientRect().top;
  }, [chatOnly, cardKey]);

  const zoeLabel = tx(l, "Zoe · ԱԲ օգնական, ոչ բժիշկ", "Zoe · AI assistant, not a doctor", "Zoe · ИИ-помощник, не врач");
  const Dock = chatOnly ? ChatDock : Fragment;
  return (
    <div data-member-chat-thread={chatOnly || undefined} className={kit ? "zk zk-chat space-y-4" : "space-y-4"} data-zoe-kit={kit || undefined} onClickCapture={event => {
      if (!chatOnly || !cards.enabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
      const kind = memberCardTarget(anchor?.getAttribute("href")??null);
      if (kind) { event.preventDefault(); openCard(kind, null); }
    }}>
      <section
        role="log"
        aria-live="polite"
        aria-label={tx(l, "Զրույց ձեր խնամքի թիմի հետ", "Conversation with your care team", "Переписка с вашей медицинской командой")}
        className="space-y-3"
        data-zoe-thread
        ref={threadBox}
      >
        {!chatOnly && intro}
        {selectedCard && <div data-chat-selected-card>{selectedCard}</div>}
        {(chatOnly ? entries.length === 0 && !selectedCard : !intro && items.length === 0) && shown.length === 0 && (
          <div className="flex justify-start" data-zoe-bubble="welcome">
            <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-md border bg-surface-subtle-teal px-4 py-3">
              <p className="text-caption font-semibold text-muted-foreground">{zoeLabel}</p>
              <p className="text-body2">
                {chatOnly ? tx(l, `Բարև${memberName ? `, ${memberName}` : ""}։ Ես Zoe-ն եմ՝ ձեր ԱԲ օգնականը․ կօգնեմ հետևել ձեր խնամքի քայլերին և կապվել թիմի հետ։`, `Hello${memberName ? `, ${memberName}` : ""}. I’m Zoe, your AI assistant. I help you follow your care and reach your team.`, `Здравствуйте${memberName ? `, ${memberName}` : ""}. Я Zoe, ваш ИИ-помощник. Я помогу следить за вашим планом и связаться с командой.`) : tx(
                  l,
                  "Գրեք ձեր խնամքի թիմին այստեղ։ Առողջության հարցերին պատասխանում է ձեր բժիշկը։ Telegram-ում գրածը նույնպես երևում է այստեղ։",
                  "Write to your care team here. Your doctor answers health questions. What you write in Telegram shows here too.",
                  "Пишите вашей медицинской команде здесь. На вопросы о здоровье отвечает ваш врач. То, что вы пишете в Telegram, тоже отображается здесь.",
                )}
              </p>
            </div>
          </div>
        )}
        {entries.map((entry) => {
          if (entry.type === "card") {
            return <ZoeCardView key={`c${entry.card.id}`} card={entry.card} locale={l} chatOnly={chatOnly}
              collapsed={chatOnly && cards.cards.some(c => cardKeyOf(c) === cardKeyOf(entry.card) && (Date.parse(c.at) > Date.parse(entry.card.at) || (c.at === entry.card.at && cards.cards.indexOf(c) > cards.cards.indexOf(entry.card))))}
              accountSection={accountTab} focus={focusCard === entry.card.id} onCard={card => {
                if (!cards.cards.some(c => c.id === card.id)) setFocusCard(card.id);
                setCards(on => upsertCard(on, card));
                const saved = hasConfirmedSave(entry.card, card);
                if (saved && card.valid && (card.kind === "account" || card.kind === "medicines" || card.kind === "visit" || card.kind === "menu" && card.snapshot.view)) {
                  openCard(card.kind === "menu" && card.snapshot.view ? card.snapshot.view : card.kind, null);
                }
              }} />;
          }
          const item = entry.item;
          if (item.kind === "notice") return null;
          if (chatOnly && (item.kind === "answer" || item.kind === "ack") && item.text && Object.values(TASK_REPLY).includes(item.text)) return null;
          if ((item.kind === "pending" || item.kind === "ack") && emergencies[thread.messages.at(-1)?.requestId ?? ""]) return null;
          return item.kind === "divider" ? (
            <div key={item.key} role="separator" className="flex items-center gap-3 py-1" data-zoe-divider>
              <span className="h-px flex-1 bg-border" aria-hidden />
              <span className="text-caption font-semibold text-muted-foreground">{tx(l, "Նոր հարց", "New question", "Новый вопрос")}</span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
          ) : item.kind === "member" ? (
            <Fragment key={item.key}>
            <div className="flex justify-end" data-zoe-bubble="member">
              <div className="max-w-[85%] space-y-1 rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
                <p className="whitespace-pre-wrap break-words text-body2">{item.text}</p>
                <ReportedBpLabel text={item.text} locale={l}/>
                <p className="text-caption opacity-80" suppressHydrationWarning>
                  {when(item.at, l)}
                  {item.channel === "telegram" && ` · ${tx(l, "Telegram-ով", "via Telegram", "через Telegram")}`}
                </p>
              </div>
            </div>
            {emergencyCard(item.requestId ?? item.key,item.text)}
            </Fragment>
          ) : item.kind === "ack" ? (
            <div key={item.key} className="flex justify-start" data-zoe-bubble="ack">
              <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-md border bg-surface-subtle-teal px-4 py-3">
                <p className="text-caption font-semibold text-muted-foreground">{zoeLabel}</p>
                <p className="whitespace-pre-wrap break-words text-body2">
                  {item.text ?? tx(l, "Ուղարկված է ձեր խնամքի թիմին։", "Sent to your care team.", "Отправлено вашей медицинской команде.")}
                </p>
              </div>
            </div>
          ) : item.kind === "pending" ? (
            <div key={item.key} className="flex justify-start" data-zoe-bubble="pending-zoe">
              <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-md border bg-surface-subtle-teal px-4 py-3">
                <p className="text-caption font-semibold text-muted-foreground">{zoeLabel}</p>
                <p className="text-body2 text-muted-foreground">{tx(l, "Zoe-ն պատասխան է գրում", "Zoe is writing a reply", "Zoe пишет ответ")}</p>
              </div>
            </div>
          ) : item.kind === "answer" ? (
            <div key={item.key} className="flex justify-start" data-zoe-bubble="answer">
              <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-md border bg-surface-subtle-teal px-4 py-3">
                <p className="text-caption font-semibold text-muted-foreground">{zoeLabel}</p>
                <p className="whitespace-pre-wrap break-words text-body2">{item.text}</p>
                <ReportedBpLabel text={item.text} locale={l} reported={thread.messages.map(m=>m.text)}/>
                <p className="text-caption text-muted-foreground" suppressHydrationWarning>{when(item.at, l)}</p>
              </div>
            </div>
          ) : (
            <div key={item.key} className="flex justify-start" data-zoe-bubble="reply">
              <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-md border bg-card px-4 py-3">
                <p className="text-caption font-semibold text-muted-foreground">{item.kind==='nurse'?`${memberStaffName(item.senderName) ? `${memberStaffName(item.senderName)} · ` : ""}${tx(l,'Բուժքույր','Nurse','Медсестра')}`:(memberStaffName(item.doctorName) ?? tx(l, "Ձեր բժիշկը", "Your doctor", "Ваш врач"))}</p>
                <p className="whitespace-pre-wrap break-words text-body2">{item.text}</p>
                <p className="text-caption text-muted-foreground" suppressHydrationWarning>{when(item.at, l)}</p>
              </div>
            </div>
          );
        })}
        {offer && !opening && !(chatOnly && chatTask(thread.messages.at(-1)?.text ?? "")) && (
          <div className="flex justify-start" data-zoe-card-offer={offer.kind}>
            <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-md border bg-surface-subtle-teal px-4 py-3">
              <p className="text-caption font-semibold text-muted-foreground">{zoeLabel}</p>
              <p className="text-body2">{say(l, COMMON.offer)}</p>
              <button type="button" className={zoeChip} onClick={() => openCard(offer.kind, offer.seq)}>
                <Sparkles className="size-4 shrink-0" aria-hidden />
                {say(l, CHIP[offer.kind])}
              </button>
            </div>
          </div>
        )}
        {shown.map((p) => (
          <Fragment key={p.requestId}>
          <div className="flex flex-col items-end gap-1" data-zoe-bubble="pending" data-state={p.state}>
            <div className={`max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 ${p.state === "failed" ? "border border-destructive/50 bg-card" : "bg-primary/70 text-primary-foreground"}`}>
              <p className="whitespace-pre-wrap break-words text-body2">{p.text}</p>
            </div>
            {p.state === "sending" ? (
              <p className="text-caption text-muted-foreground">{tx(l, "Ուղարկվում է", "Sending", "Отправляется")}</p>
            ) : (
              <p className="flex flex-wrap items-center justify-end gap-2 text-caption">
                <span role="alert">{tx(l, "Չուղարկվեց։", "Not sent.", "Не отправлено.")}</span>
                <button
                  type="button"
                  onClick={() => deliver(p)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-semibold text-foreground underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <RotateCw className="size-4" aria-hidden />
                  {tx(l, "Կրկին փորձել", "Try again", "Попробуйте снова")}
                </button>
              </p>
            )}
          </div>
          {emergencyCard(p.requestId,p.text)}
          </Fragment>
        ))}
      {attachments.map(file => <div key={file.id} className="ml-auto max-w-[85%] rounded-2xl border bg-card p-3" data-zoe-file-receipt>
        <p className="break-words text-body2 font-semibold">{file.name}</p>
        <p className="text-caption">{file.duplicate ? tx(l,"Այս ֆայլն արդեն պահված է։","This file is already saved.","Этот файл уже сохранён.") : tx(l,"Ֆայլը պահված է։ Այն դեռ կարդացված չէ։","File saved. It has not been read yet.","Файл сохранён. Он ещё не прочитан.")}</p>
      </div>)}
      {chatOnly && intro}
      {chatOnly && consent}
      {opening?.state === "signed_out" && <SignInEnded locale={l} />}
      {opening && opening.state !== "busy" && opening.state !== "signed_out" && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-body2" data-zoe-card-open-failed>
          {opening.seq !== null && opening.state === "rate_limited"
            ? tx(l,"Ձեր հաղորդագրությունն ուղարկված է։ Քարտը հիմա չի բացվում։ Մի քանի րոպեից նորից փորձեք։","Your message was sent. The card cannot open right now. Try again in a few minutes.","Ваше сообщение отправлено. Сейчас карточка не открывается. Попробуйте снова через несколько минут.")
            : say(l, opening.state === "rate_limited" ? COMMON.rateLimited : COMMON.openFailed)}
          {(opening.state === "failed" || opening.state === "rate_limited") && (
            <button type="button" className={noticeLink} onClick={() => openCard(opening.kind, opening.seq, opening.requestId)}>{say(l, COMMON.retry)}</button>
          )}
          {opening.kind === "side_effect" && <Link href="/patient/team?section=contact" className={noticeLink}>{tx(l, "Կապվել Noreon-ի հետ", "Contact Noreon", "Связаться с Noreon")}</Link>}
        </p>
      )}
      </section>
      {!chatOnly && consent}
      <Dock>
      {chatOnly && cards.enabled && <ChatSuggestions
        suggestions={consent || writingDoctor || Object.keys(localEmergencies).length ? [] : suggestionsFor(thread.suggestionState).filter(s => !cards.cards.some(c => c.valid && c.state === "open" && c.kind === CHAT_TASKS[s.id].kind)).slice(0, items.length === 0 ? 1 : 3)}
        hidden={!!text || !!keyboardOpen}
        label={tx(l,"Առաջարկվող հաղորդագրություններ","Suggested messages","Предлагаемые сообщения")}
        onSend={value => submit("button", value)} /> }
      {!chatOnly && <ZoeQuickActions locale={l} upload={upload} cards={cards.enabled}>
        {cards.enabled && CHIP_KINDS.filter(kind => kind !== "medicines" && kind !== "account").map((kind) => (
          <button key={kind} type="button" className={zoeChip} disabled={opening?.state === "busy"} onClick={() => openCard(kind, null)} data-zoe-card-chip={kind}>
            {say(l, CHIP[kind])}
          </button>
        ))}
        {!cards.enabled && <button type="button" className={zoeChip} onClick={() => {
          setWritingDoctor(true);
          if (!chatOnly) inputRef.current?.scrollIntoView({ block: "center" });
          inputRef.current?.focus({ preventScroll: true });
        }}>
          <MessageCircle className="size-4 shrink-0" aria-hidden />
          {tx(l, "Գրել ձեր բժշկին", "Write to your doctor", "Написать вашему врачу")}
        </button>}
        {canStartNewQuestion(items) && (
          <button type="button" className={zoeChip} onClick={newQuestion} disabled={dividing} data-zoe-new-question>
            <MessageSquarePlus className="size-4 shrink-0" aria-hidden />
            {tx(l, "Նոր հարց", "New question", "Новый вопрос")}
          </button>
        )}
      </ZoeQuickActions>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit("button");
        }}
        className="sticky top-auto! bottom-[calc(var(--member-tabbar-height,4.75rem+env(safe-area-inset-bottom))+0.5rem)] z-10 space-y-2 rounded-xl border bg-card p-3 shadow-sm lg:bottom-4"
        data-zoe-composer
      >
        {writingDoctor && <p className="flex flex-wrap items-center gap-2 text-caption" data-zoe-doctor-mode>
          {tx(l, "Գրում եք ձեր բժշկին", "Writing to your doctor", "Вы пишете вашему врачу")}
          <button type="button" className={noticeLink} onClick={() => setWritingDoctor(false)}>{tx(l, "Փոխարենը գրել Zoe-ին", "Write to Zoe instead", "Написать Zoe вместо врача")}</button>
        </p>}
        <label htmlFor="zoe-chat-message" className="sr-only">
          {writingDoctor ? tx(l, "Հաղորդագրություն ձեր բժշկին", "Message to your doctor", "Сообщение вашему врачу") : tx(l, "Հաղորդագրություն Zoe-ին", "Message to Zoe", "Сообщение Zoe")}
        </label>
        <ComposerWaiting locale={l} />
        <div className="flex flex-wrap items-end gap-2">
          <textarea
            id="zoe-chat-message"
            ref={inputRef}
            name="message"
            rows={1}
            maxLength={ZOE_CHAT_MAX}
            value={text}
            enterKeyHint="enter"
            placeholder={writingDoctor ? tx(l, "Գրեք ձեր բժշկին…", "Write to your doctor…", "Напишите вашему врачу…") : chatOnly ? tx(l,"Հարցրեք Zoe-ին…", "Ask Zoe…", "Спросите Zoe…") : tx(l, "Գրեք Zoe-ին…", "Write to Zoe…", "Напишите Zoe…")}
            onChange={(e) => {
              setText(e.target.value);
              if (notice) setNotice(null);
            }}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter is a new line. Touch: Return is a new line and the
              // button sends, as in messaging apps. Never while an IME is composing (Armenian, Russian).
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (!(e.metaKey || e.ctrlKey) && window.matchMedia("(pointer: coarse)").matches) return;
              e.preventDefault();
              submit("enter");
            }}
            className="block max-h-40 min-h-12 w-full min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-body1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          {/* By the send button, as in the prototype, and in reading order. */}
          {cards.enabled && <ZoeAttach locale={l} onSaved={(name, duplicate) => setAttachments(all => [...all, {id:crypto.randomUUID(),name,duplicate}])} />}
          <button
            type="submit"
            disabled={!hydrated}
            onMouseDown={e => { if (chatOnly) e.preventDefault(); }}
            className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-3 text-body2 sm:px-4 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <Send className="size-4 shrink-0" aria-hidden />
            {/* Icon only on phones, so the box gets the width. */}
            <span className="max-sm:sr-only">{tx(l, "Ուղարկել", "Send", "Отправить")}</span>
          </button>
        </div>
        <p className="hidden text-caption text-muted-foreground [@media(pointer:fine)]:block" data-zoe-enter-hint>
          {tx(l, "Enter՝ ուղարկել, Shift+Enter՝ նոր տող", "Enter to send, Shift+Enter for a new line", "Enter, чтобы отправить, Shift+Enter, чтобы начать новую строку")}
        </p>
        <div aria-live="polite">
          <ZoeNotice locale={l} notice={notice} />
        </div>
      </form>
      </Dock>
    </div>
  );
}
