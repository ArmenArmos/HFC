import Link from 'next/link';
import type {Route} from 'next';
import {unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {stamp} from '@/components/patient-care/common';
import {buttonClass,fieldClass} from '@/components/staff/shell';
export const dynamic='force-dynamic';
const id=z.uuid(),day=z.iso.date();
const values=z.object({name:z.string().nullable().optional(),birthDate:z.string().nullable().optional(),editedAt:z.string().optional()});
const pageSchema=z.object({version:z.literal('admin-upload-overrides-v1'),
 overrides:z.array(z.object({id,at:z.string(),clinicId:id,clinicName:z.string(),by:z.string().nullable(),memberId:id,fileId:id,fileName:z.string(),sheet:values,member:values,mismatch:z.enum(['name','birth_date','both']),reason:z.string().nullable()})),
 clinics:z.array(z.object({id,name:z.string()}))});
const mismatchLabel={name:'Name',birth_date:'Date of birth',both:'Name and date of birth'} as const;
const one=(v:string|string[]|undefined)=>typeof v==='string'?v:undefined;

/** Admin only: every lab PDF a clinic attached although the sheet did not match the member ("Continue anyway").
 * Each view is recorded in the activity log. */
export default async function UploadChecksPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {client}=await requireRealAdmin();
 const q=await searchParams;
 const clinic=id.safeParse(one(q.clinic)).success?one(q.clinic)!:null,from=day.safeParse(one(q.from)).success?one(q.from)!:null,to=day.safeParse(one(q.to)).success?one(q.to)!:null;
 const mismatch=['name','birth_date','both'].includes(one(q.mismatch)??'')?one(q.mismatch)!:null;
 let data:z.infer<typeof pageSchema>|null=null;
 try{const r=await client.rpc('admin_lab_upload_overrides',{p_clinic:clinic??undefined,p_from:from??undefined,p_to:to??undefined,p_mismatch:mismatch??undefined});if(r.error)throw Error('unavailable');data=pageSchema.parse(r.data);}catch(error){unstable_rethrow(error);}
 return <div className="mx-auto max-w-5xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Upload checks</h1>
   <p className="text-body2 text-muted-foreground">Lab PDFs a clinic attached to a member although the name or date of birth on the sheet did not match, after confirming “Continue anyway”. Check the file and the member. Opening this page is recorded.</p></header>
  <form method="get" className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-5 sm:items-end">
   <label className="space-y-1 text-body2"><span>Clinic</span><select name="clinic" defaultValue={clinic??''} className={fieldClass}><option value="">All clinics</option>{data?.clinics.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="space-y-1 text-body2"><span>From</span><input type="date" name="from" defaultValue={from??''} className={fieldClass}/></label>
   <label className="space-y-1 text-body2"><span>To</span><input type="date" name="to" defaultValue={to??''} className={fieldClass}/></label>
   <label className="space-y-1 text-body2"><span>What differed</span><select name="mismatch" defaultValue={mismatch??''} className={fieldClass}><option value="">Anything</option><option value="name">Name</option><option value="birth_date">Date of birth</option><option value="both">Both</option></select></label>
   <button className={buttonClass}>Show</button>
  </form>
  {!data?<p role="alert" className="rounded-lg border bg-background p-4 text-body2">Upload checks could not load. Try again.</p>
  :!data.overrides.length?<p role="status" className="rounded-lg border bg-background p-4 text-body2">No overridden uploads{clinic||from||to||mismatch?' for these filters':''}.</p>
  :<ul className="divide-y rounded-lg border bg-background">{data.overrides.map(o=><li key={o.id} className="space-y-2 p-4 text-body2">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{o.clinicName} · {stamp(o.at,'en')}</p><span className="rounded-full border px-3 py-1 text-caption">{mismatchLabel[o.mismatch]} differed</span></div>
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr_1fr]">
     <dt className="text-muted-foreground"></dt><dd className="text-caption text-muted-foreground">On the sheet</dd><dd className="text-caption text-muted-foreground">{o.member.editedAt?'Member, before the clinic edited it':'Member'}</dd>
     <dt className="text-muted-foreground">Name</dt><dd className="break-words">{o.sheet.name??'Not on the sheet'}</dd><dd className="break-words">{o.member.name||'Not given'}</dd>
     <dt className="text-muted-foreground">Date of birth</dt><dd>{o.sheet.birthDate??'Not on the sheet'}</dd><dd>{o.member.birthDate??'Not given'}</dd>
    </dl>
    <p className="text-caption text-muted-foreground">By {o.by??'a clinic admin'}{o.reason?` · Reason: ${o.reason}`:' · No reason given'}</p>
    <div className="flex flex-wrap gap-3"><Link className="underline underline-offset-4" href={`/staff/real/members/${o.memberId}` as Route}>Open member</Link>
     <a className="underline underline-offset-4" href={`/staff/real/clinic-originals/${o.fileId}`} target="_blank" rel="noopener noreferrer">Open PDF ({o.fileName})</a></div>
   </li>)}</ul>}
 </div>;
}
