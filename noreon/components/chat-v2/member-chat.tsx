"use client";
import {ReportedBpLabel} from "./reported-bp-label";
import { noreonName, zoeName } from "@/lib/brand";
import {CARD_REPLY_LOST} from '@/lib/zoe-chat-actions/thread-events';
import {NextStepCard,NextStepTurn,ReviewCard} from './next-step-card';
import {ResultsMessageCard,JourneyRecordCard,JourneyRecordTurn} from './results-message-card';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
import {DialogTurn} from './dialog-turn';
import {memberStaffName} from "@/lib/member-staff-name.mjs";
import {memberNoticeText} from '@/lib/chat/doctor-note';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Phone, ArrowUp } from "lucide-react";
import { useZoeThread } from "@/components/patient/use-zoe-thread";
import { Call103, ComposerWaiting, useHydrated } from "@/components/patient/use-hydrated";
import { useChatViewport } from "@/components/patient/use-chat-viewport";
import { ZoeEmergencyCard } from "@/components/patient/zoe-emergency-card";
import { ZoeChatConsent } from "@/components/patient/zoe-chat-consent";
import { ZoeNotice } from "@/components/patient/zoe-notice";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { openDocumentCard } from "@/lib/zoe-chat-actions/labs-actions";
import { SymptomGateCard, SavedGateTurn } from "./symptom-gate-card";
import { ConsultQuestionsCard, SavedQuestionsTurn } from "./consult-questions-card";
import { LabVisitCard, SavedLabTurn } from "./lab-visit-card";
import { VisitCard, SavedVisitTurn } from "./visit-card";
import {LIVING_VISIT,visitTransitions,findLivingVisit} from '@/lib/zoe-chat-actions/living-visit';
import {FOCUS_CHAT_CARD} from '@/lib/zoe-chat-actions/thread-events';
import { DocumentCard, SavedDocumentTurn } from "./document-card";
import { ZoeAttach } from "@/components/patient/zoe-attach";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { ZOE_CHAT_MAX, type ZoeThread } from "@/lib/zoe/app-chat-contracts";
import type { ZoeEmergencyCheck } from "@/lib/zoe/member-screen";
import { formatMemberDate } from "@/lib/patient/date-format";
import { firesEmergency } from "@/lib/clinical/rules/rules";
import type { AssessmentDraft } from "@/lib/patient/types";
import type { Locale } from "@/lib/locale";
import {STAGE_CLASSES} from "@/lib/patient/journey-stage";
import type { JourneyStage } from "@/lib/patient/journey-stage";
import { ChatSuggestions } from "@/components/conversation/chat-suggestions";
import { suggestionsFor } from "@/lib/chat/suggestions";
import { NO_CARDS, type CardKind, type ZoeCard, type ZoeCards } from "@/lib/zoe-chat-actions/registry";
import { cardTurns, dialogThread, savedBp, savedMedicines, savedProfile, upsertCard, withoutCardReplies, type DialogEntry } from "@/lib/zoe-chat-actions/thread";
import { contextStrip, flowOf, openFlags, redOutcome } from "@/lib/zoe-chat-actions/bp-flow";
import { COMMON, FLOW, MESSAGE, ONBOARDING, say } from "@/lib/zoe-chat-actions/copy";
import type { CareAlertZoeStatus } from "@/lib/care-alerts/member";
import { Anamnesis, type QuestionnaireTurn } from "./anamnesis";
import { ReadingCard, SavedReading } from "./reading-card";
import { ContextStripView, FlagsTurn, RedFlagCard } from "./bp-flow-cards";
import { ProfileCard, SavedProfileTurn } from "./profile-card";
import { CaregiverCard, CaregiverInvitations, ConsentsCard, VoiceAccountCard } from "./member-settings-cards";
import type { VoicePendingState, VoiceTurn, VoiceTurnOutcome } from "./voice-turn";
import type { CaregiverInvitation } from "@/lib/caregivers/schema";
import { MedicinesCard, SavedMedicinesTurn } from "./medicines-card";
import { PlanCard, ConfirmedPlanTurn } from "./plan-card";
import { DoseCard, DoseTurn } from "./dose-card";
import { DoseReasonCard,DoseReasonTurn,SamsCard,SamsTurn } from "./dose-flow-cards";
import { ChatMenu } from "./menu";
import { MemberPushPrompt } from "./push-prompt";
import { useThreadScroll } from "./use-thread-scroll";
import { Microphone } from "./microphone";
import { Speaker, VoicePlayback } from "./speaker";
import { useNoticeSeen } from "./use-notice-seen";
import { ConversationToggle, useConversation } from "./conversation";
import { OfflineBanner } from "./offline-banner";
import { offlineText } from "@/lib/offline/copy";

export type MemberChatNextStep = { stage: JourneyStage | null; text: Record<Locale, string>; href: string | null };
type Props = {
  locale: PatientLocale; memberName: string; revision: number; initial: ZoeThread | null;
  /** NO_CARDS (the default) means no card is read, polled, opened or drawn. */
  cards?: ZoeCards;
  /** Server capability only; absent with V3 off. */
  /** live: Gemini Live streaming transcription is available (WP V); stream: speak replies through the streaming speech route. */
  voice?: {microphone:boolean;conversation?:boolean;live?:boolean;stream?:boolean};
  /** V3 only. profileRequest: the card to offer after consent, when one is still due. Undefined means none of the new blocks. */
  onboarding?: { profileRequest: string | null };
  assessment?: AssessmentDraft; emergencyCard?: boolean;
  memberPush?: { publicKey: string } | null;
  nextStep?: MemberChatNextStep;
  overview?: boolean;
  bpPhoto?: boolean;
  /** The next-step switch needs the saved completion and journey facts from the server. */
  refreshOnComplete?: boolean;
  emergencyCheck?: ZoeEmergencyCheck | null; consent?: { directAnswers: boolean } | null;
  /** WP F: which member settings cards the menu offers (server flags), and this phone account's pending caregiver invitations. */
  settings?: { caregivers: boolean; consents: boolean };
  caregiverInvitations?: CaregiverInvitation[];
};
const empty: ZoeThread = { ok: true, version: 0, ack: null, zoeReplies: false, settledSeq: 0, messages: [], replies: [], answers: [] };
const COMPOSER_LINES = 5;
function fitComposer(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  const line = parseFloat(getComputedStyle(field).lineHeight);
  field.style.height = `${Math.min(field.scrollHeight, line * COMPOSER_LINES)}px`;
}
/** The cards the new chat draws: the reading and the blood pressure flow it leads to, then the onboarding, labs and continuation blocks. Other kinds stay ordinary messages. */
const SHOWN_KINDS = new Set(["bp", "repeat", "red_flags", "profile", "medicines", "document", "visit", "prep", "fasting", "symptom_gate", "consult_questions", "dose", "ask", "sams", "caregiver", "consents"]);
const NEXT_STEP_KINDS = new Set(["review", "next_step", "tests_needed", "results", "message", "plan"]);
const SHOWN = (card: ZoeCard, v3: boolean) => SHOWN_KINDS.has(card.kind) || (v3 && NEXT_STEP_KINDS.has(card.kind));
const stamp = (at: string, locale: PatientLocale) => formatMemberDate(at, locale, { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit" });

/** The payload identity is retained by the hook on unchanged polls, so this list does not render. */
const Messages = memo(function Messages({ voiceRequests, entries, whole = entries, locale: l, emergencies, messages, tasks, focusCard, canFocus, onCard, onAct, offerMedicines, onQuestions, onPlan, onMessage, stepsDisabled = false, journeyEnabled = false, bpPhoto = false }: {
  bpPhoto?: boolean;
  journeyEnabled?: boolean;
  stepsDisabled?: boolean;
  entries: DialogEntry[];
  /** The full thread when entries is one turn of it, as in the anamnesis: a form is compared with everything after it. */
  whole?: DialogEntry[];
  focusCard: string | null; canFocus: () => boolean; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void;
  /** The next step under a saved profile, until a medicines block exists. */
  offerMedicines?: (() => void) | null;
  onQuestions: () => void;
  onPlan: () => void;
  onMessage: () => void;
  /** WP V: account (reminders) cards a spoken request opened, with what was asked; only these account cards are shown. */
  voiceRequests?: Record<string, { time: string; target: "bp" | "medicine" } | null>;
  locale: PatientLocale; emergencies: Record<string, { request: string | null; text: string; toDoctor: boolean; status?: CareAlertZoeStatus }>; messages: ZoeThread["messages"]; tasks?: ZoeCards["tasks"];
}) {
  return entries.map(entry => {
    if(entry.type!=="item"&&!SHOWN(entry.card,journeyEnabled))return null;
    const living=findLivingVisit(whole.filter(e=>e.type==='card').map(e=>e.card));
    if(entry.type==='card'&&living){
      if(entry.card.valid&&(entry.card.kind==='prep'||entry.card.kind==='fasting')&&entry.card.snapshot.appointmentId===living.snapshot.living?.visitId)return null;
      if(entry.card.valid&&entry.card.kind==='next_step'&&['test_request_pending','visit_confirmation_pending','visit_booked','results_waiting'].includes(entry.card.snapshot.journeyStage??''))return null;
    }
    if (entry.type === "turn") {
      const key = `turn-${entry.card.id}-${entry.item}`, time = stamp(entry.at, l);
      if(entry.card.kind==="review")return <DialogTurn locale={l} key={key} action={say(l,NEXT_STEP.review)} time={time}><p>{say(l,NEXT_STEP.reviewSent)}</p></DialogTurn>;
      if(entry.card.kind==="next_step"||entry.card.kind==="tests_needed")return <NextStepTurn key={key} card={entry.card} locale={l} time={time}/>;
      if(entry.card.kind==="message"){const sent=entry.card.outcome[entry.item] as {urgent?:boolean};return <DialogTurn locale={l} key={key} action={null} time={time}><p>{say(l,sent.urgent?MESSAGE.urgent:MESSAGE.sent)}</p></DialogTurn>;}
      if(entry.card.kind==='plan'&&entry.item==='everyday:result')return <JourneyRecordTurn key={key} card={entry.card} locale={l} time={time} onCard={onCard}/>;
      if (entry.card.kind === "ask") return <DoseReasonTurn key={key} card={entry.card} locale={l} time={time}/>;
      if (entry.card.kind === "sams") {const red=redOutcome(entry.card);return <SamsTurn key={key} card={entry.card} locale={l} time={time} tasks={tasks} stored={!!red&&messages.some(m=>m.requestId===red.requestId)}/>;}
      if (entry.card.kind === "dose") return <DoseTurn key={key} card={entry.card} item={entry.item} locale={l} time={time} />;

      if (entry.card.kind === "red_flags") {
        const red = redOutcome(entry.card);
        return <FlagsTurn key={key} card={entry.card} locale={l} time={time} tasks={tasks} flow={flowOf(entry.card)} stored={!!red && messages.some(m => m.requestId === red.requestId)} />;
      }
      if (entry.card.kind === "bp" || entry.card.kind === "repeat") return <SavedReading key={key} card={entry.card} reading={savedBp(entry.card)!} said={entry.said} locale={l} time={time} tasks={tasks} />;
      if (entry.card.kind === "plan") return <ConfirmedPlanTurn key={key} locale={l} time={time} />;
      if (entry.card.kind === "prep" || entry.card.kind === "fasting") return <SavedLabTurn key={key} card={entry.card} locale={l} time={time} />;
      if (entry.card.kind === "consult_questions") return <SavedQuestionsTurn key={key} locale={l} time={time} />;
      if (entry.card.kind === "symptom_gate") return <SavedGateTurn key={key} card={entry.card} locale={l} time={time} onQuestions={onQuestions} />;
      if (entry.card.kind === "visit") {
        const transition=visitTransitions(entry.card).find(t=>t.item===entry.item);
        if(entry.card.snapshot.living)return transition?<DialogTurn locale={l} key={key} action={null} time={time}><p>{say(l,LIVING_VISIT[transition.status])}</p><button type="button" className="cv2-link" onClick={()=>window.dispatchEvent(new CustomEvent(FOCUS_CHAT_CARD,{detail:entry.card.id}))}>{say(l,LIVING_VISIT.open)}</button></DialogTurn>:null;
        return <SavedVisitTurn onCard={journeyEnabled?onCard:undefined} key={key} card={entry.card} locale={l} time={time} />;
      }
      if (entry.card.kind === "document") return <SavedDocumentTurn key={key} card={entry.card} locale={l} time={time} />;
      if (entry.card.kind === "profile") return <SavedProfileTurn key={key} saved={savedProfile(entry.card)!} locale={l} time={time} onMedicines={offerMedicines} />;
      if (entry.card.kind === "medicines") return <SavedMedicinesTurn key={key} rows={savedMedicines(entry.card)!} locale={l} time={time} noTitration={(entry.card.outcome.medicines as {noTitration?:boolean})?.noTitration===true} />;
      return null;
    }
    if (entry.type === "card") {
      if (!entry.card.valid) return <article key={entry.card.id} className="cv2-msg cv2-zoe" data-zoe-card={entry.card.kind} data-state="unavailable">
        <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
        <p className="cv2-reading" role="status">{say(l, COMMON.unreadable)}</p>
      </article>;
      if(entry.card.kind==="review")return <ReviewCard onMessage={onMessage} key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/>;
      if(journeyEnabled&&["next_step","tests_needed","results","message","visit","plan"].includes(entry.card.kind)){
        const replaced=entry.card.kind==='visit'&&entry.card.snapshot.living?false:whole.some(other=>other.type!=="item"&&other.card.kind===entry.card.kind&&Date.parse(other.card.at)>Date.parse(entry.card.at));
        if(replaced||((entry.card.kind==='next_step'||entry.card.kind==='tests_needed')&&entry.card.state==='done'))return null;
      }
      if(entry.card.kind==="next_step"||entry.card.kind==="tests_needed")return <NextStepCard onMessage={onMessage} disabled={stepsDisabled} key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/>;
      if(entry.card.kind==="results"||entry.card.kind==="message")return <ResultsMessageCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/>;
      if (entry.card.kind === "prep" || entry.card.kind === "fasting") return <LabVisitCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "consult_questions") return <ConsultQuestionsCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "symptom_gate") return <SymptomGateCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "visit") return <VisitCard current={journeyEnabled} key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "document") return <DocumentCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "dose") return entry.card.snapshot.v3 ? <DoseCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} /> : null;
      if (entry.card.kind === "ask") return entry.card.snapshot.v3 ? <DoseReasonCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/> : null;
      if (entry.card.kind === "sams") return <SamsCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/>;
      if (entry.card.kind === "plan") {
        const replaced = whole.some(other => other.type !== "item" && other.card.kind === "plan" && Date.parse(other.card.at) > Date.parse(entry.card.at));
        return replaced ? null : entry.card.snapshot.v3 === undefined ? <JourneyRecordCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct}/> : <PlanCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} onRefresh={onPlan} />;
      }
      if (entry.card.kind === "profile") return <ProfileCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "caregiver" || entry.card.kind === "consents") {
        // A newer card of the same kind shows the current record; the older one, with what was done on it, stays above.
        const replaced = whole.some(other => other.type === "card" && other.card.kind === entry.card.kind && Date.parse(other.card.at) > Date.parse(entry.card.at));
        if (replaced && !Object.keys(entry.card.outcome).length) return null;
        return entry.card.kind === "caregiver" ? <CaregiverCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />
          : <ConsentsCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      }
      if (entry.card.kind === "medicines") {
        // Finished on the older card, or replaced by a newer one: nothing to fill in here.
        const replaced = whole.some(other => other.type !== "item" && other.card.kind === "medicines" && Date.parse(other.card.at) > Date.parse(entry.card.at));
        return entry.card.state === "done" || replaced ? null : <MedicinesCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      }
      // A newer card replaces an unsaved one, so the thread shows one form unless this one holds the member's numbers. A later
      // action replaces only an empty form: numbers from the member's own message still wait to be saved.
      if (entry.card.kind === "red_flags") return <RedFlagCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} onAct={onAct} />;
      if (entry.card.kind === "account") return entry.card.id in (voiceRequests ?? {}) ? <VoiceAccountCard key={entry.card.id} card={entry.card} locale={l} onCard={onCard} requested={voiceRequests?.[entry.card.id] ?? null} /> : null;
      if (entry.card.kind !== "bp" && entry.card.kind !== "repeat") return null;
      const later = (other: DialogEntry) => other.type !== "item" && (other.card.kind === entry.card.kind || (entry.card.kind === "repeat" && other.card.kind === "bp")) && Date.parse(other.type === "turn" ? other.at : other.card.at) > Date.parse(entry.card.at);
      const { typed } = entry.card.snapshot as { typed?: unknown };
      const superseded = whole.some(other => later(other) && (other.type === "card" || !typed));
      return <ReadingCard photoEnabled={bpPhoto} key={entry.card.id} card={entry.card} locale={l} focus={focusCard === entry.card.id} canFocus={canFocus} superseded={superseded} onCard={onCard} onAct={onAct} />;
    }
    const item = entry.item;
    const text = item.kind === 'notice' ? memberNoticeText(item.text,l) : 'text' in item ? item.text : null;
    if ((item.kind === "ack" || item.kind === "pending") && emergencies[messages.at(-1)?.requestId ?? ""]) return null;
    if (item.kind === "divider") return <p key={item.key} className="cv2-divider" role="separator">{tx(l, "Նոր հարց", "New question", "Новый вопрос")}</p>;
    const member = item.kind === "member";
    const doctor = item.kind === "reply";
    const nurse = item.kind === "nurse";
    const emergency = member ? emergencies[item.requestId ?? item.key] : null;
    return <Fragment key={item.key}>
      <article className={`cv2-msg ${member ? "cv2-me" : "cv2-zoe"} ${doctor ? "cv2-doctor" : ""}`} data-message-key={item.key} data-notice={item.kind === "notice" ? item.key.slice(1) : undefined} data-closed={item.kind === "notice" && item.closed ? true : undefined}>
        {!member && <p className="cv2-from">{!doctor && !nurse && <i className="cv2-orb" aria-hidden />}{doctor ? memberStaffName(item.doctorName) ?? tx(l, "Ձեր բժիշկը", "Your doctor", "Ваш врач") : nurse ? `${memberStaffName(item.senderName) ? `${memberStaffName(item.senderName)} · ` : ""}${tx(l, "Բուժքույր", "Nurse", "Медсестра")}` : zoeName(l)}</p>}
        {item.kind === "pending" ? <p className="cv2-typing" role="status" aria-label={tx(l, "Զոյան պատասխան է գրում", "Zoe is writing a reply", "Зоя пишет ответ")}><i /><i /><i /></p>
          : <p className="cv2-say">{item.kind === "ack" ? tx(l, "Ուղարկված է ձեր խնամքի թիմին։", "Sent to your care team.", "Отправлено вашей медицинской команде.") : text}</p>}
        {(member||item.kind==="answer"||item.kind==="notice")&&<ReportedBpLabel text={item.text} locale={l} reported={member?undefined:messages.map(m=>m.text)}/>}
        {(item.kind === "answer" || item.kind === "notice") && <Speaker text={text!} locale={l} />}
        {"at" in item && <p className="cv2-time" suppressHydrationWarning>{stamp(item.at, l)}</p>}
      </article>
      {emergency && member && emergency.text === item.text && <ZoeEmergencyCard locale={l} request={emergency.request ?? item.requestId} initial={emergency.status} contained />}
    </Fragment>;
  });
});

export function MemberChat(props: Props) {
  const [signedOut, setSignedOut] = useState<PatientLocale | null>(null);
  return signedOut ? <main className="cv2-root cv2-ended"><SignInEnded locale={signedOut} /></main>
    : <ChatSession {...props} onSignedOut={setSignedOut} />;
}

function ChatSession({ locale, memberName, revision, initial, voice, cards: initialCards = NO_CARDS, onboarding, emergencyCheck, consent, assessment, emergencyCard = false, memberPush, nextStep, overview = false, bpPhoto = false, refreshOnComplete = false, settings, caregiverInvitations = [], onSignedOut }: Props & { onSignedOut: (locale: PatientLocale) => void }) {
  const [l, setLocale] = useState(locale);
  const [consentResolved, setConsentResolved] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [questionnaireFinished,setQuestionnaireFinished]=useState(false);
  const onQuestionComplete=useCallback(()=>{setQuestionnaireFinished(true);window.dispatchEvent(new Event(CARD_REPLY_LOST));},[]);
  const [questionTurn, setQuestionTurn] = useState(0);
  const onQuestionTurn = useCallback(() => setQuestionTurn(turn => turn + 1), []);
  const [menu, setMenu] = useState(false);
  const [languageRevision, setLanguageRevision] = useState(revision);
  const [questionnairePending, setQuestionnairePending] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const onQuestionnaireState = useCallback((savedRevision: number, pending: boolean) => {
    setLanguageRevision(current => Math.max(current, savedRevision));
    setQuestionnairePending(pending);
  }, []);
  const hydrated = useHydrated();
  const [voiceBusy, setVoiceBusy] = useState(false);
  const fillQuestion = useRef<((text: string) => boolean) | null>(null);
  const fillOpenQuestion = useCallback((text: string) => fillQuestion.current?.(text) ?? false, []);
  // WP F: the member settings cards the server switched on (the menu opens them; an offer names only these).
  const settingsKinds = useMemo<CardKind[]>(() => [...(settings?.caregivers ? ["caregiver" as const] : []), ...(settings?.consents ? ["consents" as const] : [])], [settings?.caregivers, settings?.consents]);
  const state = useZoeThread<HTMLTextAreaElement>({ initial: initial ?? empty, emergencyCheck, cards: initialCards, bpOnly: true, onboarding: !!onboarding, fillOpenQuestion, settingsKinds, realtime: !!initial, offline: !!initial });
  const { items, thread, emergencies: threadEmergencies, shown, input, text, setText, notice, setNotice, submit, deliver, cards, setCards, focusCard, focusVersion, opening, openCard, offer } = state;
  // A yes on a safety card opens 103 from the card's saved outcome, the same card a typed urgent message gets, under the member's message.
  const emergencies = useMemo(() => ({ ...threadEmergencies, ...Object.fromEntries(cards.cards.flatMap(card => {
    const red = redOutcome(card);
    return red && !red.cleared ? [[red.requestId, { request: red.requestId, text: red.text, toDoctor: false, status: { alerted: red.alerted, pending: false } }]] : [];
  })) }), [threadEmergencies, cards.cards]);
  const currentStep=onboarding?cards.cards.filter(c=>c.valid&&c.kind==='next_step').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.at.localeCompare(a.at)||b.id.localeCompare(a.id))[0]:undefined;
  const stage=currentStep?.valid&&currentStep.kind==='next_step'?currentStep.snapshot.journeyStage:undefined;
  const nextStepLine=nextStep&&onboarding
    ?cards.nextStepStatus==='unavailable'?{stage:null,text:NEXT_STEP.unavailable,href:null}:stage?{stage,text:STAGE_CLASSES[stage],href:null}:nextStep
    :nextStep;
  const showAnamnesis = !!assessment && (!consent || consentResolved || !!firesEmergency({ answers: assessment.answers, observations: [] }));
  // WP V: account cards a spoken request opened (reminders), with what was asked, and the card waiting for a spoken yes.
  const [voiceRequests, setVoiceRequests] = useState<Record<string, { time: string; target: "bp" | "medicine" } | null>>({});
  const [voicePending, setVoicePending] = useState<VoicePendingState>(null);
  const voiceTurn = useRef<VoiceTurn | null>(null);
  const shownCard = useCallback((card: ZoeCard) => SHOWN(card, !!onboarding) || (card.kind === "account" && card.id in voiceRequests), [onboarding, voiceRequests]);
  const visibleEntries = useMemo(() => {
    const bp = cards.cards.filter(shownCard);
    // Only a reading card opens here, so only that request has its card as the answer. Any other request keeps Zoe's reply.
    const opened = new Set([...bp.filter(card => card.kind === "bp").map(card => card.sourceSeq), offer?.kind === "bp" ? offer.seq : null, opening?.kind === "bp" ? opening.seq : null]);
    opened.delete(null);
    return dialogThread(withoutCardReplies(items, opened as Set<number>), cards.cards.filter(shownCard),!!onboarding);
  }, [items, cards.cards, offer, opening, onboarding, shownCard]);
  const onCard = useCallback((card: ZoeCard) => setCards(on => upsertCard(on, card)), [setCards]);
  // The member just acted here, so the chat goes to the action, from any block and even when its reply was lost. An action on another device moves no one.
  const acting = useRef(new Set<string>());
  const onAct = useCallback((id: string, on: boolean) => { if (on) acting.current.add(id); else acting.current.delete(id); }, []);
  const keyboardOpen = useChatViewport(true);
  // Right after a finished action, offering another would answer nothing the member said.
  const justActed = visibleEntries.filter(entry => entry.type !== "item" || entry.item.kind !== "pending").at(-1)?.type === "turn";
  const tail = `${items.map(item => item.key + ("text" in item ? item.text : "")).join("|")}:${shown.map(p => `${p.requestId}:${p.state}`).join("|")}:${Object.keys(emergencies).join("|")}:${cards.cards.filter(shownCard).map(c => `${c.id}:${c.state}:${Object.keys(c.outcome).join(",")}`).join("|")}`;
  // Only target an authenticated notice already present in this member's thread.
  const [requestedNotice] = useState(() => typeof window === "undefined" ? null : /[?&]notice=([0-9a-f-]{36})(?:&|$)/i.exec(window.location.search)?.[1] ?? null);
  const targetNotice = thread.notices?.some(item => item.id === requestedNotice) ? requestedNotice : thread.firstUnseenNotice;
  const onPlan = useCallback(() => { openCard("plan", null); }, [openCard]);
  const hasMedicinesCard = cards.cards.some(card => card.kind === "medicines");
  const offerMedicines = useMemo(() => onboarding && cards.enabled && !hasMedicinesCard ? () => { openCard("medicines", null); } : null, [onboarding, cards.enabled, hasMedicinesCard, openCard]);
  // The profile block, once, after consent. The server's request id makes a repeat of this the same card; never over 103.
  const profileRequest = onboarding?.profileRequest ?? null;
  const consentClear = !consent || consentAccepted;
  const quiet = !Object.keys(state.localEmergencies).length && !(assessment && firesEmergency({ answers: assessment.answers, observations: [] }));
  const offered = useRef(false);
  useEffect(() => {
    if (!profileRequest || !hydrated || !consentClear || !quiet || offered.current || cards.cards.some(card => card.kind === "profile")) return;
    if (openCard("profile", null, profileRequest)) offered.current = true;
  }, [profileRequest, hydrated, consentClear, quiet, cards.cards, openCard]);
  const { threadRef, contentRef, unread, newest, isFollowing } = useThreadScroll(`${tail}:${questionTurn}`, targetNotice ? `N${targetNotice}` : null);
  // A menu item that opens a card which already exists higher up in the thread (My plan, My visit, a second tap) must show it:
  // only the reading card scrolls itself, so bring any other focused card into view when it is not.
  useEffect(() => {
    if (!focusCard) return;
    const box = threadRef.current;
    if (typeof box?.querySelector !== "function") return;
    const card = box.querySelector<HTMLElement>(`[data-chat-card-id="${focusCard}"]`);
    if (!card) return;
    const edge = box.getBoundingClientRect(), at = card.getBoundingClientRect();
    if (at.top < edge.top || at.bottom > edge.bottom) box.scrollTop += at.top - edge.top - 12;
    card.setAttribute('data-card-highlight','true');
    card.focus({preventScroll:true});
    const timer=window.setTimeout(()=>card.removeAttribute('data-card-highlight'),1800);
    return ()=>{window.clearTimeout(timer);card.removeAttribute('data-card-highlight');};
  }, [focusCard, focusVersion, threadRef]);
  const onMessage = useCallback(() => { newest(); openCard("message", null); }, [newest, openCard]);
  const onQuestions = useCallback(() => { newest(); openCard("consult_questions", null); }, [newest, openCard]);
  const questionThread = useMemo(() => {
    const turns: QuestionnaireTurn[] = [];
    // The anamnesis sorts by time, and these entries are already in dialog order: a form that follows an action never sorts above it.
    let latest = "";
    const inOrder = (at: string) => { const iso = new Date(at).toISOString(); latest = iso > latest ? iso : latest; return latest; };
    for (const entry of visibleEntries) {
      const node = <Messages voiceRequests={voiceRequests} onMessage={onMessage} bpPhoto={bpPhoto} onPlan={onPlan} journeyEnabled={!!onboarding} stepsDisabled={cards.nextStepStatus==='unavailable'||!!openFlags(cards.cards)} entries={[entry]} whole={visibleEntries} focusCard={focusCard} canFocus={isFollowing} onCard={onCard} onAct={onAct} onQuestions={onQuestions} locale={l} emergencies={emergencies} messages={thread.messages} tasks={cards.tasks} offerMedicines={offerMedicines} />;
      if (entry.type === "item") {
        const { item } = entry;
        const at = "at" in item ? item.at : turns.at(-1)?.at ?? "";
        const emergency = item.kind === "member" && emergencies[item.requestId ?? item.key]?.text === item.text;
        if (at && !Number.isNaN(Date.parse(at))) inOrder(at);
        turns.push({ key: item.key, at, emergency, node });
      } else if (entry.type === "turn") turns.push({ key: `turn-${entry.card.id}-${entry.item}`, at: inOrder(entry.at), node });
      // The anamnesis sorts these as text, and the database's own time format does not sort beside its answers.
      else turns.push({ key: `card-${entry.card.id}`, at: inOrder(entry.card.at), form: entry.card.state === "open", node });
    }
    return turns;
  }, [visibleEntries, focusCard, isFollowing, onCard, onAct, onQuestions, onPlan, onMessage, offerMedicines, l, emergencies, thread.messages, cards.tasks, cards.nextStepStatus, cards.cards, onboarding,bpPhoto, voiceRequests]);
  useNoticeSeen(threadRef, thread.notices);
  useLayoutEffect(() => {
    const landed = cards.cards.filter(card => acting.current.has(card.id) && cardTurns(card,!!onboarding).length);
    for (const card of landed) acting.current.delete(card.id);
    if (landed.length) {newest();if(onboarding)window.dispatchEvent(new Event(CARD_REPLY_LOST));}
  }, [cards.cards, newest, onboarding]);
  // Grows with the text up to COMPOSER_LINES, then scrolls inside the field. Layout only: the thread's own observer follows.
  useLayoutEffect(() => { if (input.current) fitComposer(input.current); }, [text, input]);
  // Only while a question is showing, and the composer says why. An abandoned question never locks the chat.
  const locked = cards.enabled && !!openFlags(cards.cards);
  const strip = cards.enabled ? contextStrip(cards.cards) : null;
  const latestAnswer = (thread.answers ?? []).at(-1);
  const urgentKey = Object.keys(emergencies).sort().join("|") || (assessment && firesEmergency({answers:assessment.answers,observations:[]}) ? "assessment" : null);
  const conversation = useConversation({enabled:!!voice?.conversation,disabled:!initial || locked || menu || voiceBusy || !consentClear,locale:l,
    live:!!voice?.live,streamSpeech:!!voice?.stream,
    onTranscript:result=>{
      // A Live turn has no server receipt: its send asks the server for a Live marker instead ("live").
      const live="origin" in result&&result.origin==="live";
      voiceTurn.current={text:result.text.trim(),origin:live?"live":"batch",urgent:!!result.urgent,...(!live&&result.receipt?{receipt:result.receipt}:{})};
      state.setVoiceText(result.text,live?"live":result.receipt,result.urgent);
    },onSend:()=>{void voiceSend();},
    reply:latestAnswer?{key:latestAnswer.id,text:latestAnswer.text}:null,urgentKey,
    failureKey:[...shown.filter(p=>p.state==='failed').map(p=>p.requestId),notice&&!['empty','doctor_sent'].includes(notice)?notice:''].filter(Boolean).join('|')||null});
  // WP V: a finished voice turn may be a spoken yes to the pending card, or open a card; otherwise it is the ordinary send.
  // An urgent turn never waits for this: it goes straight to the ordinary send, which is the urgent path.
  const voiceSend = async (via?: "enter") => {
    const turn = voiceTurn.current; voiceTurn.current = null;
    if (!turn || turn.urgent || turn.text !== text.trim()) { newest(); submit(via); return; }
    let outcome: VoiceTurnOutcome = { kind: "send" };
    try { const { handleVoiceTurn } = await import("./voice-turn"); outcome = await handleVoiceTurn(turn, l, voicePending); } catch { outcome = { kind: "send" }; }
    if (outcome.kind === "send") { newest(); submit(via); return; }
    setText("");
    for (const card of outcome.cards) onCard(card);
    const pending = outcome.pending;
    if (pending !== "keep") setVoicePending(pending);
    const account = outcome.cards.find(card => card.kind === "account");
    if (account) setVoiceRequests(current => ({ ...current, [account.id]: pending !== "keep" && pending?.action.kind === "reminders" ? { time: pending.action.time, target: pending.action.target } : null }));
    newest();
    conversation.say(outcome.speak);
    if (outcome.href) window.location.assign(outcome.href);
  };
  // WP V: a card that waits for an explicit confirmation (consents, caregiver) announces its pending choice, so a spoken
  // yes confirms exactly that choice; the server issues the nonce bound to the card and its revision.
  useEffect(() => {
    if (!voice) return;
    let latest = 0;
    const pending = (event: Event) => {
      const detail = (event as CustomEvent<{ cardId: string; action: import("@/lib/zoe-chat-actions/voice-card").VoicePending }>).detail;
      if (!detail?.cardId) return;
      const ticket = ++latest;
      void import("./voice-turn").then(m => m.pendingFor(detail.cardId, detail.action)).then(next => { if (ticket === latest) setVoicePending(next); }, () => {});
    };
    const clear = (event: Event) => { const id = (event as CustomEvent<{ cardId: string }>).detail?.cardId; latest++; setVoicePending(current => current && (!id || current.cardId === id) ? null : current); };
    window.addEventListener("cv2-voice-pending", pending); window.addEventListener("cv2-voice-pending-clear", clear);
    return () => { window.removeEventListener("cv2-voice-pending", pending); window.removeEventListener("cv2-voice-pending-clear", clear); };
  }, [voice]);
  const send = (via?: "enter") => { if (locked || voiceBusy) return; if(text.trim())conversation.sent(); void voiceSend(via); };
  const initials = memberName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  return <VoicePlayback enabled={!!voice} locale={l}><main className="cv2-root" lang={l} data-chat-v2 data-voice-confirm={voice?.microphone || voice?.conversation ? "on" : undefined}>
    <header className="cv2-header">
      <h1><i className="cv2-orb" aria-hidden />{noreonName(l)}</h1>
      <Call103 size="pill" className="cv2-help" label={tx(l, "Զանգահարել 103", "Call 103", "Позвонить 103")}><Phone size={14} aria-hidden />103</Call103>
      <button type="button" className="cv2-avatar" onClick={() => setMenu(true)} aria-label={tx(l, "Բացել մենյուն", "Open menu", "Открыть меню")}><span>{initials || "N"}</span></button>
    </header>
    <div className="cv2-greet"><h2>{zoeName(l)}</h2><p>{tx(l, "ԱԲ օգնական, ոչ բժիշկ", "AI assistant, not a doctor", "ИИ-помощник, не врач")}</p></div>
    {initial && <OfflineBanner locale={l} queued={state.queuedCount} onCard={onCard} />}
    <section className="cv2-thread" ref={threadRef} role="log" aria-live="polite" aria-relevant="additions" aria-label={tx(l, "Զրույց Զոյայի հետ", "Conversation with Zoe", "Переписка с Зоей")} data-zoe-thread tabIndex={0}>
      <div className="cv2-messages" ref={contentRef}>
        <CaregiverInvitations invitations={caregiverInvitations} locale={l} />
        {!items.length && !shown.length && <article className="cv2-msg cv2-zoe"><p className="cv2-say cv2-welcome">{tx(l, `Բարև, ${memberName}։ Ինչպե՞ս կարող եմ օգնել այսօր։`, `Hello, ${memberName}. How can I help today?`, `Здравствуйте, ${memberName}. Чем я могу помочь сегодня?`)}</p></article>}
        {!showAnamnesis && <Messages onMessage={onMessage} bpPhoto={bpPhoto} onPlan={onPlan} journeyEnabled={!!onboarding} stepsDisabled={cards.nextStepStatus==='unavailable'||!!openFlags(cards.cards)} entries={visibleEntries} focusCard={focusCard} canFocus={isFollowing} onCard={onCard} onAct={onAct} onQuestions={onQuestions} locale={l} emergencies={emergencies} messages={thread.messages} tasks={cards.tasks} offerMedicines={offerMedicines} />}
        {consent && <article className="cv2-msg cv2-zoe cv2-consent"><ZoeChatConsent locale={l} directAnswers={consent.directAnswers} shownText={!!onboarding} onResolved={accepted => { setConsentResolved(true); setConsentAccepted(accepted === true); }} /></article>}
        {assessment && showAnamnesis && <Anamnesis key={assessment.id} initial={assessment} locale={l} emergencyCard={emergencyCard} onTurn={onQuestionTurn} onAction={newest} threadTurns={questionThread} revision={languageRevision} onState={onQuestionnaireState} onComplete={onboarding?onQuestionComplete:undefined} disabled={menuBusy} fillRef={fillQuestion} showProgress={!!onboarding} refreshOnComplete={refreshOnComplete} />}
        {shown.map(p => <Fragment key={p.requestId}>
          <article className="cv2-msg cv2-me" data-pending={p.state}><p className="cv2-say">{p.text}</p>
            <p className="cv2-time">{p.state === "sending" ? tx(l, "Ուղարկվում է", "Sending", "Отправляется") : p.state === "queued" ? offlineText(l, "queued") : tx(l, "Չուղարկվեց։", "Not sent.", "Не отправлено.")}</p>
            {p.state === "failed" && <button type="button" onClick={() => { newest(); deliver(p); }}>{tx(l, "Կրկին փորձել", "Try again", "Попробуйте снова")}</button>}
          </article>
          {emergencies[p.requestId]?.text === p.text && <ZoeEmergencyCard locale={l} request={emergencies[p.requestId].request} contained />}
        </Fragment>)}
        {opening?.kind === "bp" && <article className="cv2-msg cv2-zoe" role="status">
          {opening.state === "busy" ? <p>{say(l, COMMON.offer)}</p> : opening.state === "signed_out" ? <SignInEnded locale={l} /> : <>
            <p>{say(l, opening.state === "rate_limited" ? COMMON.rateLimited : COMMON.openFailed)}</p>
            <button type="button" onClick={() => openCard("bp", opening.seq, opening.requestId)}>{tx(l, "Կրկին փորձել", "Try again", "Попробуйте снова")}</button>
          </>}
        </article>}
        {cards.visitStatusUnavailable&&<p className="cv2-say" role="status">{say(l,LIVING_VISIT.unavailable)}</p>}
        {opening && opening.kind !== "bp" && <article className="cv2-msg cv2-zoe" role="status" data-card-opening={opening.state}>
          {opening.state === "busy" ? <p className="cv2-say">{say(l, ONBOARDING.working)}</p> : opening.state === "signed_out" ? <SignInEnded locale={l} /> : opening.state === "held_urgent" ? <>
            <p className="cv2-say">{say(l, opening.call103 ? FLOW.call103 : COMMON.visitHeld)}</p>
            {opening.call103 && <Call103 size="call" className="emergency-call flex min-h-14 items-center justify-center rounded-md px-5 py-3">{tx(l, "Զանգահարել 103", "Call 103", "Позвонить 103")}</Call103>}
          </> : <>
            <p className="cv2-say">{say(l, opening.state === "rate_limited" ? COMMON.rateLimited : COMMON.openFailed)}</p>
            <button type="button" className="cv2-link" onClick={() => openCard(opening.kind, opening.seq, opening.requestId)}>{say(l, COMMON.retry)}</button>
          </>}
        </article>}
        {onboarding && questionnaireFinished && !cards.nextStepStatus && !cards.cards.some(c=>c.kind==='next_step') && <p className="cv2-say" role="status">{say(l,ONBOARDING.working)}</p>}
        {onboarding && consentClear && quiet && !locked && (cards.nextStepStatus==='unavailable' || (cards.nextStepStatus==='waiting' && !cards.cards.some(c=>c.state==='open'&&SHOWN(c,!!onboarding)&&c.kind!=='results'&&!cards.cards.some(newer=>newer.kind===c.kind&&Date.parse(newer.at)>Date.parse(c.at))))) && <article className="cv2-msg cv2-zoe" data-next-step-status={cards.nextStepStatus}><p className="cv2-say" role="status">{say(l,cards.nextStepStatus==='unavailable'?NEXT_STEP.unavailable:NEXT_STEP.waiting)}</p></article>}
        {!initial && <p role="status">{tx(l, "Զրույցը հիմա հասանելի չէ։ Փորձեք ավելի ուշ։", "Chat is unavailable right now. Try again later.", "Чат сейчас недоступен. Попробуйте позже.")}</p>}
        {/* A failed next-step read says so once: the status block above is the one line, so the journey sentence stays out when it would repeat it. */}
        {assessment?.completedAt && nextStepLine && !(onboarding && consentClear && quiet && !locked && cards.nextStepStatus==='unavailable') && <article className="cv2-msg cv2-zoe" role="status" data-journey-stage={nextStepLine.stage ?? "unavailable"}>
          <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
          <p className="cv2-say">{nextStepLine.text[l]}</p>
          {nextStepLine.href && nextStepLine.stage !== "plan_confirmed" && nextStepLine.stage !== "waiting" && <a className="cv2-next-link" href={nextStepLine.href}>
            {nextStepLine.stage === null ? tx(l, "Բացել իմ գլխավոր էջը", "Go to my home page", "Перейти на мою главную страницу") : tx(l, "Տեսնել իմ հաջորդ քայլը", "See my next step", "Посмотреть мой следующий шаг")}
          </a>}
        </article>}
        {memberPush && initial && <MemberPushPrompt locale={l} publicKey={memberPush.publicKey} quiet={!!assessment && !assessment.completedAt} />}
        <ZoeNotice locale={l} notice={notice} contained />
      </div>
    </section>
    {unread && <button type="button" className="cv2-new" onClick={newest} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}>{tx(l, "Նոր հաղորդագրություն", "New message", "Новое сообщение")}</button>}
    <footer className="cv2-bottom">
      <ComposerWaiting locale={l} />
      {strip && <ContextStripView strip={strip} locale={l} />}
      {initial && cards.enabled && <ChatSuggestions
        suggestions={(consent && !consentResolved) || justActed || Object.keys(state.localEmergencies).length ? [] : suggestionsFor(thread.suggestionState ? { ...thread.suggestionState, locale: l } : null).filter(s => s.id === "bp" && !cards.cards.some(c => c.valid && c.state === "open" && SHOWN(c,!!onboarding)))}
        hidden={!!text || keyboardOpen}
        label={tx(l, "Առաջարկվող հաղորդագրություններ", "Suggested messages", "Предлагаемые сообщения")}
        onSend={value => { newest(); submit("button", value); }} />}
      <form className="cv2-composer" onSubmit={event => { event.preventDefault(); send(); input.current?.focus({ preventScroll: true }); }}>
        {onboarding && <ZoeAttach locale={l} camera disabled={!initial || !consentClear || !quiet} onSaved={(_name, _duplicate, id) => { if (!id) return; newest(); void openDocumentCard({documentId:id,requestId:id}).then(r => { if (r.card) onCard(r.card); else setNotice("unavailable"); }).catch(() => setNotice("unavailable")); }} />}
        <textarea ref={input} rows={1} autoComplete="off" value={text} maxLength={ZOE_CHAT_MAX} disabled={!initial || locked || voiceBusy}
          aria-label={tx(l, "Ձեր հաղորդագրությունը", "Your message", "Ваше сообщение")}
          placeholder={locked ? say(l, FLOW.composerLocked) : tx(l, "Հարցրեք Զոյային…", "Ask Zoe…", "Спросите Зою…")}
          onPointerDown={()=>conversation.edit()}
          onChange={event => { conversation.edit(); voiceTurn.current = null; setText(event.target.value); if (notice) setNotice(null); }}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (!(event.metaKey || event.ctrlKey) && window.matchMedia("(pointer: coarse)").matches) return;
            event.preventDefault(); send("enter");
          }} />
        {voice?.microphone && <Microphone locale={l} disabled={!initial || locked || menu || conversation.active} onBusy={setVoiceBusy} onTranscript={(value,receipt) => { voiceTurn.current = text ? null : { text: value.trim(), origin: "batch", urgent: false, ...(receipt ? { receipt } : {}) }; state.setVoiceText(text ? `${text} ${value}` : value,receipt); input.current?.focus({preventScroll:true}); }} />}
        {voice?.conversation && <ConversationToggle locale={l} conversation={conversation} disabled={!initial || locked || menu || voiceBusy || !consentClear || (!conversation.active && !!text.trim())} />}
        <button type="submit" disabled={!initial || !hydrated || locked || voiceBusy} aria-label={tx(l, "Ուղարկել", "Send", "Отправить")} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}><ArrowUp size={18} strokeWidth={2.4} aria-hidden /></button>
      </form>
    </footer>
    {menu && <ChatMenu previousChat={!!onboarding} overview={overview} onPlan={onboarding && cards.enabled ? () => { newest(); onPlan(); } : undefined} onResults={onboarding&&cards.enabled?()=>{newest();openCard("results",null);}:undefined} onMessage={onboarding&&cards.enabled?onMessage:undefined} locale={l} revision={languageRevision} disabled={questionnairePending || menuBusy} onBusy={setMenuBusy} onLocale={(next, savedRevision) => { setLocale(next); setLanguageRevision(savedRevision); }} onClose={() => setMenu(false)} onSignedOut={() => onSignedOut(l)} onConsult={onboarding && cards.enabled ? () => { newest(); openCard("symptom_gate", null); } : undefined} onQuestions={onboarding && cards.enabled ? onQuestions : undefined} onVisit={onboarding && cards.enabled ? () => { newest(); openCard("visit", null); } : undefined} onMedicines={onboarding && cards.enabled ? () => { newest(); openCard("medicines", null); } : undefined} onCaregivers={onboarding && cards.enabled && settings?.caregivers ? () => { newest(); openCard("caregiver", null); } : undefined} onConsents={onboarding && cards.enabled && settings?.consents ? () => { newest(); openCard("consents", null); } : undefined} caring={!!settings?.caregivers} />}
  </main></VoicePlayback>;
}
