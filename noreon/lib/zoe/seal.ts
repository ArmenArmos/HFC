import 'server-only';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

/**
 * Seals the redacted prompt and response of a Zoe run (ZOE_DESIGN §1.5: application-level
 * encryption with a key held in the deployment secret store, not in the database). AES-256-GCM.
 * Without NOREON_ZOE_RUN_KEY (32 bytes, base64) nothing is stored: the run records that the
 * input and output were not kept, which is the safe failure.
 */
type Env=Record<string,string|undefined>;
const keyFrom=(env:Env)=>{const raw=env.NOREON_ZOE_RUN_KEY;if(!raw)return null;const k=Buffer.from(raw,'base64');return k.length===32?k:null;};
const keyId=(k:Buffer)=>createHash('sha256').update(k).digest('hex').slice(0,12);

export function sealRunIo(plain:{memberBlock:string;response:string|null;judgeMalformed?:string},env:Env=process.env):string|null{
 const key=keyFrom(env);if(!key)return null;
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([cipher.update(JSON.stringify({v:1,...plain}),'utf8'),cipher.final()]);
 return ['v1',keyId(key),iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join(':');
}

export function openRunIo(sealed:string|null,env:Env=process.env):{memberBlock:string;response:string|null;judgeMalformed?:string}|'not_stored'|'key_unavailable'{
 if(!sealed)return 'not_stored';
 const key=keyFrom(env);const [v,id,iv,tag,body]=sealed.split(':');
 if(!key||v!=='v1'||id!==keyId(key)||!iv||!tag||!body)return 'key_unavailable';
 try{
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));
  const o=JSON.parse(Buffer.concat([d.update(Buffer.from(body,'base64')),d.final()]).toString('utf8'));
  return {memberBlock:String(o.memberBlock),response:o.response===null?null:String(o.response),...(typeof o.judgeMalformed==='string'?{judgeMalformed:o.judgeMalformed}:{})};
 }catch{return 'key_unavailable';}
}
