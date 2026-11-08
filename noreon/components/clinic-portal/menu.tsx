'use client';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {pick,type Locale} from '@/lib/locale';

/** Clinic-only disclosure. Native listeners also see actions portaled into its slot. */
export function ClinicMenu({locale,children}:{locale:Locale;children:ReactNode}){
 const [open,setOpen]=useState(false);
 const id=useId(),root=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  const choose=(event:Event)=>{if(panel.current?.contains(event.target as Node)&&(event.target as HTMLElement).closest('button,a'))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',outside);
  document.addEventListener('focusin',outside);
  document.addEventListener('click',choose);
  document.addEventListener('keydown',escape);
  return()=>{
   document.removeEventListener('pointerdown',outside);
   document.removeEventListener('focusin',outside);
   document.removeEventListener('click',choose);
   document.removeEventListener('keydown',escape);
  };
 },[open]);
 return <div ref={root} className="relative">
  <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)} className="min-h-11 rounded-md border px-3 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-ring">{pick(locale,{en:'Menu',hy:'Ընտրացանկ',ru:'Меню'})}</button>
  <div ref={panel} id={id} hidden={!open} className="absolute right-0 z-30 max-h-[75dvh] w-[min(22rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-xl border bg-background p-4 shadow-lg">{children}</div>
 </div>;
}
