'use client';
import type {ReactNode} from 'react';
import {useEffect,useRef,useState} from 'react';
import {setStaffLocale} from '@/lib/staff/staff-locale-actions';
import {realStaffSignOut} from '@/lib/patient-care/clinical-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

export function StaffChatMenu({locale:l,onLocale,onClose,oldWorkspace,children}:{children?:ReactNode;locale:StaffLocale;onLocale:(locale:StaffLocale)=>void;onClose:()=>void;oldWorkspace?:string}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,box=dialog.current;
  box?.showModal();box?.focus({preventScroll:true});
  return ()=>{box?.close();previous?.focus({preventScroll:true});};
 },[]);
 async function language(locale:StaffLocale){
  if(busy||locale===l)return;
  setBusy(true);setError(false);
  try{const form=new FormData();form.set('locale',locale);await setStaffLocale(form);onLocale(locale);}
  catch{setError(true);}
  finally{setBusy(false);}
 }
 return <dialog ref={dialog} tabIndex={-1} className="cv2-menu" aria-label={t('Menu','Ընտրացանկ','Меню')} onCancel={onClose}
  onClick={event=>{if(event.target===dialog.current&&event.clientY<dialog.current.getBoundingClientRect().top)onClose();}}>
  <button type="button" className="cv2-close" onClick={onClose} aria-label={t('Close','Փակել','Закрыть')}>×</button>
  <h2>{t('Language','Լեզու','Язык')}</h2>
  <div className="cv2-languages">{([['hy','Հայերեն'],['en','English'],['ru','Русский']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={id===l} disabled={busy} onClick={()=>void language(id)}>{label}</button>)}</div>
  {oldWorkspace&&<form action={oldWorkspace}><button type="submit" disabled={busy}>{t('Old workspace','Հին աշխատատարածք','Прежнее рабочее пространство')}</button></form>}
  {children}
  <form action={realStaffSignOut}><button type="submit" disabled={busy}>{t('Sign out','Դուրս գալ','Выйти')}</button></form>
  {error&&<p role="alert">{t('Could not save the language. Try again.','Չհաջողվեց պահպանել լեզուն։ Փորձեք նորից։','Не удалось сохранить язык. Попробуйте снова.')}</p>}
 </dialog>;
}
