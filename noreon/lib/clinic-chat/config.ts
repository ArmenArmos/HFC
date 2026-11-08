import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
type Environment=Record<string,string|undefined>;
/** Server-only rollout decision. Every chat entry also keeps the existing clinic gates. */
export function clinicChatEnabled(env:Environment=process.env){
 return env.NOREON_CLINIC_CHAT==='true'&&clinicSchedulingEnabled(env);
}
