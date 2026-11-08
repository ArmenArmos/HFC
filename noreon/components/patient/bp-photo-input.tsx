"use client";
import {useRef,useState} from 'react';
import {checkBp} from './bp-entry-values';
import {prepareBpPhoto} from '@/lib/bp-photo/client';
import {BP_PHOTO} from '@/lib/bp-photo/copy';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import type {BpPhotoResult} from '@/lib/bp-photo/reader';

export function BpPhotoInput({locale:l,disabled,onRead,onBusy}:{locale:CardLocale;disabled:boolean;
 onRead:(reading:Extract<BpPhotoResult,{status:'read'}>)=>void;onBusy:(busy:boolean)=>void}){
 const picker=useRef<HTMLInputElement>(null),sending=useRef(false);
 const [busy,setBusy]=useState(false),[line,setLine]=useState<string|null>(null);
 const send=async(file:File)=>{
  if(disabled||sending.current)return;
  sending.current=true;setBusy(true);onBusy(true);setLine(say(l,BP_PHOTO.busy));
  try{
   const bytes=await prepareBpPhoto(file);
   const response=await fetch('/patient/chat/bp-photo',{method:'POST',credentials:'same-origin',body:bytes,signal:AbortSignal.timeout(45_000)});
   const result=await response.json() as BpPhotoResult;
   if(response.ok&&result.status==='read'&&checkBp({systolic:String(result.systolic),diastolic:String(result.diastolic),pulse:result.pulse===null?'':String(result.pulse)}).ok){
    onRead(result);setLine(say(l,result.pulse===null?BP_PHOTO.noPulse(result.systolic,result.diastolic):BP_PHOTO.read(result.systolic,result.diastolic,result.pulse)));
   }else setLine(say(l,result.status==='unclear'?BP_PHOTO.unclear:BP_PHOTO.unavailable));
  }catch{setLine(say(l,BP_PHOTO.unavailable));}
  finally{sending.current=false;setBusy(false);onBusy(false);if(picker.current)picker.current.value='';}
 };
 return <div>
  <input ref={picker} type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" tabIndex={-1} aria-hidden data-bp-photo-input onChange={event=>{const file=event.target.files?.[0];if(file)void send(file);}} />
  <button type="button" className="min-h-12 rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50" data-bp-photo disabled={disabled||busy} aria-busy={busy} onClick={()=>picker.current?.click()}>{say(l,BP_PHOTO.button)}</button>
  <p role="status" aria-live="polite" aria-atomic="true" data-bp-photo-status>{line}</p>
 </div>;
}
