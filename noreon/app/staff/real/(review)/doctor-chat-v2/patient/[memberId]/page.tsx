import {z} from 'zod';
import {notFound} from 'next/navigation';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import {patientChatPage} from '@/components/doctor-chat-v2/patient-chat-page';
export default async function PatientChatPage({params,searchParams}:{params:Promise<{memberId:string}>;searchParams:Promise<{alert?:string|string[];lab?:string|string[]}>}){
 if(!doctorChatV2Enabled())notFound();
 const query=await searchParams;
 const alert=z.uuid().safeParse(query.alert),lab=z.uuid().safeParse(query.lab);
 return patientChatPage((await params).memberId,alert.success?alert.data.toLowerCase():undefined,lab.success?lab.data.toLowerCase():undefined);
}
