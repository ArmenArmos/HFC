import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
/** Dark unless both switches are explicitly on. Server passes this boolean to the card. */
export const bpPhotoEnabled=(env:Record<string,string|undefined>=process.env)=>
 env.NOREON_ZOE_BP_PHOTO==='true'&&zoeAppV3Enabled(env);
export const BP_PHOTO_MAX_BYTES=4*1024*1024;
