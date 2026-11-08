import Link from 'next/link';
import {Languages} from 'lucide-react';
import type {Route} from 'next';
import {type Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {setClinicLocale} from '@/lib/clinic-portal/locale-actions';

/** Clinic choices persist a display preference without requiring sign-in or JavaScript. */
export function SigninLanguageLinks({path,locale,extra=''}:{path:string;locale:Locale;extra?:string}){
 const link=(value:Locale,label:string)=>{
  const className=`inline-flex min-h-11 items-center rounded-md px-3 text-body2 focus-visible:outline-2 focus-visible:outline-ring ${locale===value?'bg-muted font-semibold':'hover:bg-muted'}`;
  if(path.startsWith('/clinic/real/'))return <form action={setClinicLocale}>
   <input type="hidden" name="returnTo" value={`${path}?locale=${value}${extra?`&${extra}`:''}`}/>
   <button type="submit" name="locale" value={value} lang={value} aria-current={locale===value?'page':undefined} className={className}>{label}</button>
  </form>;
  return <Link href={`${path}${value!=='en'?`?locale=${value}${extra?`&${extra}`:''}`:extra?`?${extra}`:''}` as Route} lang={value} aria-current={locale===value?'page':undefined} className={className}>{label}</Link>;
 };
 return <nav className="flex items-center justify-end gap-1" aria-label={st(locale,'Language','Լեզու','Язык')}><Languages className="size-4 text-muted-foreground" aria-hidden/>{link('en','English')}{link('hy','Հայերեն')}{link('ru','Русский')}</nav>;
}
