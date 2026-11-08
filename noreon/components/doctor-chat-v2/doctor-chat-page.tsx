import {staffVoiceAvailable} from '@/lib/staff-zoe/voice';
import 'server-only';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {doctorTelegramMenuState} from '@/lib/doctor-telegram/actions';
import {resultsReportEnabled} from '@/lib/gp-report/config';
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
 return <DoctorChatV2 key={identity.id} voiceAvailable={await staffVoiceAvailable('DOCTOR')} locale={locale} doctorId={identity.id} doctorName={identity.name} resultsReport={resultsReportEnabled()} {...(telegram?{telegram}:{})}/>;
}
