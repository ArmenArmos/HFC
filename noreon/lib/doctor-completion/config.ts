import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
type Env=Record<string,string|undefined>;
/** B5 doctor completion (dark). The database switch in doctor_completion_capabilities
 * decides as well; this only keeps the screens hidden until both are on. */
export function doctorCompletionEnabled(env:Env=process.env):boolean{
 return env.NOREON_DOCTOR_COMPLETION_ENABLED==='true'&&realReviewEnabled(env);
}
