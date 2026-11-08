import type{ClinicSnapshot}from'./schema';
/** Persisted rows need no File objects. Another actor/session/clinic/batch needs
 * a new controller. Pending selections and their bytes stay outside this DTO. */
export function hydrateClinicBatch(previous:ClinicSnapshot|null,incoming:ClinicSnapshot,options:{append?:boolean}={}):ClinicSnapshot{
 if(previous&&(previous.batch.id!==incoming.batch.id||previous.batch.clinicId!==incoming.batch.clinicId))throw Error('clinic_scope_changed');
 if(previous&&incoming.batch.revision<previous.batch.revision)return previous;
 if(!previous||!options.append)return incoming;
 if(incoming.batch.revision!==previous.batch.revision)throw Error('clinic_snapshot_changed');
 const rows=new Map(previous.files.map(file=>[file.id,file]));
 for(const file of incoming.files){const old=rows.get(file.id);if(!old||file.revision>=old.revision)rows.set(file.id,file);}
 return{...incoming,files:[...rows.values()]};
}
