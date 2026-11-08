import 'server-only';
import {createHash}from'node:crypto';
import {cookies,headers} from 'next/headers';
import {createServerClient} from '@supabase/ssr';
import {redirect,notFound} from 'next/navigation';
import type {Database} from '@/lib/db/types';
import {createClient} from '@/lib/supabase/server';
import {staffHostAllowed} from '@/lib/staff/hosts';
import {realReviewEnabled} from './real-review-config';
import {z} from 'zod';
import {staffNoticeSignInPath} from '@/lib/staff-zoe/notice-link';
import {staffAccessSession,staffAccessIdentity} from '@/lib/staff/real-staff-access';
export {realStaffSchema} from '@/lib/staff/real-staff-access';
import {clinicalReviewSchema} from './clinical-review-schema';
import {draftSchema} from '@/lib/service-workflow/publication';
import {pdfArtifactSchema} from '@/lib/reports/pdf-artifact-schema';
import {careVisitSchema}from'@/lib/staff/visit-evidence-schema';
import {planVersionSchema}from'@/lib/doctor-completion/version-schema';
export const queueSchema=z.array(z.object({id:z.uuid(),name:z.string().nullable(),revision:z.number(),doctorId:z.uuid().nullable(),nurseId:z.uuid().nullable().optional(),createdAt:z.string(),bookingCounts:z.object({requested:z.number().int().nonnegative(),providerProposed:z.number().int().nonnegative(),confirmed:z.number().int().nonnegative(),changePending:z.number().int().nonnegative()}).optional()}));
export const directorySchema=z.array(z.object({id:z.uuid(),name:z.string(),clinic:z.string(),clinicId:z.uuid().optional()}));
export const careNoteSchema=z.object({id:z.string(),actor_name:z.string(),actor_role:z.string(),kind:z.string(),note:z.string(),created_at:z.string()}).passthrough();
export const snapshotSchema=z.object({careNotes:z.array(careNoteSchema).optional(),id:z.uuid(),revision:z.number(),evidenceToken:z.string(),draft:draftSchema.nullable(),draftSavedAt:z.string().nullable(),draftStale:z.boolean(),review:clinicalReviewSchema.nullable().optional(),publications:z.array(z.object({planId:z.uuid(),publishedAt:z.string(),draft:draftSchema})).optional(),planVersions:z.array(planVersionSchema).optional(),evidence:z.object({
 visits:z.array(careVisitSchema).optional().default([]),
 profile:z.object({name:z.string().nullable(),birthDate:z.string().nullable(),biologicalSex:z.string().nullable()}),
 consent:z.unknown(),assessment:z.object({revision:z.number(),answers:z.record(z.string(),z.unknown()),completed_at:z.string().nullable(),urgent_rule:z.string().nullable()}).passthrough().nullable(),
 measurements:z.array(z.object({entry_source:z.string().nullable().optional(),id:z.string(),systolic:z.number(),diastolic:z.number(),pulse:z.number().nullable(),measured_at:z.string()})),
 reports:z.array(z.object({id:z.string(),revision:z.number(),state:z.string(),reviewed:z.unknown(),confirmedAt:z.string().nullable(),pdfArtifact:pdfArtifactSchema.optional()}))
})});
export type ClinicalSnapshot=z.infer<typeof snapshotSchema>;
export async function realStaffClient(){
 if(!realReviewEnabled(process.env))notFound();
 if(!staffHostAllowed((await headers()).get('host')??''))notFound();
 const jar=await cookies();
 return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
 cookieOptions:{name:'noreon-real-staff-auth',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},
 cookies:{getAll:()=>jar.getAll(),setAll:values=>{try{for(const {name,value,options} of values)jar.set(name,value,options);}catch{}}}
 });
}
export async function requireRealStaff(){
 const client=await realStaffClient();
 const session=await staffAccessSession(client,undefined,true);
 const noticePath=(await headers()).get('x-noreon-staff-notice-path');
 if(!session)redirect(staffNoticeSignInPath('/staff/real/login',noticePath));
 const {result,parsed}=await staffAccessIdentity(client);
 if(!parsed.success&&result.data===null){
  // A password session waiting for its Telegram code goes to the second step, not the login.
  const step=process.env.NOREON_STAFF_TELEGRAM_SIGNIN==='true'?z.object({required:z.boolean(),admitted:z.boolean(),enrolled:z.boolean(),eligible:z.boolean(),staffEligible:z.boolean().optional()}).safeParse((await client.rpc('staff_signin_state')).data):null;
  if(step?.success&&step.data.required&&!step.data.admitted&&step.data.enrolled&&(step.data.staffEligible??step.data.eligible))redirect(staffNoticeSignInPath('/staff/real/verify',noticePath));
 }
 // A qa tester (no clinic, so no clinical identity) only ever sees the test account list.
 if(!parsed.success&&result.data===null){const qa=await client.rpc('test_account_operator_identity');if(!qa.error&&z.object({role:z.literal('qa')}).safeParse(qa.data).success)redirect('/staff/real/test-accounts');}
 if(!parsed.success||!staffHostAllowed((await headers()).get('host')??'',parsed.data.role))redirect(staffNoticeSignInPath('/staff/real/login',noticePath));
 // Opaque UI draft fence, never authorization and never a raw session/JWT.
 const actorScope=createHash('sha256').update(JSON.stringify([parsed.data.id,parsed.data.role,parsed.data.clinicId,session.sessionId])).digest('hex');
 return {client,identity:parsed.data,actorScope};
}
export type RealStaff=Awaited<ReturnType<typeof requireRealStaff>>;
export async function readRealMemberStatus(){
 if(!realReviewEnabled(process.env))return {enabled:false as const,status:null};
 const r=await (await createClient()).rpc('patient_clinical_case_status');
 if(r.error)throw Error('Review status is unavailable. Please try again.');
 return {enabled:true as const,status:z.object({status:z.enum(['awaiting_assignment','review_pending','consultation_needed']),createdAt:z.string(),consultation:z.strictObject({scheduledAt:z.iso.datetime({offset:true}),channel:z.enum(['phone','clinic']),clinic:z.string().min(1).max(500).nullable()}).optional()}).nullable().parse(r.data)};
}
