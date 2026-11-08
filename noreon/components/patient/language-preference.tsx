'use client';
import { Check, Languages } from 'lucide-react';
import { IconTile } from '@/components/patient-care/common';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveLanguagePreference } from '@/app/patient/account/locale-actions';
import { safeRequest } from '@/lib/patient/transport';
import { tx, type PatientLocale } from '@/lib/patient/copy';
import { SignInEnded } from './sign-in-ended';
export function LanguagePreference({locale,revision,embedded=false,saveAction=saveLanguagePreference,onSaved}:{locale:PatientLocale;revision:number;embedded?:boolean;saveAction?:typeof saveLanguagePreference;onSaved?:()=>void}) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [applied,setSelected] = useState<PatientLocale | null>(null);
  const selected = applied ?? locale;
  const [saved,setSaved] = useState(false);
  const [error,setError] = useState('');
  const [signedOut,setSignedOut] = useState(false);
  async function change(next:PatientLocale) {
    if (busy || next === selected) return;
    setBusy(true);setError('');setSignedOut(false);setSaved(false);
    const result = await safeRequest(()=>saveAction({locale:next,expectedLocale:selected,expectedRevision:revision}));
    if (result?.ok) { setSelected(next);setSaved(true); if (onSaved) onSaved(); else router.refresh(); }
    else if (result && 'reason' in result && result.reason === 'signed_out') setSignedOut(true);
    else setError(result && 'reason' in result && result.reason === 'conflict'
      ? tx(locale,'Ձեր տվյալները փոխվել են։ Թարմացրեք էջը և փորձեք կրկին։','Your details changed. Refresh the page and try again.','Ваши данные изменились. Обновите страницу и попробуйте снова.')
      : tx(locale,'Լեզուն չպահպանվեց։ Փորձեք կրկին։','Your language could not be saved. Try again.','Не удалось сохранить язык. Попробуйте снова.'));
    setBusy(false);
  }
  return <section className={embedded ? "space-y-3" : "journey-card space-y-4"} aria-busy={busy}>
    <header className="flex items-center gap-3"><IconTile icon={Languages}/><h2 className="text-h2">{tx(locale,'Լեզու','Language','Язык')}</h2></header>
    <div role="group" aria-label={tx(locale,'Ընտրել լեզուն','Choose your language','Выберите язык')} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-1 rounded-xl border p-1">
      {([['hy','Հայերեն'],['en','English'],['ru','Русский']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={selected===id} disabled={busy} onClick={()=>void change(id)} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-body2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-70 ${selected===id?'bg-brand-navy text-on-inverse':'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{selected===id&&<Check className="size-4 shrink-0" aria-hidden/>}{label}</button>)}
    </div>
    {busy && <p role="status" className="text-caption text-muted-foreground">{tx(locale,'Պահպանվում է…','Saving…','Сохраняется…')}</p>}
    {saved && <p role="status" className="text-caption text-muted-foreground">{tx(selected,'Լեզուն պահպանված է։','Your language is saved.','Ваш язык сохранён.')}</p>}
    {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    {signedOut && <SignInEnded locale={locale}/>}
  </section>;
}
