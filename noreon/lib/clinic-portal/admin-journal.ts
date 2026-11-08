import {clinicAdminCommandSchema,type ClinicAdminCommand} from './admin-schema';
export type RecoveryStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function clinicAdminJournalKey(actorId:string,clinicId:string){return `noreon:clinic-admin:v1:${actorId}:${clinicId}`;}
export function loadClinicAdminJournal(storage:RecoveryStorage,key:string,clinicId:string):ClinicAdminCommand|null{
 const raw=storage.getItem(key);if(raw===null)return null;
 const p=clinicAdminCommandSchema.safeParse(JSON.parse(raw));if(!p.success||p.data.clinicId!==clinicId)throw Error('Invalid recovery record');return p.data;
}
export function saveClinicAdminJournal(storage:RecoveryStorage,key:string,command:ClinicAdminCommand){
 const value=JSON.stringify(clinicAdminCommandSchema.parse(command));storage.setItem(key,value);
 if(storage.getItem(key)!==value)throw Error('Recovery record unavailable');
}
export function clearClinicAdminJournal(storage:RecoveryStorage,key:string){storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Recovery record retained');}
