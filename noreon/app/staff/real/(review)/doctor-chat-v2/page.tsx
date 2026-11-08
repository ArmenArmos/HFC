import {notFound,redirect} from 'next/navigation';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';

/** The rebuilt chat now lives at the doctor's original address. */
export default function DoctorChatV2Page(){
 if(!doctorChatV2Enabled())notFound();
 redirect('/staff/real/doctor-workspace');
}
