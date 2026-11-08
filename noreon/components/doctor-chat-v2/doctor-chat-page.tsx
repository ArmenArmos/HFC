import {staffLiveAvailable,staffVoiceAvailable} from '@/lib/staff-zoe/voice';
/** WP V: voice for this role, and Gemini Live only when voice itself is on. */
const staffVoiceProps=async(role:'NURSE'|'DOCTOR')=>{const voiceAvailable=await staffVoiceAvailable(role);return voiceAvailable&&await staffLiveAvailable(role)?{voiceAvailable,voiceLive:true}:{voiceAvailable};};
import 'server-only';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {doctorTelegramMenuState} from '@/lib/doctor-telegram/actions';
import {resultsReportEnabled} from '@/lib/gp-report/config';
import {riskTiersEnabled} from '@/lib/clinical-review/config';
import {DoctorChatV2} from './doctor-chat';
import '@/components/chat-v2/chat.css';
import './doctor-chat.css';

/** The rebuilt chat for a doctor while staff Zoe is on; null otherwise, so the caller decides what stands in. */
export async function doctorChatPage(){
 const {client,identity}=await requireRealStaffForRender();
 if(identity.role!=='doctor')return null;
 const on=await client.rpc('staff_zoe_status').then(result=>!result.error&&result.data===true,()=>false);
 if(!on)return null;
 const locale=await staffLocale(identity.role);
 const telegram=await doctorTelegramMenuState();
 return <DoctorChatV2 key={identity.id} {...await staffVoiceProps('DOCTOR')} locale={locale} doctorId={identity.id} doctorName={identity.name} resultsReport={resultsReportEnabled()} {...(riskTiersEnabled()?{worklist:true}:{})} {...(telegram?{telegram}:{})}/>;
}
