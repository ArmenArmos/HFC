'use client';
import {useEffect,useRef} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {NurseUrgentGuidance} from '@/components/staff/nurse-urgent-guidance';

export function NurseUrgentSheet({locale,onClose}:{locale:StaffLocale;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,box=dialog.current;
  box?.showModal();box?.focus({preventScroll:true});
  return ()=>{box?.close();previous?.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} tabIndex={-1} className="cv2-menu ncv2-guidance" aria-label={st(locale,'Urgent guidance','Շտապ ուղեցույց','Экстренные рекомендации')} onCancel={onClose}
  onClick={event=>{if(event.target===dialog.current&&event.clientY<dialog.current.getBoundingClientRect().top)onClose();}}>
  <button type="button" className="cv2-close" onClick={onClose} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={st(locale,'Close','Փակել','Закрыть')}>×</button>
  <NurseUrgentGuidance locale={locale}/>
 </dialog>;
}
