'use client';
import{useState,type FormEvent}from'react';
import{fieldClass,buttonClass}from'@/components/staff/shell';
import{usePilotCommand}from'./command';
import{amd}from'@/lib/pilot-commerce/format';
import{yerevanInputToInstant,yerevanStamp}from'@/lib/staff/yerevan-time';
import type{AdminCatalogTest,PilotResult,PriceSource}from'@/lib/pilot-commerce/schema';
import {SelectField} from '@/components/ui/select-field';

type Port=(input:Record<string,unknown>)=>Promise<PilotResult>;
const secondary='inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
const label='block space-y-1 text-body2';

export function SourceBadge({source}:{source:PriceSource}){
 return source==='staging-placeholder'
  ?<span className="rounded-md bg-surface-subtle-teal px-2 py-0.5 text-caption font-semibold text-brand-teal">STAGING placeholder</span>
  :<span className="rounded-md bg-muted px-2 py-0.5 text-caption font-semibold">Partner approved</span>;
}

function Outcome({c}:{c:ReturnType<typeof usePilotCommand>}){
 if(!c.message)return null;
 return <div className="space-y-2"><p role={c.failed?'alert':'status'} className="text-body2">{c.message}</p>
  {c.frozen&&<button type="button" className={secondary} disabled={c.pending} onClick={()=>c.frozen&&void c.send(c.frozen)}>Check again</button>}</div>;
}

/** Admin catalogue: tests, partner codes, package inclusion, active dates and prices with history. */
export function CatalogAdmin({tests,asOf,command}:{tests:AdminCatalogTest[];asOf:string;command:Port}){
 const staging=tests.some(test=>test.currentPrice?.source==='staging-placeholder');
 return <div className="space-y-6">
  {staging&&<p role="note" className="rounded-xl border border-brand-teal bg-surface-subtle-teal p-4 text-body2">Prices marked STAGING are fictional placeholders. Davidyants has not supplied its test list, codes, prices or tax policy yet. Members see these as sample prices.</p>}
  <section aria-labelledby="catalog-title" className="space-y-3 rounded-xl border bg-background p-4 sm:p-6">
   <h2 id="catalog-title" className="text-h3">Tests ({tests.length})</h2>
   {tests.length?<ul className="divide-y">{tests.map(test=><TestRow key={test.id} test={test} asOf={asOf} command={command}/>)}</ul>:<p className="text-body2">No tests in the catalogue yet.</p>}
  </section>
  <CreateForm command={command}/>
 </div>;
}

function TestRow({test,asOf,command}:{test:AdminCatalogTest;asOf:string;command:Port}){
 const price=test.currentPrice;
 const scheduled=test.prices.filter(p=>Date.parse(p.effectiveFrom)>Date.parse(asOf));
 return <li className="space-y-3 py-4">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <p className="break-words font-medium">{test.nameEn}</p>
    <p className="break-words text-caption text-muted-foreground" lang="hy">{test.nameHy}</p>
    <p className="text-caption text-muted-foreground">Code {test.partnerCode} · key {test.testKey} · active {test.activeFrom}{test.activeUntil?` to ${test.activeUntil}`:' onwards'}{test.active?'':' · not active today'}</p>
   </div>
   <div className="space-y-1 text-right">
    <p className="text-body2 font-semibold">{test.includedInPackage?'Included in package':price?amd(price.priceAmd):'No price'}</p>
    {test.includedInPackage&&price&&<p className="text-caption text-muted-foreground">List price {amd(price.priceAmd)}</p>}
    {price&&<SourceBadge source={price.source}/>}
    {scheduled.length>0&&<p className="text-caption">Changes to {amd(scheduled[scheduled.length-1].priceAmd)} on {yerevanStamp(scheduled[scheduled.length-1].effectiveFrom,'en')}</p>}
   </div>
  </div>
  <details className="rounded-lg border px-3"><summary className="min-h-11 cursor-pointer py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">Price history ({test.prices.length})</summary>
   <ul className="divide-y pb-3 text-body2">{test.prices.map(p=><li key={p.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{amd(p.priceAmd)} from {yerevanStamp(p.effectiveFrom,'en')}</span><span className="text-caption text-muted-foreground">{p.recordedBy}: {p.reason}</span></li>)}</ul>
  </details>
  <div className="grid gap-3 lg:grid-cols-2"><PriceForm test={test} command={command}/><EditForm key={test.revision} test={test} command={command}/></div>
 </li>;
}

function PriceForm({test,command}:{test:AdminCatalogTest;command:Port}){
 const c=usePilotCommand(command);
 const [price,setPrice]=useState(''),[source,setSource]=useState<PriceSource>('staging-placeholder'),[from,setFrom]=useState(''),[reason,setReason]=useState('');
 function submit(event:FormEvent){event.preventDefault();
  const effectiveFrom=from?yerevanInputToInstant(from):null;if(from&&!effectiveFrom)return;
  void c.send({action:'set-price',testId:test.id,priceAmd:Number(price),priceSource:source,effectiveFrom,reason:reason.trim()}).then(r=>{if(r?.status==='saved'){setPrice('');setReason('');setFrom('');}});}
 return <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" aria-label={`New price for ${test.nameEn}`}>
  <p className="text-body2 font-medium">New price</p>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className={label}><span>Price in AMD</span><input required inputMode="numeric" pattern="[0-9]{1,8}" value={price} onChange={e=>setPrice(e.target.value)} className={fieldClass}/></label>
   <label className={label}><span>Source</span><SelectField value={source} onValueChange={v=>setSource(v as PriceSource)} options={[{value:'staging-placeholder',label:'STAGING placeholder'},{value:'partner-approved',label:'Partner approved'}]}/></label>
   <label className={label}><span>Starts (Yerevan time, empty for now)</span><input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} className={fieldClass}/></label>
   <label className={label}><span>Reason</span><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className={fieldClass}/></label>
  </div>
  <button className={buttonClass} disabled={c.pending}>{c.pending?'Saving…':'Save price'}</button>
  <Outcome c={c}/>
 </form>;
}

function EditForm({test,command}:{test:AdminCatalogTest;command:Port}){
 const c=usePilotCommand(command);
 const [f,setF]=useState({partnerCode:test.partnerCode,nameEn:test.nameEn,nameHy:test.nameHy,includedInPackage:test.includedInPackage,activeFrom:test.activeFrom,activeUntil:test.activeUntil??'',reason:''});
 function submit(event:FormEvent){event.preventDefault();void c.send({action:'update-test',testId:test.id,revision:test.revision,...f,activeUntil:f.activeUntil||null,reason:f.reason.trim()});}
 return <details className="rounded-lg border px-3"><summary className="min-h-11 cursor-pointer py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">Edit details</summary>
  <form onSubmit={submit} className="space-y-3 pb-3">
   <TestFields f={f} set={patch=>setF(v=>({...v,...patch}))}/>
   <label className={label}><span>Reason</span><input required maxLength={500} value={f.reason} onChange={e=>setF(v=>({...v,reason:e.target.value}))} className={fieldClass}/></label>
   <button className={buttonClass} disabled={c.pending}>{c.pending?'Saving…':'Save details'}</button>
   <Outcome c={c}/>
  </form>
 </details>;
}

type Fields={partnerCode:string;nameEn:string;nameHy:string;includedInPackage:boolean;activeFrom:string;activeUntil:string};
function TestFields({f,set}:{f:Fields;set:(patch:Partial<Fields>)=>void}){
 return <div className="grid gap-3 sm:grid-cols-2">
  <label className={label}><span>Partner code</span><input required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}" value={f.partnerCode} onChange={e=>set({partnerCode:e.target.value})} className={fieldClass}/></label>
  <label className="flex min-h-11 items-center gap-3 self-end text-body2"><input type="checkbox" className="size-4 accent-primary" checked={f.includedInPackage} onChange={e=>set({includedInPackage:e.target.checked})}/>Included in the package</label>
  <label className={label}><span>Name in English</span><input required maxLength={200} value={f.nameEn} onChange={e=>set({nameEn:e.target.value})} className={fieldClass}/></label>
  <label className={label}><span>Name in Armenian</span><input required maxLength={200} lang="hy" value={f.nameHy} onChange={e=>set({nameHy:e.target.value})} className={fieldClass}/></label>
  <label className={label}><span>Active from</span><input required type="date" value={f.activeFrom} onChange={e=>set({activeFrom:e.target.value})} className={fieldClass}/></label>
  <label className={label}><span>Active until (optional)</span><input type="date" value={f.activeUntil} onChange={e=>set({activeUntil:e.target.value})} className={fieldClass}/></label>
 </div>;
}

function CreateForm({command}:{command:Port}){
 const c=usePilotCommand(command);
 const empty={testKey:'',partnerCode:'',nameEn:'',nameHy:'',includedInPackage:false,activeFrom:'',activeUntil:'',price:'',source:'staging-placeholder' as PriceSource,reason:''};
 const [f,setF]=useState(empty);
 function submit(event:FormEvent){event.preventDefault();
  void c.send({action:'create-test',testKey:f.testKey,partnerCode:f.partnerCode,nameEn:f.nameEn,nameHy:f.nameHy,includedInPackage:f.includedInPackage,activeFrom:f.activeFrom,activeUntil:f.activeUntil||null,
   priceAmd:f.price?Number(f.price):null,priceSource:f.source,reason:f.reason.trim()}).then(r=>{if(r?.status==='saved')setF(empty);});}
 return <form onSubmit={submit} className="space-y-3 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="catalog-add-title">
  <h2 id="catalog-add-title" className="text-h3">Add a test</h2>
  <p className="text-body2 text-muted-foreground">The test key must match the test id the booking uses, so a booked test finds its price.</p>
  <label className={label}><span>Test key</span><input required pattern="[a-z0-9][a-z0-9\-]{1,63}" value={f.testKey} onChange={e=>setF(v=>({...v,testKey:e.target.value}))} className={fieldClass}/></label>
  <TestFields f={f} set={patch=>setF(v=>({...v,...patch}))}/>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className={label}><span>Price in AMD (optional)</span><input inputMode="numeric" pattern="[0-9]{1,8}" value={f.price} onChange={e=>setF(v=>({...v,price:e.target.value}))} className={fieldClass}/></label>
   <label className={label}><span>Price source</span><SelectField value={f.source} onValueChange={next=>setF(v=>({...v,source:next as PriceSource}))} options={[{value:'staging-placeholder',label:'STAGING placeholder'},{value:'partner-approved',label:'Partner approved'}]}/></label>
  </div>
  <label className={label}><span>Reason</span><input required maxLength={500} value={f.reason} onChange={e=>setF(v=>({...v,reason:e.target.value}))} className={fieldClass}/></label>
  <button className={buttonClass} disabled={c.pending}>{c.pending?'Saving…':'Add test'}</button>
  <Outcome c={c}/>
 </form>;
}
export{Outcome as PilotOutcome,secondary as secondaryButtonClass};
