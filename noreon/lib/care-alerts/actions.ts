'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {closeResolutions,careAlertCommandSchema,careAlertsEnabled} from './contracts';
import {log} from '@/lib/observability/logger';
import {resolutionRecordSchema} from './resolution-suggestion';

/** Lazy read on Resolve, using the same visibility boundary as the alert. */
export const readCareAlertResolutionRecord=loggedAction('readCareAlertResolutionRecord',async function readCareAlertResolutionRecord(alertId:string){
 if(!careAlertsEnabled())return null;
 if(!z.uuid().safeParse(alertId).success)return null;
 const {client,identity}=await requireRealStaff();
 if(!['nurse','doctor','admin'].includes(identity.role))return null;
 try{
  // Temporary boundary until the integrator stamps the migration and runs db:types.
  const {data,error}=await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}).rpc('care_alert_resolution_record',{p_alert:alertId});
  const parsed=z.object({ok:z.literal(true),record:resolutionRecordSchema}).safeParse(data);
  return !error&&parsed.success&&parsed.data.record.alert.id===alertId?parsed.data.record:null;
 }catch{return null;}
});

const base=z.object({alertId:z.uuid(),seq:z.coerce.number().int().min(0)});
// The doctor's inbox (/staff/real/today) posts the same forms with from=today and gets its notice back there.
type Page='/staff/real/alerts'|'/staff/real/today';
const pageOf=(form:FormData):Page=>form.get('from')==='today'?'/staff/real/today':'/staff/real/alerts';
const back=(notice:string,page:Page='/staff/real/alerts'):never=>redirect(`${page}?notice=${notice}` as Route);

async function run(name:'care_alert_acknowledge'|'care_alert_resolve',args:Record<string,unknown>,page:Page){
 if(!careAlertsEnabled())back('unavailable',page);
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin'&&identity.role!=='doctor'&&identity.role!=='nurse')back('access',page);
 let notice='unavailable';
 try{
  const {data,error}=await client.rpc(name,args as never);
  if(!error){const r=careAlertCommandSchema.parse(data);notice=r.ok?(name==='care_alert_resolve'?'resolved':'acknowledged'):r.code==='changed'?'changed':r.code==='invalid'?'invalid':'unavailable';}
 }catch{notice='unavailable';}
 revalidatePath('/staff/real/alerts');revalidatePath('/staff/real/today');
 back(notice,page);
}

export const acknowledgeCareAlert=loggedAction("acknowledgeCareAlert",async function acknowledgeCareAlert(form:FormData){
 const p=base.safeParse({alertId:form.get('alertId'),seq:form.get('seq')});
 if(!p.success)back('invalid',pageOf(form));
 await run('care_alert_acknowledge',{p_alert:p.data!.alertId,p_expected_seq:p.data!.seq},pageOf(form));
});

export const resolveCareAlert=loggedAction("resolveCareAlert",async function resolveCareAlert(form:FormData){
 const p=base.extend({resolution:z.enum(closeResolutions),note:z.string().trim().min(1).max(1000)}).safeParse({alertId:form.get('alertId'),seq:form.get('seq'),resolution:form.get('resolution'),note:form.get('note')??''});
 if(!p.success)back('invalid',pageOf(form));
 await run('care_alert_resolve',{p_alert:p.data!.alertId,p_expected_seq:p.data!.seq,p_resolution:p.data!.resolution,p_note:p.data!.note},pageOf(form));
});

const command=z.discriminatedUnion('kind',[
 base.extend({kind:z.literal('acknowledge')}),
 base.extend({kind:z.literal('next_action'),text:z.string().trim().min(1).max(300),dueAt:z.iso.datetime({offset:true}).nullable().optional()}),
 base.extend({kind:z.literal('resolve'),resolution:z.enum(closeResolutions),note:z.string().trim().min(1).max(1000)}),
]);
/** Inline controls keep notes in the form and return only fixed failure codes. SQL enforces assignment and sequence. */
export const changeCareAlert=loggedAction('changeCareAlert',async function changeCareAlert(input:unknown){
 if(!careAlertsEnabled())return {ok:false as const,code:'unavailable'};
 const p=command.safeParse(input);
 if(!p.success)return {ok:false as const,code:'invalid'};
 const {client,identity}=await requireRealStaff();
 if(!['nurse','doctor','admin'].includes(identity.role))return {ok:false as const,code:'access'};
 const c=p.data,args:Record<string,unknown>={p_alert:c.alertId,p_expected_seq:c.seq};
 if(c.kind==='next_action'){args.p_text=c.text;args.p_due_at=c.dueAt??null;}
 if(c.kind==='resolve'){args.p_resolution=c.resolution;args.p_note=c.note;}
 let result;
 try{
  // The new RPC's generated signature is added by db:types after the lead replays the migration.
  const response=await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}).rpc(`care_alert_${c.kind}`,args);
  if(response.error)throw Error('Alert command unavailable');
  result=careAlertCommandSchema.parse(response.data);
 }catch{
  log.warn('Care alert command could not be confirmed',{alert_id:c.alertId});
  return {ok:false as const,code:'unavailable'};
 }
 if(result.ok){
  for(const path of ['/staff/real/alerts','/staff/real/today','/staff/real/nurse-chat','/staff/real/tasks','/staff/real/care-queue',`/staff/real/members/${result.alert.memberId}`])revalidatePath(path);
 }
 return result;
});
