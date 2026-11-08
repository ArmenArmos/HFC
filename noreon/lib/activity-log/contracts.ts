import {z} from 'zod';

/** The admin Activity log: one read-only view over the audit sources. Never health content. */
export const activityCategories=['sign_in','record_access','care_change','admin_change','export']as const;
export type ActivityCategory=typeof activityCategories[number];
export const categoryLabel:Record<ActivityCategory,string>={
 sign_in:'Sign-in and sign-out',record_access:'Opened member records',care_change:'Care changes',admin_change:'Admin and settings changes',export:'Log exports',
};

const id=z.string().max(80).nullable();
export const activityRowSchema=z.object({
 key:z.string().min(1).max(120),at:z.string(),category:z.enum(activityCategories),source:z.string().max(60),action:z.string().max(120),
 actorId:id,actorName:z.string().max(200).nullable(),actorRole:z.string().max(40).nullable(),
 memberId:id,memberName:z.string().max(200).nullable(),ref:z.string().max(200).nullable(),
});
export type ActivityRow=z.infer<typeof activityRowSchema>;
export const activityPageSchema=z.object({ok:z.literal(true),rows:z.array(activityRowSchema),next:z.string().max(200).nullable()});
export const activityPeopleSchema=z.object({ok:z.literal(true),people:z.array(z.object({id:z.string(),name:z.string(),role:z.string()}))});

/** Unified audit contract; the original five-category parser remains compatible with string fields. */
export const auditCategories=['sign_in','record_access','alert_change','outbound_message','permission_change','care_change','admin_change','export']as const;
export type AuditCategory=typeof auditCategories[number];
export const clinicAuditCategories=['sign_in','record_access','alert_change','outbound_message','permission_change','care_change','export']as const;
const profileName=z.strictObject({before:z.string().max(200).nullable(),after:z.string().max(200).nullable()});
const profileBirthYears=z.strictObject({beforeYear:z.number().int().nullable(),afterYear:z.number().int().nullable()});
const profileBirthFull=profileBirthYears.extend({before:z.iso.date().nullable(),after:z.iso.date().nullable()});
const clinicProfileChangeSchema=z.strictObject({name:profileName.optional(),birthDate:profileBirthYears.optional()});
export const profileChangeSchema=clinicProfileChangeSchema.extend({birthDate:z.union([profileBirthYears,profileBirthFull]).optional()});
export type ProfileChange=z.infer<typeof profileChangeSchema>;
export const auditRowSchema=activityRowSchema.extend({category:z.enum(auditCategories),profileChange:profileChangeSchema.optional()}).strict();
export type AuditRow=z.infer<typeof auditRowSchema>;
export const auditPageSchema=z.strictObject({ok:z.literal(true),rows:z.array(auditRowSchema),next:z.string().max(200).nullable()});
export const auditPeopleSchema=activityPeopleSchema.strict();
const clinicUnavailable=z.strictObject({status:z.enum(['disabled','refused'])});
export const clinicAuditPageSchema=z.union([
 auditPageSchema.extend({rows:z.array(auditRowSchema.extend({category:z.enum(clinicAuditCategories),profileChange:clinicProfileChangeSchema.optional()}))}),clinicUnavailable,
]);
export const clinicAuditPeopleSchema=z.union([auditPeopleSchema,clinicUnavailable]);
/** Authenticated RPC boundary until database types can be regenerated from a local replay. */
export type AuditRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};

const uuid=z.uuid();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v);
export type ActivityFilters={actor:string|null;member:string|null;category:AuditCategory|null;from:string|null;to:string|null;cursor:string|null;
 /** A typed member reference that is not a member id: kept so the page can say so (review F4). */
 memberInvalid?:string|null};
const one=(v:unknown)=>Array.isArray(v)?v[0]:v;
/** Read filters from a query string; anything malformed is dropped rather than guessed. */
export function parseFilters(query:Record<string,string|string[]|undefined>):ActivityFilters{
 const pick=<T,>(schema:z.ZodType<T>,v:unknown)=>{const r=schema.safeParse(typeof one(v)==='string'?(one(v) as string).trim():undefined);return r.success?r.data:null;};
 const typed=typeof one(query.member)==='string'?(one(query.member) as string).trim().slice(0,200):'';
 const member=pick(uuid,query.member);
 return{actor:pick(uuid,query.actor),member,category:pick(z.enum(auditCategories),query.category),
  from:pick(day,query.from),to:pick(day,query.to),cursor:pick(z.string().regex(/^[0-9TZ:.+-]{10,40}\|[a-z_]{1,40}:[A-Za-z0-9-]{1,80}$/),query.cursor),
  memberInvalid:typed&&!member?typed:null};
}
export const DEFAULT_DAYS=7;
/** Rows one CSV export holds (admin_audit_log_export); more matching rows refuse the export. */
export const EXPORT_LIMIT=5000;
const yerevanDay=(ms:number)=>new Date(ms+4*3600000).toISOString().slice(0,10);
/** With no start date the log covers the last 7 days up to the end date (or today), so its cost does
 * not grow with all history (review F3). The start is written into the form, so it is never hidden. */
export function withDefaultWindow(f:ActivityFilters,now=Date.now()):ActivityFilters{
 if(f.from)return f;
 const end=f.to?Date.parse(`${f.to}T00:00:00Z`):Date.parse(`${yerevanDay(now)}T00:00:00Z`);
 return{...f,from:yerevanDay(end-(DEFAULT_DAYS-1)*86400000-4*3600000)};
}
/** Days are Yerevan calendar days; the database receives exact instants. */
export function rpcArgs(f:ActivityFilters){
 return{p_actor:f.actor??undefined,p_member:f.member??undefined,p_category:f.category??undefined,
  p_from:f.from?`${f.from}T00:00:00+04:00`:undefined,p_to:f.to?new Date(Date.parse(`${f.to}T00:00:00+04:00`)+86400000).toISOString():undefined};
}
export function filterQuery(f:Partial<ActivityFilters>){
 const q=new URLSearchParams();
 for(const k of ['actor','member','category','from','to','cursor']as const){const v=f[k];if(v)q.set(k,v);}
 return q.toString();
}

/** CSV with every cell quoted, and spreadsheet formulas neutralised. */
export function toCsv(rows:AuditRow[]){
 const head=['time_utc','category','source','action','actor_id','actor_name','actor_role','member_id','member_name','reference','profile_change'];
 const cell=(v:string|null)=>{let s=v??'';if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;return `"${s.replace(/"/g,'""')}"`;};
 return [head.join(','),...rows.map(r=>[r.at,r.category,r.source,r.action,r.actorId,r.actorName,r.actorRole,r.memberId,r.memberName,r.ref,r.profileChange?JSON.stringify(r.profileChange):null].map(cell).join(','))].join('\r\n')+'\r\n';
}
