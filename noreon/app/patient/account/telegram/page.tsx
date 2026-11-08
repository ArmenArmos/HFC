import {notFound} from 'next/navigation';
import {PatientShell} from '@/components/patient/patient-shell';
import {TelegramLink} from '@/components/patient/telegram-link';
import {requireRegisteredForRender} from '@/lib/patient/render-data';
import {readTelegramLink,TELEGRAM_CONSENT_VERSION} from '@/lib/telegram-runtime/member';
import {ZoeConsents} from '@/components/patient/zoe-consents';
import {readZoeConsents} from '@/lib/zoe/member';
export default async function TelegramSettingsPage(){
 const {profile}=await requireRegisteredForRender();
 let view;
 try{view=await readTelegramLink();}catch{view={state:'error' as const};}
 if(view===null)notFound();
 // Zoe consents (K4) are dark: shown only with the scaffold flag and database collection on.
 let zoe=null;
 try{zoe=await readZoeConsents();}catch{zoe=null;}
 return <PatientShell locale={profile.locale}><TelegramLink locale={profile.locale} state={view.state} connected={'connected' in view&&view.connected} consentVersion={TELEGRAM_CONSENT_VERSION}/>{zoe&&<div className="mt-6"><ZoeConsents locale={profile.locale} initial={{readsMessages:zoe.readsMessages,scheduledQuestions:zoe.scheduledQuestions}} telegramConnected={view.state==='linked'} canGrant={zoe.canGrant}/></div>}</PatientShell>;
}
