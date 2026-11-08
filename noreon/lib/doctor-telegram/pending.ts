import 'server-only';
import {z} from 'zod';
import {staffCodePending} from '@/lib/telegram-auth/staff-signin-core';
import {sealRefreshToken,unsealRefreshToken} from './seal';
const envelope=z.object({doctorId:z.uuid(),sessionId:z.uuid(),bindingGeneration:z.number().int().positive(),ciphertext:z.string(),keyVersion:z.string(),nonce:z.string()});
const credentials=z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1),challenge:staffCodePending,until:z.number().int().positive()});
type Context={doctorId:string;sessionId:string;bindingGeneration:number};
/** Generation zero keeps pending credentials apart from every persisted connection's AAD. */
export function sealPendingConnection(value:Omit<z.infer<typeof credentials>,'until'>,context:Context,now=Date.now(),env:Record<string,string|undefined>=process.env){
 return JSON.stringify({...context,...sealRefreshToken(JSON.stringify({...value,until:now+300_000}),{...context,generation:0},env)});
}
export function readPendingConnection(value:string,doctorId:string,now=Date.now(),env:Record<string,string|undefined>=process.env){
 const held=envelope.parse(JSON.parse(value));
 if(held.doctorId!==doctorId)throw Error('Telegram connection unavailable');
 const context={doctorId:held.doctorId,sessionId:held.sessionId,bindingGeneration:held.bindingGeneration,generation:0};
 const data=credentials.parse(JSON.parse(unsealRefreshToken(held,context,env)));
 if(data.until<=now)throw Error('Telegram connection expired');
 return {...data,...context};
}
