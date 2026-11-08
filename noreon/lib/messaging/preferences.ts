import {z} from 'zod';
import type {PatientLocale} from '@/lib/patient/copy';
export const MESSAGE_CONSENT_VERSION='messaging-service-v1';
export const messageChannel=z.enum(['none','sms','whatsapp']);
export type MessageChannel=z.infer<typeof messageChannel>;
export const messagePreferenceInput=z.object({channel:messageChannel,expectedRevision:z.number().int().min(0).max(2147483646),consent:z.boolean(),context:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type MessageSettings={mode:'member';context:string|null;locale:PatientLocale;channel:MessageChannel;revision:number;maskedPhone:string|null;canOptIn:boolean;availableChannels:Array<'sms'|'whatsapp'>;needsReconfirmation:boolean;deliveryEnabled:false};
export type SaveMessageResult={ok:true;channel:MessageChannel;revision:number}|{ok:false;reason:'account-changed'|'unauthorized'|'invalid'|'consent-required'|'conflict'|'ineligible'|'rate-limited'|'unavailable'};
export function normalizedPhone(phone:string|undefined):string|null{
 if(!phone||!/^\+?[1-9][0-9]{7,14}$/.test(phone))return null;
 return phone.startsWith('+')?phone:`+${phone}`;
}
