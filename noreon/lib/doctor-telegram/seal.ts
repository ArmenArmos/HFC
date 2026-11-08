import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';
export type SealContext={doctorId:string;sessionId:string;generation:number;bindingGeneration:number};
export type SealedRefreshToken={ciphertext:string;keyVersion:string;nonce:string};
const contextSchema=z.object({doctorId:z.uuid(),sessionId:z.uuid(),generation:z.number().int().nonnegative(),bindingGeneration:z.number().int().positive()});
const aad=(context:SealContext)=>Buffer.from(JSON.stringify(['noreon-doctor-telegram',1,...Object.values(contextSchema.parse(context))]));
/** Versioned secret format: v1:<base64 of exactly 32 bytes>. No key is persisted in SQL. */
function key(env:Record<string,string|undefined>){
 const value=env.NOREON_DOCTOR_TELEGRAM_KEY;
 if(!value||!/^v[1-9][0-9]*:[A-Za-z0-9+/]{43}=$/.test(value))throw Error('Doctor Telegram encryption unavailable.');
 const [version,encoded]=value.split(':'),bytes=Buffer.from(encoded,'base64');
 if(bytes.length!==32||bytes.toString('base64')!==encoded)throw Error('Doctor Telegram encryption unavailable.');
 return {version,bytes};
}
export function sealRefreshToken(token:string,context:SealContext,env:Record<string,string|undefined>=process.env):SealedRefreshToken{
 if(!token)throw Error('Doctor Telegram encryption unavailable.');
 const secret=key(env),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret.bytes,nonce);
 cipher.setAAD(aad(context));
 const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final(),cipher.getAuthTag()]);
 return {ciphertext:ciphertext.toString('base64url'),keyVersion:secret.version,nonce:nonce.toString('base64url')};
}
export function unsealRefreshToken(sealed:SealedRefreshToken,context:SealContext,env:Record<string,string|undefined>=process.env){
 try{
  const secret=key(env),nonce=Buffer.from(sealed.nonce,'base64url'),body=Buffer.from(sealed.ciphertext,'base64url');
  if(secret.version!==sealed.keyVersion||nonce.length!==12||body.length<=16||nonce.toString('base64url')!==sealed.nonce||body.toString('base64url')!==sealed.ciphertext)throw Error();
  const cipher=createDecipheriv('aes-256-gcm',secret.bytes,nonce);cipher.setAAD(aad(context));cipher.setAuthTag(body.subarray(-16));
  return Buffer.concat([cipher.update(body.subarray(0,-16)),cipher.final()]).toString('utf8');
 }catch{throw Error('Doctor Telegram credentials unavailable. Reconnect in the app.');}
}
