import {redirect} from 'next/navigation';
import {PatientShell} from '@/components/patient/patient-shell';
import {MessagePreferences,type MessageTelegramView} from '@/components/messaging/message-settings';
import {readMessageSettings,MessageSettingsUnauthorized} from '@/lib/messaging/server';
import {readTelegramLink} from '@/lib/telegram-runtime/member';
export default async function MessageSettingsPage(){
 let settings;
 try{settings=await readMessageSettings();}catch(error){if(error instanceof MessageSettingsUnauthorized)redirect('/patient');throw error;}
 let telegram:MessageTelegramView=null;
 try{telegram=await readTelegramLink();}catch{telegram={state:'error',connected:false};}
 return <PatientShell locale={settings.locale}><MessagePreferences locale={settings.locale} telegram={telegram}/></PatientShell>;
}
