import 'server-only';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {zoeScaffoldEnabled} from './policy';

/**
 * K4 consents for Zoe. UNAPPROVED DRAFT WORDING (S6 and Q17 with the privacy owner). This is
 * the version of the text this app shows. The database holds the current version
 * (zoe_settings.consent_wording_version, set by the activation migration) and records that,
 * never a client value; a grant is refused as stale when the two differ (Fable F3).
 */
/** draft-3 (8 Nov 2026, WP B) is draft-2 with the Armenian brand name «Զոյա» and the Russian «Зоя»: an editorial change,
 * so the operator step that moves the server to draft-3 after the app deploy (docs/operations/staging-ai-mode.sql 0c)
 * keeps draft-2 in consent_wording_also_valid and nobody is re-asked. */
export const ZOE_CONSENT_VERSION='zoe-consent-draft-3';
export type ZoeConsentKind='zoe_reads_messages'|'zoe_scheduled_questions';
/** Where a choice was made: the Me settings switches, the enrolment Agree step, or the one-time Home card. */
export type ZoeConsentSource='settings'|'enrolment'|'prompt'|'zoe_screen';
// zoeScreen (20261019211953): the Zoe chat card, also offered after a no given at enrolment.
const prompt=z.strictObject({ok:z.literal(true),wordingVersion:z.string().nullable(),directAnswers:z.boolean(),show:z.boolean(),zoeScreen:z.boolean().optional()});
const status=z.strictObject({ok:z.literal(true),available:z.boolean(),wordingVersion:z.string().nullable(),readsMessages:z.boolean(),scheduledQuestions:z.boolean()});
const setResult=z.union([z.strictObject({ok:z.literal(true),changed:z.boolean(),readsMessages:z.boolean(),scheduledQuestions:z.boolean()}),z.strictObject({ok:z.literal(false),code:z.enum(['invalid','unavailable','not_eligible'])}),z.strictObject({ok:z.literal(false),code:z.literal('stale'),wordingVersion:z.string()})]);
export type ZoeConsentView=z.infer<typeof status>&{canGrant:boolean;directAnswers:boolean};

/**
 * The member's own Zoe consents; null when the scaffold is off, or when collection is off and
 * nothing is granted. A granted consent always stays visible so it can be withdrawn.
 */
export async function readZoeConsents():Promise<ZoeConsentView|null>{
 if(!zoeScaffoldEnabled())return null;
 const client=await createClient();
 const [{data,error},p]=await Promise.all([client.rpc('zoe_consent_status'),readZoePrompt()]);
 if(error)throw Error('Zoe consent unavailable');
 const s=status.parse(data);
 // Granting is offered only when the server's current wording is the text this app shows.
 const canGrant=s.available&&s.wordingVersion===ZOE_CONSENT_VERSION;
 return canGrant||s.readsMessages||s.scheduledQuestions?{...s,canGrant,directAnswers:p.directAnswers}:null;
}

/**
 * due: the member has never decided about Zoe reading their messages (or agreed only to an
 * outdated wording) and a grant is possible with the wording this app shows; the enrolment
 * statement and the one-time card then appear. directAnswers: Zoe answers simple questions
 * herself, so the copy says so. Any failure answers not due, so nothing is asked or recorded.
 */
/** `due`: the Home card and the sign-up statement. `zoeScreen`: the card on the Zoe chat, which may also
 * overturn a no given at enrolment (lead, 19 Oct 23:10). */
export async function readZoePrompt():Promise<{due:boolean;directAnswers:boolean;zoeScreen:boolean}>{
 const none={due:false,directAnswers:false,zoeScreen:false};
 if(!zoeScaffoldEnabled())return none;
 try{
  const {data,error}=await (await createClient()).rpc('zoe_consent_prompt');
  if(error)return none;
  const p=prompt.parse(data);
  const current=p.wordingVersion===ZOE_CONSENT_VERSION;
 return {due:p.show&&current,directAnswers:p.directAnswers,zoeScreen:(p.zoeScreen??p.show)&&current};
 }catch{return none;}
}
export const zoeConsentPromptDue=async()=>(await readZoePrompt()).due;

export async function setZoeConsent(kind:unknown,granted:unknown,source:ZoeConsentSource='settings'):Promise<{ok:true;view:{readsMessages:boolean;scheduledQuestions:boolean}}|{ok:false;reason:'unavailable'|'stale'|'error'}>{
 if(!zoeScaffoldEnabled())return {ok:false,reason:'unavailable'};
 if((kind!=='zoe_reads_messages'&&kind!=='zoe_scheduled_questions')||typeof granted!=='boolean')return {ok:false,reason:'error'};
 // With the flag off the card and the Zoe runtime are both off, and consent is void (see the
 // migration), so there is nothing to withdraw from. With it on, withdrawal is always allowed.
 const client=await createClient();
 const {data,error}=await client.rpc('zoe_consent_set',{p_kind:kind,p_granted:granted,p_wording_version:ZOE_CONSENT_VERSION,p_source:source});
 if(error)return {ok:false,reason:'error'};
 const r=setResult.parse(data);
 if(!r.ok)return {ok:false,reason:r.code==='stale'?'stale':r.code==='invalid'?'error':'unavailable'};
 return {ok:true,view:{readsMessages:r.readsMessages,scheduledQuestions:r.scheduledQuestions}};
}
