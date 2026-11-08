"use client";
import {integrationCapabilities} from "@/lib/service-workflow/follow-up-capabilities";
import {useState} from 'react';
import {monitoringCommand} from '@/lib/staff/monitoring-actions';
import {monitoringProgress,readingsForRequirement,type MonitoringSnapshot,type MonitoringRequirement} from '@/lib/service-workflow/follow-up';
import type {ServiceWorkflow} from '@/lib/service-workflow/types';
import {useDemoReports} from './reports-provider';
import {buttonClass,inputClass,quietClass} from './shared';
const date=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));
export function MonitoringPanel({role,caseId,caseRevision,workflow,initial,expiresAt}:{role:'admin'|'doctor'|'nurse';caseId:string;caseRevision:number;workflow:ServiceWorkflow;initial:MonitoringSnapshot;expiresAt:string}) {
 const memory=useDemoReports();
 const snapshot=memory.snapshot;
 const monitoring=snapshot?.monitoring??initial;
 const current=snapshot?.state.workflow??workflow;
 const revision=snapshot?.state.workspaceRevision??caseRevision;
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[count,setCount]=useState(''),[instructions,setInstructions]=useState('');
 const unavailable=busy||!memory.loaded||!!memory.persistenceError;
 const doctor=current.doctors.find(d=>d.id===current.assignedDoctorId&&d.active);
 async function run(command:Record<string,unknown>) {
  setBusy(true);setMessage('');
  try {
   const result=await monitoringCommand({...command,caseId,caseRevision:revision});
   if(!result.ok){setMessage(result.error??'Could not save the change.');return false;}
   try {if(!await memory.refresh()){setMessage('Saved. Refresh the case to load its current state.');return false;}}
   catch {setMessage('Saved. The updated case could not load; refresh before continuing.');return false;}
   setMessage('Saved.');return true;
  }catch{setMessage('The result could not be confirmed. Refresh the case before trying again.');return false;}
  finally{setBusy(false);}
 }
 return <section id="monitoring" className="space-y-5 rounded-xl border bg-card p-5">
  <h2 className="text-h2">Monitoring and follow-up</h2>
  <p className="text-body2">Clinical owner: {doctor?.name??'Unassigned or inactive coverage'}</p>
  <details><summary className="min-h-11 cursor-pointer text-caption text-muted-foreground">How follow-up works</summary><p className="text-body2">The doctor sets each measurement window and count. Progress records evidence received, not a clinical interpretation. Contact work stays open until evidence arrives or the doctor cancels or supersedes the requirement.</p><p className="text-caption text-muted-foreground">In-app notifications {integrationCapabilities.inApp?"available":"unavailable"}. External delivery and device sync are not configured. Recording contact does not send a message.</p></details>
  {monitoring.requirements.length===0&&<p className="text-body2">No monitoring requirement has been added.</p>}
  {monitoring.requirements.map(requirement=><RequirementCard key={requirement.id} requirement={requirement} monitoring={monitoring} role={role} disabled={unavailable} run={run}/>)}
  {role==='doctor'&&<details><summary className="min-h-11 cursor-pointer text-body2 font-medium">Add a monitoring requirement</summary>
   {!current.publication?<p className="text-body2">Publish the initial care plan before adding monitoring.</p>:<form className="mt-4 space-y-4" onSubmit={async e=>{e.preventDefault();const startsAt=new Date(`${start}+04:00`),endsAt=new Date(`${end}+04:00`);if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())){setMessage('Enter both window dates.');return;}if(await run({op:'create',requestId,evidenceRevision:current.evidenceRevision??0,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),count:Number(count),instructions})){setRequestId(crypto.randomUUID());setStart('');setEnd('');setCount('');setInstructions('');}}}>
    <p className="text-caption text-muted-foreground">Based on approved plan {current.publication.version}. Enter dates in Armenia time (UTC+04:00). This demo case expires {date(expiresAt)}. No schedule or count is selected automatically.</p>
    <fieldset disabled={unavailable} className="grid gap-4 sm:grid-cols-2">
     <label className="text-body2">Window starts<input className={inputClass} type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
     <label className="text-body2">Window ends<input className={inputClass} type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
     <label className="text-body2">Number of readings<input className={inputClass} type="number" min={1} max={1000} required value={count} onChange={e=>setCount(e.target.value)}/></label>
     <label className="text-body2 sm:col-span-2">Instructions for the member<textarea className={inputClass} maxLength={1500} required value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
     <button className={buttonClass}>Approve monitoring requirement</button>
    </fieldset>
   </form>}
  </details>}
  {message&&<p role="status" className="text-body2">{message}</p>}
  {memory.persistenceError&&<div className="space-y-2"><p role="alert" className="text-body2">{memory.persistenceError}</p><button className={quietClass} disabled={busy} onClick={async()=>{try{if(await memory.refresh())setMessage('Current monitoring loaded. Your form entries are retained.');}catch{setMessage('The current case could not load. Try refreshing again.');}}}>Refresh monitoring</button></div>}
 </section>;
}
function RequirementCard({requirement:r,monitoring,role,disabled,run}:{requirement:MonitoringRequirement;monitoring:MonitoringSnapshot;role:'admin'|'doctor'|'nurse';disabled:boolean;run:(command:Record<string,unknown>)=>Promise<boolean>}) {
 const {snapshot}=useDemoReports();
 const [note,setNote]=useState('');const [outcome,setOutcome]=useState('attempted');
 const readings=readingsForRequirement(r.id,monitoring.readings,monitoring.evidence);
 const progress=monitoringProgress(r,readings);
 const work=monitoring.work.find(w=>w.requirement_id===r.id);
 const events=monitoring.events.filter(e=>e.requirement_id===r.id);
 const links=monitoring.links.filter(l=>l.requirement_id===r.id);
 return <article className="space-y-3 rounded-lg border p-4">
  <h3 className="text-h3">{date(r.starts_at)} to {date(r.ends_at)}</h3>
  <p className="whitespace-pre-wrap text-body2">{r.instructions}</p>
  <p className="text-body2">{r.status} · {progress.received} of {r.required_count} readings received · {progress.late} recorded after the window ended</p>
  <p className="text-caption text-muted-foreground">Added by {r.actor_label} · original plan {r.source_publication} · retained under plan {r.current_publication} · {r.acknowledged_at?`Read by the member ${date(r.acknowledged_at)}`:'Not yet marked as read'}</p>
  {links.map(l=><p key={l.event} className="text-body2">Clinical review: {l.event==='window-ended'?'window ended':'referred to assigned doctor'} · {snapshot?.reviewTasks?.find(t=>t.id===l.review_task_id)?.status??'see review history'}</p>)}
  {work&&<p className="text-body2">Evidence collection: {work.status} · due {date(work.due_at)}</p>}
  <details><summary className="min-h-11 cursor-pointer text-body2">Qualifying readings ({readings.length})</summary>{readings.length?<ul className="space-y-2 text-body2">{readings.map(m=><li key={m.id}>{date(m.measured_at)} · {m.systolic}/{m.diastolic} mmHg{m.pulse!==null?` · pulse ${m.pulse}/min`:''} · recorded {date(m.accepted_at)}{Date.parse(m.accepted_at)>=Date.parse(r.ends_at)?' · recorded late':''}</li>)}</ul>:<p className="text-body2">No qualifying accepted readings yet.</p>}</details>
  {(work?.status==='open'||(role==='doctor'&&r.status==='active'))&&<div className="space-y-3">
   <label className="block text-body2">Outcome or cancellation note<textarea className={inputClass} maxLength={1500} disabled={disabled} value={note} onChange={e=>setNote(e.target.value)}/></label>
   {work?.status==='open'&&<div className="flex flex-wrap items-end gap-3"><label className="text-body2">Contact outcome<select className={inputClass} disabled={disabled} value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="attempted">Contact attempted</option><option value="reached">Reached</option><option value="unreachable">Unreachable</option><option value="referred">Refer to assigned doctor</option></select></label><button className={quietClass} disabled={disabled||!note.trim()} onClick={async()=>{if(await run({op:'contact',requirementId:r.id,outcome,note}))setNote('');}}>Record outcome</button></div>}
   {role==='doctor'&&r.status==='active'&&<button className={quietClass} disabled={disabled||!note.trim()} onClick={async()=>{if(await run({op:'cancel',requirementId:r.id,note}))setNote('');}}>Cancel this requirement</button>}
  </div>}
  {!!events.length&&<details><summary className="min-h-11 cursor-pointer text-body2">Requirement history</summary><ul className="space-y-2 text-body2">{events.map(e=><li key={e.id}>{e.kind.replaceAll('-',' ')} · {e.actor_label} · {date(e.created_at)}{e.note?` · ${e.note}`:''}</li>)}</ul></details>}
 </article>;
}
