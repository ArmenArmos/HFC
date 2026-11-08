import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
export function realBookingEnabled(env:Record<string,string|undefined>):boolean{return env.NOREON_REAL_TEST_REQUESTS_ENABLED==='true'&&!!env.SUPABASE_SERVICE_ROLE_KEY&&realReviewEnabled(env);}
