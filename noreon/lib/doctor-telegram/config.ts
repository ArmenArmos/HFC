import 'server-only';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
export const doctorTelegramEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_DOCTOR_TELEGRAM==='true'&&doctorChatV2Enabled(env);
