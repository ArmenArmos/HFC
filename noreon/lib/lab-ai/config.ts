import {realCallsBasis,zoeModelCallsEnabled} from '@/lib/zoe/gateway';

type Env=Record<string,string|undefined>;
/**
 * Lab PDF reading (dark). The database switch lab_ai_capabilities.enabled decides as well; the
 * screens also need document release (B5), since the doctor checks values beside the clinic PDF.
 */
export {labAiEnabled} from './feature-config';
/**
 * Which reader the worker uses. NOREON_LAB_AI_PROVIDER:
 *  - unset or anything else: off. Jobs wait; nothing is read.
 *  - "fake": the deterministic stand-in (tests, local and staging QA). It reads only a test marker,
 *    never real content, and its readings are labelled as the stand-in's.
 *  - "gateway": the Vercel AI Gateway, only when NOREON_ZOE_MODEL_CALLS_ENABLED is "true" and the
 *    deployment has a basis for real calls (realCallsBasis), the same
 *    gate as Zoe. Even then the database refuses the spend reservation unless model_calls_allowed.
 * Unlike Zoe the default is off: a stand-in reading of a real lab sheet could look like a real one.
 */
export function labProviderMode(env:Env=process.env):'fake'|'gateway'|'off'{
 const name=env.NOREON_LAB_AI_PROVIDER;
 if(name==='fake')return 'fake';
 if(name==='gateway')return zoeModelCallsEnabled(env)&&realCallsBasis(env)!==null?'gateway':'off';
 return 'off';
}
