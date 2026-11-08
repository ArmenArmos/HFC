export class ClinicalActionTimeout extends Error{
 constructor(){super('Taking longer than expected. The outcome is not confirmed. Reload to check what was saved or sent, then try again.');}
}
/** Bounds the wait, not the transaction. A late response must never become a success line. */
export async function withClinicalTimeout<T>(work:()=>Promise<T>,timeoutMs=60_000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new ClinicalActionTimeout()),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
