'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {after} from 'next/server';
import {enrolAfterQuestionnaire} from '@/lib/patient-care/enrolment';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {ruleById} from '@/lib/clinical/rules/rules';
import {patientIdentity,patientIdentityForSave} from '@/lib/patient/auth';
import {patientStore,requireRegistered} from '@/lib/patient/repository';
import {createPatientService} from '@/lib/patient/service';
import {anamnesisSource} from '@/lib/patient/zoe-app-v3';
import {careAlertMemberStatus} from './member';
import {reviewableAnswer,urgentAnswerReviewEnabled} from './urgent-review';

const to=(path:string):never=>redirect(path as Route);

/**
 * Saves the member's corrected answer to the one question that fired their red flag. The
 * database records the change (urgent_answer_changes) and alerts the care team whether or not
 * the red flag clears; this action refuses unless care-team alerts are on.
 */
export const reviewUrgentAnswer=loggedAction("reviewUrgentAnswer",async function reviewUrgentAnswer(form:FormData){
 if(!urgentAnswerReviewEnabled())to('/patient/urgent');
 // A slow auth service shows the retry error, not a sign-out (Fable U5, QA M-09).
 let who;try{who=await patientIdentityForSave();}catch{to('/patient/urgent/review?error=unavailable');}
 // A plain form post can run before the page's scripts, so it carries the account itself (Astra R2).
 if(who&&form.get('account')!==who.userId)to('/patient/urgent/review?error=account');
 const {assessment}=await requireRegistered();
 const rule=assessment.urgentRule?ruleById(assessment.urgentRule):undefined;
 if(!rule||rule.urgency!=='red')to('/patient/questions');
 const status=await careAlertMemberStatus();
 if(!status?.alertsEnabled)to('/patient/urgent');
 const review=reviewableAnswer(rule!,assessment.answers);
 const fieldId=form.get('fieldId'),value=form.get('value');
 if(!review||fieldId!==review.field.id||typeof value!=='string'||!review.field.options.some(o=>o.value===value))to('/patient/urgent/review?error=invalid');
 if(value===review!.value)to('/patient/urgent/review?error=unchanged');
 const result=await createPatientService({user:patientIdentity,store:patientStore,answerSource:anamnesisSource}).saveAnswers({
  expectedAssessmentId:assessment.id,expectedRevision:assessment.revision,entries:[{fieldId:review!.field.id,value:value as string}],
 });
 if(!result.ok)to(`/patient/urgent/review?error=${result.reason==='conflict'?'conflict':'unavailable'}`);
 // A corrected answer that finishes the questionnaire enrols like any other save (Fable #277 F1).
 const reason=result.ok?result.enrol:undefined;
 if(reason)after(()=>enrolAfterQuestionnaire(reason));
 for(const path of ['/patient/dashboard','/patient/questions','/patient/urgent'])revalidatePath(path);
 // The urgent page sends the member on to the questionnaire when no red flag remains.
 to('/patient/urgent?changed=1');
});
