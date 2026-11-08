'use client';
import {useEffect,useRef,useState} from 'react';
import {setStaffLocale} from '@/lib/staff/staff-locale-actions';
import {realStaffSignOut} from '@/lib/patient-care/clinical-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

export function NurseChatMenu({locale:l,onLocale,onClose,signOutHeld=false}:{locale:StaffLocale;onLocale:(locale:StaffLocale)=>void;onClose:()=>void;signOutHeld?:boolean}){
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
  <button type="button" onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} className="cv2-close" onClick={onClose} aria-label={t('Close','Փակել','Закрыть')}>×</button>
  <h2>{t('Language','Լեզու','Язык')}</h2>
  <div className="cv2-languages">{([['hy','Հայերեն'],['en','English'],['ru','Русский']] as const).map(([id,label])=><button type="button" onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} key={id} aria-pressed={id===l} disabled={busy} onClick={()=>void language(id)}>{label}</button>)}</div>
  {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load, so nothing from this thread stays behind */}
  <button type="button" onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} disabled={busy||signOutHeld} onClick={()=>window.location.assign('/staff/real/nurse-chat?previous=1')}>{t('Open the previous nurse screen','Բացել բուժքրոջ նախորդ էկրանը','Открыть прежний экран медсестры')}</button>
  <form action={realStaffSignOut}><button type="submit" disabled={busy||signOutHeld}>{t('Sign out','Դուրս գալ','Выйти')}</button></form>
  {signOutHeld&&<p role="status">{t('Your reply has no result yet. Check it before signing out.','Ձեր պատասխանը դեռ արդյունք չունի։ Ստուգեք այն՝ նախքան դուրս գալը։','У вашего ответа ещё нет результата. Проверьте его, прежде чем выйти.')}</p>}
  {error&&<p role="alert">{t('Could not save the language. Try again.','Չհաջողվեց պահպանել լեզուն։ Փորձեք նորից։','Не удалось сохранить язык. Попробуйте снова.')}</p>}
 </dialog>;
}
