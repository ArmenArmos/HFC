import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';

type Env=Record<string,string|undefined>;
/** Screens only read the feature switch; provider configuration belongs to the worker. */
export const labAiEnabled=(env:Env=process.env)=>env.NOREON_LAB_AI_ENABLED==='true'&&doctorCompletionEnabled(env);
