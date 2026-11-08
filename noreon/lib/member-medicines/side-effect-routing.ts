import type {SideEffect} from '@/lib/zoe-chat-actions/copy';

/** The doctor still gets every report. On, a listed side effect also gives the assigned nurse a call task. */
export const sideEffectNurseFirstEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_SIDE_EFFECT_NURSE_FIRST==='true';

/**
 * Roo's item 13, used on staging on Khikar's word, needing Armen and Yesayi's sign-off before real members. Statin muscle
 * pain goes to the doctor, as does everything not listed, including flushing and "something else". The list says "mild";
 * the card does not ask, so the nurse's task does, and the doctor has every report anyway. Keep in step with
 * `_side_effect_nurse_task`, which refuses anything else.
 */
const NURSE_FIRST:readonly SideEffect[]=['ankle_swelling','dizziness','nausea','dry_cough','headache','frequent_urination'];
export const sideEffectRoute=(what:SideEffect):'nurse'|'doctor'=>NURSE_FIRST.includes(what)?'nurse':'doctor';
