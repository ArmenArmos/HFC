import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
const schema=z.object({version:z.literal(1),purpose:z.literal('staff-password-recovery'),operationId:z.uuid(),generation:z.number().int().positive().safe(),userId:z.uuid(),sessionId:z.uuid(),tokenDigest:z.string().regex(/^[a-f0-9]{64}$/),stage:z.enum(['verified','password_saved']),issuedAt:z.number().int().nonnegative().safe(),expiresAt:z.number().int().positive().safe()}).strict();
export type RecoveryProof=z.infer<typeof schema>;
function key(secret:string){if(Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>256)throw Error('Recovery unavailable');return secret;}
export function issueRecoveryProof(value:Omit<RecoveryProof,'version'|'purpose'|'issuedAt'|'expiresAt'>&{operationExpiresAt:number},secret:string,now=Date.now()){
 const {operationExpiresAt,...input}=value;const payload=schema.parse({...input,version:1,purpose:'staff-password-recovery',issuedAt:now,expiresAt:Math.min(now+600000,operationExpiresAt)});
 if(payload.expiresAt<=now)throw Error('Recovery expired');const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+createHmac('sha256',key(secret)).update(body).digest('base64url');
}
export function verifyRecoveryProof(value:string,secret:string,now=Date.now()):RecoveryProof|null{
 try{
  if(value.length>2048||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value))return null;
  const [body,sig]=value.split('.'),actual=Buffer.from(sig,'base64url'),expected=createHmac('sha256',key(secret)).update(body).digest();
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
  const parsed=schema.safeParse(JSON.parse(Buffer.from(body,'base64url').toString()));if(!parsed.success)return null;const p=parsed.data;
  return p.expiresAt>now&&p.issuedAt<=now+5000&&p.expiresAt>p.issuedAt&&p.expiresAt-p.issuedAt<=600000?p:null;
 }catch{return null;}
}
