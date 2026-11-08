import {realReviewEnabled} from './real-review-config';
type Env=Record<string,string|undefined>;
/** Plans with several medicines (dark). The database switch in multi_medicine_capabilities decides as well;
 * this only keeps the screens hidden until both are on. */
export function multiMedicineEnabled(env:Env=process.env):boolean{
 return env.NOREON_MULTI_MEDICINE_ENABLED==='true'&&realReviewEnabled(env);
}
