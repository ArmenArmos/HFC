import 'server-only';
import{createClient}from'@supabase/supabase-js';import type{Database}from'@/lib/db/types';import type{ClinicStorageService}from'./upload-runtime';import{CLINIC_UPLOAD_MAX_BYTES}from'./upload-limits';
/** Private adapter is lazy. The database capability and original verified
 * reservation principal are additional mandatory gates in upload-runtime. */
export function clinicStorageService():ClinicStorageService|null{
 if(process.env.NOREON_CLINIC_UPLOAD_STORAGE_ENABLED!=='true'||!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null;
 return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})as unknown as ClinicStorageService;
}
export async function readClinicUploadBody(stream:ReadableStream<Uint8Array>|null,maxBytes=CLINIC_UPLOAD_MAX_BYTES){
 if(!stream)throw Error('invalid_file');const reader=stream.getReader(),chunks:Buffer[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('invalid_file');}chunks.push(Buffer.from(part.value));}if(!size)throw Error('invalid_file');return Buffer.concat(chunks,size);}finally{reader.releaseLock();}
}
