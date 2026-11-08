import{Languages}from'lucide-react';
import{setStaffLocale}from'@/lib/staff/staff-locale-actions';
import{st,type StaffLocale}from'@/lib/staff/staff-locale-copy';

/** Three plain submit buttons, so the switch works before hydration too. */
export function StaffLocaleSwitch({locale}:{locale:StaffLocale}){
 const option=(value:StaffLocale,label:string,lang:string)=><button name="locale" value={value} lang={lang} aria-pressed={locale===value} className={`inline-flex min-h-11 items-center rounded-md px-3 text-body2 focus-visible:outline-2 focus-visible:outline-ring ${locale===value?'bg-muted font-semibold':'hover:bg-muted'}`}>{label}</button>;
 return <form action={setStaffLocale} className="flex items-center gap-1" aria-label={st(locale,'Language','Լեզու','Язык')}>
  <Languages className="size-4 text-muted-foreground" aria-hidden/>
  {option('en','English','en')}{option('hy','Հայերեն','hy')}{option('ru','Русский','ru')}
 </form>;
}
