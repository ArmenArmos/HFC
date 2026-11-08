import 'server-only';
import {dateInArmenia} from '@/lib/patient/validation';
import {requireRegistered} from '@/lib/patient/repository';
import {getReminderPreferences} from '@/lib/patient-care/reminder-repository';
import {readTelegramLink} from '@/lib/telegram-runtime/member';
import {readMemberTextSize} from '@/lib/patient/member-preferences';
import {readZoeConsents,type ZoeConsentView} from '@/lib/zoe/member';
import {bookingToken} from './booking';
import type {MessageTelegramView} from '@/components/messaging/message-settings';
/** Same current settings as the account pages. The token excludes the incidental read time. */
export async function readAccountSettings(){
 const {profile,assessment}=await requireRegistered();
 const reminders=await getReminderPreferences();
 let telegram:MessageTelegramView;
 try{telegram=await readTelegramLink();}catch{telegram={state:'error',connected:false};}
 const textSize=await readMemberTextSize();
 let zoe:ZoeConsentView|null=null;
 try{zoe=await readZoeConsents();}catch{zoe=null;}
 const data={profile,assessment:{id:assessment.id,revision:assessment.revision},reminders,telegram,textSize,zoe};
 return {...data,today:dateInArmenia(),token:bookingToken(data)};
}
export type AccountSettings=Awaited<ReturnType<typeof readAccountSettings>>;
