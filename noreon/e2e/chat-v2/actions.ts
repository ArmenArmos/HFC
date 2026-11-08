// Local browser fixture boundaries only. Production hooks, safety matchers and views are real.
import { mergeAnswers } from '@/lib/patient/questionnaire';
import type { FieldValue } from '@/lib/clinical/types';
const post = async (path: string, input: unknown) => (await fetch(`/fixture/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
})).json();
export const sendZoeChatMessage = (requestId: string, text: string, toDoctor: boolean, _inlineEmergency: boolean, voiceReceipt?: unknown) => post('send', { requestId, text, toDoctor, voiceReceipt });
export const startNewZoeQuestion = () => post('question', {});
export const openZoeCard = (input: unknown) => post('open-card', input);
export const recordBpFromCard = (input: unknown) => post('save-bp', input);
export const recordRepeatFromCard = (input: unknown) => post('save-repeat', input);
export const answerRedFlagFromCard = (input: unknown) => post('answer-flag', input);
export const openEverydayCard = () => { throw Error('Hidden card opened'); };
export const saveProfile = (input: unknown) => post('profile', input);
export const signOut = () => post('sign-out', {});
export const saveLanguagePreference = (input: unknown) => post('language', input);
export const acceptZoeFromChat = () => post('consent', {});
export const acceptZoeConsentShown = (input: unknown) => post('consent', input);
export const saveProfileFromCard = (input: unknown) => post('save-profile', input);
export const readMedicinesForReview = (id: string) => post('read-medicines', {id});
export const reviewMedicinesFromCard = (input: unknown) => post('review-medicines', input);
export const restoreMedicineFromCard = (input: unknown) => post('restore-medicine', input);
export const readZoeUrgentStatus = () => post('urgent-status', {});
export const saveQuestionnaireAnswers = async (input: {entries:Array<{fieldId:string;value:FieldValue|null}>}) => {
  const nextAnswers=mergeAnswers(window.fixture.assessment!.answers,input.entries);
  const result=await post('answers', {...input,nextAnswers});
  if(result.ok) window.fixture.assessment={...window.fixture.assessment!,answers:nextAnswers,revision:result.revision};
  return result;
};
export const completeAssessment = (revision: number, id: string) => post('complete', { revision, id });

export const followNextStep = (input:unknown) => post('follow-next-step',input);
export const requestReviewFromCard = (input:unknown) => post('request-review',input);
export const sendFromCard = (input:unknown) => post('send-card',input);
export const readPlanFromCard = (id:string) => post('read-plan',{id});
export const saveEverydayFromCard = () => Promise.resolve({status:'disabled'});
export const openDocumentCard = (input: unknown) => post('open-document', input);
export const saveDocumentDetailsFromCard = (input: unknown) => post('save-document', input);
export const readVisitBookingFromCard = (id: string) => post('read-visit', {id});
export const bookVisitFromCard = (input: unknown) => post('book-visit', input);
export const acceptVisitFromCard = (input: unknown) => post('accept-visit', input);
export const memberBookingCommand = () => { throw Error('Unscoped booking action called'); };
export const askAdminToChangeVisit = (input: unknown) => post('admin-visit', input);
export const answerLabCard = (input: unknown) => post('lab-reply', input);
export const answerSymptomGate = (input: unknown) => post('symptom-gate', input);
export const sendConsultQuestions = (input: unknown) => post('consult-questions', input);
export const confirmPlanFromCard = (input: unknown) => post('confirm-plan', input);
export const logV3DoseFromCard = (input: unknown) => post('dose', input);
export const answerV3DoseReason = (input: unknown) => post('dose-reason', input);
export const answerSamsFromCard = (input: unknown) => post('sams', input);

export const requestVisitFromCard = (input: unknown) => post('request-visit', input);
