import {z} from 'zod';

/** Admin Registrations: every member-side sign-up and the journey step reached. Step and urgent
 * flag only, never clinical content. Step mapping: docs/operations/registrations.md. */
export const STEPS=[1,2,3,4,5,6,7,8,9,10]as const;
export type Step=typeof STEPS[number];
export const stepLabel:Record<Step,string>={
 1:'Signed up',2:'Profile complete',3:'Consent given',4:'Questionnaire',5:'Enrolled',
 6:'Visit or tests booked',7:'Visit done',8:'Results in',9:'Plan published',10:'In programme',
};
export const STUCK_CHOICES=[3,7,14,30]as const;

const stamp=z.string().min(1).max(40);
export const registrationRowSchema=z.object({
 id:z.uuid(),name:z.string().max(200).nullable(),phoneMasked:z.string().max(40).nullable(),
 signedUpAt:stamp,channel:z.enum(['telegram','phone','email','other']),
 step:z.number().int().min(1).max(10),stepAt:stamp.nullable(),
 questionnaire:z.enum(['started','completed']).nullable(),urgent:z.boolean(),
 enrolled:z.boolean(),doctorAssigned:z.boolean().nullable(),lastActivityAt:stamp.nullable(),
});
export type RegistrationRow=z.infer<typeof registrationRowSchema>;
export const registrationsSchema=z.object({
 ok:z.literal(true),asOf:stamp,
 counts:z.record(z.string(),z.number().int().min(0)),
 total:z.number().int().min(0),matching:z.number().int().min(0),
 rows:z.array(registrationRowSchema),
});
export type Registrations=z.infer<typeof registrationsSchema>;

export type RegistrationFilters={step:Step|null;stuck:number|null};
const one=(v:unknown)=>Array.isArray(v)?v[0]:v;
/** Read filters from a query string; anything malformed is dropped rather than guessed. */
export function parseRegistrationFilters(query:Record<string,string|string[]|undefined>):RegistrationFilters{
 const n=(v:unknown)=>{const s=one(v);return typeof s==='string'&&/^\d{1,3}$/.test(s.trim())?Number(s.trim()):null;};
 const step=n(query.step);const stuck=n(query.stuck);
 return{step:step!==null&&(STEPS as readonly number[]).includes(step)?step as Step:null,stuck:stuck!==null&&stuck>=1&&stuck<=365?stuck:null};
}
export function registrationQuery(f:RegistrationFilters){
 const q=new URLSearchParams();
 if(f.step)q.set('step',String(f.step));
 if(f.stuck)q.set('stuck',String(f.stuck));
 return q.toString();
}
/** How many people reached each step or went further: the funnel. */
export function reachedCounts(counts:Record<string,number>){
 let running=0;const out={} as Record<Step,number>;
 for(const s of [...STEPS].reverse()){running+=counts[String(s)]??0;out[s]=running;}
 return out;
}
/** The step in words, with the detail admins need to act: questionnaire state, doctor assignment. */
export function stepDetail(r:RegistrationRow){
 if(r.step===4)return r.questionnaire==='completed'?'Questionnaire completed':'Questionnaire started';
 if(r.step===5)return r.doctorAssigned?'Enrolled, doctor assigned':'Enrolled, no doctor yet';
 return stepLabel[r.step as Step];
}
export const channelLabel:Record<RegistrationRow['channel'],string>={telegram:'Telegram',phone:'Phone (SMS)',email:'Email',other:'Other'};
export const daysSince=(at:string|null,now=Date.now())=>at?Math.max(0,Math.floor((now-Date.parse(at))/86400000)):null;
