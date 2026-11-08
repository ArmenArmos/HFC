import { bpPhotoEnabled } from "@/lib/bp-photo/config";
import { notFound, redirect } from "next/navigation";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { patientPresentation } from "@/lib/patient/presentation";
import { readZoeAccess } from "@/app/patient/zoe/chat-access";
import { readZoePrompt } from "@/lib/zoe/member";
import { readIntakeState } from "@/lib/zoe/app-chat";
import { zoeEmergencyCardEnabled, zoeEmergencyCheck } from "@/lib/zoe/member-screen";
import { memberPushConfig } from "@/lib/member-push/config";
import { zoeAppV3Enabled } from "@/lib/patient/zoe-app-v3";
import { memberNextStepEnabled } from "@/lib/patient/member-next-step";
import { readZoeCards } from "@/lib/zoe-chat-actions/server";
import { NO_CARDS } from "@/lib/zoe-chat-actions/registry";
import { readProfileOffer } from "@/lib/zoe-chat-actions/onboarding-read";
import { voiceAvailable } from "@/lib/zoe-chat-actions/voice";
import { readMemberSuggestionState } from "@/lib/chat/suggestion-read";
import { MemberChat, type MemberChatNextStep } from "@/components/chat-v2/member-chat";
import { readJourneyStage } from "@/lib/patient/journey-read";
import { STAGE_CLASSES, STAGE_LINKS } from "@/lib/patient/journey-stage";
import { memberJourneyStep } from "@/lib/patient-care/journey-step";
import "@/components/chat-v2/chat.css";

export const metadata = { title: "Noreon chat" };

export default async function MemberChatPage() {
  if (process.env.NOREON_MEMBER_CHAT_V2 !== "true") notFound();
  const member = await requireRegisteredForRender();
  const { profile, assessment } = member;
  const emergencyCard = zoeEmergencyCardEnabled();
  if (patientPresentation(assessment).urgent && !emergencyCard) redirect("/patient/urgent");
  const access = await readZoeAccess();
  const prompt = access.kind === "chat" ? await readZoePrompt().catch(() => null) : null;
  const emergencyCheck = access.kind === "chat" && emergencyCard
    ? zoeEmergencyCheck(await readIntakeState().catch(() => null)) : null;
  // With the switch off this page reads no cards and asks for none.
  const cards = access.kind === "chat" && zoeAppV3Enabled() ? await readZoeCards() : NO_CARDS;
  if (access.kind === "chat" && cards.enabled) access.thread.suggestionState = await readMemberSuggestionState(access.thread);
  let nextStep: MemberChatNextStep | undefined;
  const stepOn = access.kind === "chat" && memberNextStepEnabled();
  if (stepOn && assessment.completedAt) {
    const journey = await readJourneyStage(member).catch(() => null);
    nextStep = journey ? {
      stage: journey.stage, text: STAGE_CLASSES[journey.stage], href: memberJourneyStep(journey.input)?.href ?? STAGE_LINKS[journey.stage] ?? null,
    } : {
      stage: null, href: "/patient", text: {
        hy: "Հիմա հասանելի չէ։ Ձեր հաջորդ քայլը ձեր գլխավոր էջում է։",
        en: "Not available right now. Your next step is on your home page.",
        ru: "Сейчас недоступно. Ваш следующий шаг на вашей главной странице.",
      },
    };
  }
  const v3 = zoeAppV3Enabled();
  // With the switch off nothing here runs: no offer is read and the chat gets none of the new blocks.
  const onboarding = v3 ? { profileRequest: await readProfileOffer(cards, !!prompt?.zoeScreen) } : undefined;
  const push = memberPushConfig();
  const voiceOn = access.kind === "chat" && v3 && await voiceAvailable();
  return <MemberChat bpPhoto={bpPhotoEnabled()} voice={access.kind === "chat" && v3 ? { microphone: voiceOn, conversation: voiceOn } : undefined} {...(stepOn ? { nextStep, refreshOnComplete: true } : {})} cards={cards} onboarding={onboarding} overview={zoeAppV3Enabled()} locale={profile.locale} memberName={profile.name} revision={assessment.revision}
    assessment={assessment} emergencyCard={emergencyCard}
    memberPush={push && access.kind === "chat" ? { publicKey: push.publicKey } : null}
    initial={access.kind === "chat" ? access.thread : null} emergencyCheck={emergencyCheck}
    consent={prompt?.zoeScreen ? { directAnswers: prompt.directAnswers } : null} />;
}
