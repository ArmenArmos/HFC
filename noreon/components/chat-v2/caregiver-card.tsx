"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { UsersRound } from "lucide-react";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { inviteCaregiverFromCard, revokeCaregiverFromCard, updateCaregiverScopesFromCard } from "@/lib/caregivers/actions";
import { E164, caregiverItem, normalizePhone, type CaregiverReceipt } from "@/lib/caregivers/schema";
import { CAREGIVER_RELATIONSHIPS, CAREGIVER_SCOPES, RELATIONSHIP_LABEL, SCOPE_LABEL, caregiverConsentLines, type CaregiverRelationship, type CaregiverScope } from "@/lib/consents/copy";
import { CAREGIVER, COMMON, CONSENTS, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import type { ValidCard, ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
import { zoeName } from "@/lib/brand";

type Card = Extract<ValidCard, { kind: "caregiver" }>;
type Result = Awaited<ReturnType<typeof inviteCaregiverFromCard>>;
type Props = { card: Card; locale: CardLocale; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void };

/** One server action, with the chat's usual handling of a lost reply and of a redirect. */
async function press(run: () => Promise<Result>): Promise<Result | null> {
  try { return await run(); }
  catch (error) {
    if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error;
    window.dispatchEvent(new Event(CARD_REPLY_LOST));
    return null;
  }
}
const problemText = (l: CardLocale, r: Result | null) => {
  if (r === null) return say(l, COMMON.unconfirmed);
  if (r.status === "signed_out") return "signed_out";
  if (r.status === "stale") return say(l, COMMON.staleInChat);
  if (r.status === "closed") return say(l, COMMON.closed);
  if (r.reason === "limit") return say(l, CAREGIVER.limit);
  if (r.reason === "duplicate") return say(l, CAREGIVER.duplicate);
  if (r.reason === "own_phone") return say(l, CAREGIVER.ownPhone);
  return say(l, COMMON.saveFailed);
};

function ScopeChecks({ l, value, onChange, disabled, legend }: { l: CardLocale; value: CaregiverScope[]; onChange: (next: CaregiverScope[]) => void; disabled: boolean; legend: string }) {
  return <fieldset disabled={disabled}>
    <legend>{legend}</legend>
    {CAREGIVER_SCOPES.map(scope => <label key={scope} className="cv2-check">
      <input type="checkbox" checked={value.includes(scope)} onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(s => s !== scope))} />
      <span>{say(l, SCOPE_LABEL[scope])}</span>
    </label>)}
  </fieldset>;
}

/** The exact statement the member confirms; the server hashes these same lines. */
function Statement({ l, name, scopes }: { l: CardLocale; name: string; scopes: CaregiverScope[] }) {
  const [title, ...lines] = caregiverConsentLines(l, name, scopes);
  return <div data-caregiver-statement>
    <p><strong>{title}</strong></p>
    {lines.map((line, i) => <p key={i}>{line}</p>)}
    <p className="cv2-hint">{say(l, CONSENTS.draft)}</p>
  </div>;
}

/** WP V: announces the choice a spoken yes would confirm on this card; the server binds it to the card and its revision. */
function useVoicePending(cardId: string, action: Record<string, unknown> | null) {
  const key = action ? JSON.stringify(action) : "";
  useEffect(() => {
    if (!key) return;
    window.dispatchEvent(new CustomEvent("cv2-voice-pending", { detail: { cardId, action: JSON.parse(key) } }));
    return () => { window.dispatchEvent(new CustomEvent("cv2-voice-pending-clear", { detail: { cardId } })); };
  }, [cardId, key]);
}
const SAY_YES = { en: "Say yes to save", hy: "Ասեք «այո»՝ պահպանելու համար", ru: "Скажите «да», чтобы сохранить" };

function LinkRow({ card, link, locale: l, onCard, onAct }: Props & { link: Card["snapshot"]["links"][number] }) {
  const [mode, setMode] = useState<"idle" | "scopes" | "revoke">("idle");
  const [scopes, setScopes] = useState<CaregiverScope[]>(link.scopes);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [opId] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const scopesDone = card.outcome[caregiverItem.scopes(link.id)] as CaregiverReceipt | undefined;
  const revoked = card.outcome[caregiverItem.revoke(link.id)] as CaregiverReceipt | undefined;
  const live = (link.status === "pending" || link.status === "active") && !revoked;
  useVoicePending(card.id, !live || card.state !== "open" ? null : mode === "revoke" ? { kind: "caregiver_revoke", linkId: link.id, revision: link.revision }
    : mode === "scopes" && scopes.length > 0 ? { kind: "caregiver_scopes", linkId: link.id, revision: link.revision, scopes, locale: l } : null);
  const act = (run: () => Promise<Result>) => {
    if (sending.current) return;
    sending.current = true; onAct(card.id, true);
    start(async () => {
      setProblem(null);
      const r = await press(run);
      if (r?.card) onCard(r.card);
      if (r?.status === "ok") setMode("idle"); else { setProblem(problemText(l, r)); if (r) onAct(card.id, false); }
      sending.current = false;
    });
  };
  return <li data-caregiver-link={link.id}>
    <p><strong>{link.name}</strong>, {say(l, RELATIONSHIP_LABEL[link.relationship])}</p>
    <p className="cv2-hint">{say(l, CAREGIVER.phoneEnds(link.phoneTail))} · {say(l, CAREGIVER.status[revoked ? "revoked" : link.status])}</p>
    <ul>{((scopesDone?.scopes as CaregiverScope[] | undefined) ?? link.scopes).map(scope => <li key={scope}>{say(l, SCOPE_LABEL[scope])}</li>)}</ul>
    {revoked && <p role="status">{say(l, CAREGIVER.revoked)}</p>}
    {scopesDone && !revoked && <p role="status">{say(l, CAREGIVER.scopesSaved)}</p>}
    {live && !scopesDone && mode === "idle" && <div className="cv2-seg">
      <button type="button" onClick={() => setMode("scopes")}>{say(l, CAREGIVER.change)}</button>
      <button type="button" onClick={() => setMode("revoke")}>{say(l, CAREGIVER.revoke)}</button>
    </div>}
    {live && mode === "scopes" && <div className="cv2-block">
      <ScopeChecks l={l} value={scopes} onChange={setScopes} disabled={busy} legend={say(l, CAREGIVER.scopes)} />
      {scopes.length > 0 && <Statement l={l} name={link.name} scopes={scopes} />}
      <button type="button" className="cv2-reading-save" disabled={busy || scopes.length === 0} aria-busy={busy}
        onClick={() => act(() => updateCaregiverScopesFromCard({ cardId: card.id, opId, linkId: link.id, revision: link.revision, scopes, locale: l }))}>{say(l, CAREGIVER.saveScopes)}</button>
      <button type="button" className="cv2-link" disabled={busy} onClick={() => setMode("idle")}>{say(l, CAREGIVER.back)}</button>
      {scopes.length > 0 && <p className="cv2-voice-hint">{say(l, SAY_YES)}</p>}
    </div>}
    {live && mode === "revoke" && <div className="cv2-block">
      <p>{say(l, CAREGIVER.revokeConfirm)}</p>
      <button type="button" className="cv2-reading-save" disabled={busy} aria-busy={busy}
        onClick={() => act(() => revokeCaregiverFromCard({ cardId: card.id, opId, linkId: link.id, revision: link.revision }))}>{say(l, CAREGIVER.revokeYes)}</button>
      <button type="button" className="cv2-link" disabled={busy} onClick={() => setMode("idle")}>{say(l, CAREGIVER.back)}</button>
      <p className="cv2-voice-hint">{say(l, SAY_YES)}</p>
    </div>}
    {problem === "signed_out" ? <SignInEnded locale={l} /> : problem && <p role="alert">{problem}</p>}
  </li>;
}

/** The member invites, changes or withdraws a caregiver. Nothing is saved until the member confirms the shown statement. */
export function CaregiverCard({ card, locale: l, onCard, onAct }: Props) {
  const [step, setStep] = useState<"form" | "review">("form");
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<CaregiverRelationship | null>(null);
  const [scopes, setScopes] = useState<CaregiverScope[]>(["view_plan", "view_readings"]);
  const [problem, setProblem] = useState<string | null>(null), [bad, setBad] = useState<"name" | "phone" | "scopes" | null>(null);
  const [busy, start] = useTransition();
  const [opId] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const invited = card.outcome[caregiverItem.invite] as CaregiverReceipt | undefined;
  const live = card.snapshot.links.filter(link => link.status === "pending" || link.status === "active").length;
  const canInvite = !invited && card.state === "open" && live < card.snapshot.limit;
  useVoicePending(card.id, canInvite && step === "review" && relationship ? { kind: "caregiver_invite", name: name.trim(), relationship, phone: normalizePhone(phone.trim()), scopes, locale: l } : null);
  const review = () => {
    const number = normalizePhone(phone.trim());
    const problemField = !name.trim() ? "name" : !E164.test(number) ? "phone" : scopes.length === 0 || !relationship ? "scopes" : null;
    setBad(problemField);
    if (problemField) { setProblem(say(l, problemField === "name" ? CAREGIVER.badName : problemField === "phone" ? CAREGIVER.badPhone : CAREGIVER.pickScope)); return; }
    setProblem(null); setStep("review");
  };
  const confirm = () => {
    if (sending.current || !relationship) return;
    sending.current = true; onAct(card.id, true);
    start(async () => {
      setProblem(null);
      const r = await press(() => inviteCaregiverFromCard({ cardId: card.id, opId, name: name.trim(), relationship, phone: normalizePhone(phone.trim()), scopes, locale: l, method: "tap" }));
      if (r?.card) onCard(r.card);
      if (r?.status !== "ok") { setProblem(problemText(l, r)); if (r) { onAct(card.id, false); if (r.reason) setStep("form"); } }
      sending.current = false;
    });
  };
  return <article className="cv2-msg cv2-zoe" data-zoe-card="caregiver" data-chat-card-id={card.id} data-state={card.state} onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading cv2-block" aria-label={say(l, CAREGIVER.title)}>
      <h3><UsersRound size={18} aria-hidden />{say(l, CAREGIVER.title)}</h3>
      <p>{say(l, CAREGIVER.lead)}</p>
      {card.snapshot.links.length ? <ul>{card.snapshot.links.map(link => <LinkRow key={link.id} link={link} card={card} locale={l} onCard={onCard} onAct={onAct} />)}</ul> : <p>{say(l, CAREGIVER.none)}</p>}
      {invited && <p role="status" data-caregiver-invited>{say(l, CAREGIVER.invited)}</p>}
      {canInvite && step === "form" && <details>
        <summary>{say(l, CAREGIVER.add)}</summary>
        <div className="cv2-block">
          <label className="cv2-field">{say(l, CAREGIVER.name)}<input type="text" autoComplete="off" maxLength={80} value={name} disabled={busy} aria-invalid={bad === "name"} onChange={event => setName(event.target.value)} /></label>
          <fieldset disabled={busy}>
            <legend>{say(l, CAREGIVER.relationship)}</legend>
            <div className="cv2-seg">{CAREGIVER_RELATIONSHIPS.map(id => <button type="button" key={id} aria-pressed={relationship === id} onClick={() => setRelationship(id)}>{say(l, RELATIONSHIP_LABEL[id])}</button>)}</div>
          </fieldset>
          <label className="cv2-field">{say(l, CAREGIVER.phone)}<input type="tel" inputMode="tel" autoComplete="off" maxLength={20} placeholder="+374" value={phone} disabled={busy} aria-invalid={bad === "phone"} aria-describedby={`${card.id}-phone-hint`} onChange={event => setPhone(event.target.value)} /></label>
          <p id={`${card.id}-phone-hint`} className="cv2-hint">{say(l, CAREGIVER.phoneHint)}</p>
          <ScopeChecks l={l} value={scopes} onChange={setScopes} disabled={busy} legend={say(l, CAREGIVER.scopes)} />
          <button type="button" className="cv2-reading-save" disabled={busy} onClick={review}>{say(l, CAREGIVER.review)}</button>
        </div>
      </details>}
      {canInvite && step === "review" && <div className="cv2-block" data-caregiver-review>
        <p>{say(l, CAREGIVER.confirmLead)}</p>
        <Statement l={l} name={name.trim()} scopes={scopes} />
        <button type="button" className="cv2-reading-save" disabled={busy} aria-busy={busy} onClick={confirm}>{say(l, CAREGIVER.confirmInvite)}</button>
        <button type="button" className="cv2-link" disabled={busy} onClick={() => setStep("form")}>{say(l, CAREGIVER.back)}</button>
        <p className="cv2-voice-hint">{say(l, SAY_YES)}</p>
      </div>}
      {problem === "signed_out" ? <SignInEnded locale={l} /> : problem && <p role="alert">{problem}</p>}
    </section>
  </article>;
}
