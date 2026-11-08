import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemberChat } from '@/components/chat-v2/member-chat';
import { MemberOverview } from '@/components/chat-v2/overview';
import { buildOverview } from '@/lib/patient/overview';
import { overviewFacts } from './overview-facts';
import { ZoeQuestionnaireOnboarding } from '@/components/patient/zoe-questionnaire';
import { AccountBinding } from '@/components/patient/account-binding';
import type { ZoeThread } from '@/lib/zoe/app-chat-contracts';
import type { ZoeCards } from '@/lib/zoe-chat-actions/registry';
import type { PatientLocale } from '@/lib/patient/copy';
import type { AssessmentDraft } from '@/lib/patient/types';

declare global { interface Window { fixture: { voice?: {microphone:boolean;conversation?:boolean}; thread: ZoeThread; cards: ZoeCards; locale: PatientLocale; consent?: boolean; unavailable?: boolean; assessment?: AssessmentDraft; signup?: boolean; overview?: boolean; emergencyCard?: boolean; memberPush?: { publicKey: string }; onboarding?: { profileRequest: string | null } } } }
const signup = window.fixture.signup;
const overviewPage = window.location.pathname === '/patient/chat/overview';
createRoot(document.getElementById('root')!).render(overviewPage ? <MemberOverview locale={window.fixture.locale} data={buildOverview(overviewFacts(new URLSearchParams(window.location.search), window.fixture.locale))} /> : signup ? <main className="mx-auto max-w-lg p-4" data-fixture-signup>
  <ZoeQuestionnaireOnboarding expectedRevision={-1} today="2026-11-03" initialLocale={window.fixture.locale} draftKey={new URLSearchParams(window.location.search).get('draft') ?? undefined} zoeStatement languageCard={new URLSearchParams(window.location.search).has('language-card')} />
</main> : <>
  <AccountBinding userId="fixture-member" />
  <MemberChat voice={window.fixture.voice} overview={window.fixture.overview} memberPush={window.fixture.memberPush} locale={window.fixture.locale} memberName="Ani" revision={window.fixture.assessment?.revision ?? 1}
    cards={window.fixture.cards} onboarding={window.fixture.onboarding} assessment={window.fixture.assessment} emergencyCard={window.fixture.emergencyCard}
    initial={window.fixture.unavailable ? null : window.fixture.thread}
    emergencyCheck={{env: {NOREON_ZOE_TEST_LEXICON: 'true', NOREON_ZOE_URGENT_PLACEHOLDER: 'true'}, intake: {enabled:true,active:true}}}
    consent={window.fixture.consent ? {directAnswers: false} : null} />
</>);
