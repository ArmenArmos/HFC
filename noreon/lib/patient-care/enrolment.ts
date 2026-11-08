import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {telegramAuthEnabled} from '@/lib/telegram-auth/runtime';
import {demoEnabled} from '@/lib/patient/demo';
import {log,errorFields} from '@/lib/observability/logger';
import {realReviewEnabled} from './real-review-config';

/**
 * Creates the signed-in member's clinical case (enroll_patient_clinical_case: verified profile,
 * enrolment consent and a questionnaire required; idempotent; auto-assigns the least-loaded
 * doctor) and links Telegram replies to their sign-in chat. True when the case exists.
 */
export async function enrolClinicalCase():Promise<boolean>{
 const client=await createClient();
 const {error}=await client.rpc('enroll_patient_clinical_case');
 if(error)return false;
 // Enrolment makes the member eligible for messaging: link replies to their sign-in Telegram chat.
 if(telegramEnabled()&&telegramAuthEnabled())await client.rpc('telegram_replies_auto_link',{p_explicit:false}).then(()=>null,()=>null);
 return true;
}

/**
 * Khikar 18 Oct: a member who finishes the questionnaire (or reaches a red flag in it) appears in
 * the backoffice without pressing "request review". Never blocks the member: a refusal or an
 * outage is logged (ids only) and the explicit button still works later.
 */
export async function enrolAfterQuestionnaire(reason:'completed'|'urgent'):Promise<void>{
 if(!realReviewEnabled(process.env)||demoEnabled())return;
 try{
  if(!await enrolClinicalCase())log.warn('Questionnaire enrolment refused',{event:'questionnaire_enrolment',reason});
 }catch(error){
  log.error('Questionnaire enrolment failed',{event:'questionnaire_enrolment',reason,...errorFields(error)});
 }
}

/**
 * Lead, 18 Oct 23:15 ("where is Zoe"): a member without a clinical case yet (they finished the
 * questionnaire before auto-enrolment) still gets the Zoe chat, and their first message enrols them,
 * the same as the questionnaire's enrolment and the explicit review-request button. False when
 * enrolment is off or refused (then the composer says to send the review request).
 */
export async function enrolForZoeChat():Promise<boolean>{
 if(!realReviewEnabled(process.env)||demoEnabled())return false;
 try{
  const ok=await enrolClinicalCase();
  if(!ok)log.warn('zoe_chat_enrol_refused',{action:'zoe_chat_enrol'});
  return ok;
 }catch(error){
  log.error('zoe_chat_enrol_failed',{action:'zoe_chat_enrol',...errorFields(error)});
  return false;
 }
}
