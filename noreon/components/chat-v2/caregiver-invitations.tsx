"use client";
import { useRef, useState, useTransition } from "react";
import { HeartHandshake } from "lucide-react";
import { answerCaregiverInvitationAction, type InvitationAnswer } from "@/lib/caregivers/actions";
import type { CaregiverInvitation } from "@/lib/caregivers/schema";
import { RELATIONSHIP_LABEL, SCOPE_LABEL } from "@/lib/consents/copy";
import { CAREGIVER, INVITATION, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import { zoeName } from "@/lib/brand";

/**
 * A pending caregiver invitation for the signed-in phone number, as a Zoe message: who asks, exactly what would be
 * shared, and an explicit two-step accept. The database matches the invitation to this account's confirmed phone.
 */
function InvitationCard({ invitation, locale: l, onAnswered }: { invitation: CaregiverInvitation; locale: CardLocale; onAnswered: (id: string, status: InvitationAnswer["status"]) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [answer, setAnswer] = useState<InvitationAnswer["status"] | null>(null);
  const [busy, start] = useTransition();
  const sending = useRef(false);
  const who = invitation.memberFirstName ?? say(l, INVITATION.someone);
  const send = (accept: boolean) => {
    if (sending.current) return;
    sending.current = true;
    start(async () => {
      let status: InvitationAnswer["status"] = "unavailable";
      try { status = (await answerCaregiverInvitationAction({ id: invitation.id, accept })).status; }
      catch (error) { if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error; }
      setAnswer(status);
      if (status === "active" || status === "declined") onAnswered(invitation.id, status);
      sending.current = false;
    });
  };
  const done = answer === "active" || answer === "declined";
  return <article className="cv2-msg cv2-zoe" data-caregiver-invitation={invitation.id}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading cv2-block" aria-label={say(l, INVITATION.title)}>
      <h3><HeartHandshake size={18} aria-hidden />{say(l, INVITATION.title)}</h3>
      <p>{say(l, INVITATION.lead(who))} ({say(l, RELATIONSHIP_LABEL[invitation.relationship])})</p>
      <p>{say(l, INVITATION.scopes)}</p>
      <ul>{invitation.scopes.map(scope => <li key={scope}>{say(l, SCOPE_LABEL[scope])}</li>)}</ul>
      <p>{say(l, INVITATION.limits)}</p>
      {answer === "active" && <p role="status">{say(l, INVITATION.accepted)}</p>}
      {answer === "declined" && <p role="status">{say(l, INVITATION.declined)}</p>}
      {answer && !done && <p role="alert">{say(l, ["not_found", "closed", "expired", "duplicate"].includes(answer) ? INVITATION.gone : INVITATION.failed)}</p>}
      {!done && !confirming && <div className="cv2-seg">
        <button type="button" disabled={busy} onClick={() => setConfirming(true)}>{say(l, INVITATION.accept)}</button>
        <button type="button" disabled={busy} aria-busy={busy} onClick={() => send(false)}>{say(l, INVITATION.decline)}</button>
      </div>}
      {!done && confirming && <div className="cv2-block">
        <button type="button" className="cv2-reading-save" disabled={busy} aria-busy={busy} onClick={() => send(true)}>{say(l, INVITATION.confirmAccept)}</button>
        <button type="button" className="cv2-link" disabled={busy} onClick={() => setConfirming(false)}>{say(l, CAREGIVER.back)}</button>
      </div>}
    </section>
  </article>;
}

export function CaregiverInvitations({ invitations, locale, onAnswered }: { invitations: readonly CaregiverInvitation[]; locale: CardLocale; onAnswered?: (id: string, status: InvitationAnswer["status"]) => void }) {
  if (!invitations.length) return null;
  return <>{invitations.map(invitation => <InvitationCard key={invitation.id} invitation={invitation} locale={locale} onAnswered={onAnswered ?? (() => {})} />)}</>;
}
