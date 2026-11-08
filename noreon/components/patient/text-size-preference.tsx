'use client';
import { Check, Type } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconTile } from '@/components/patient-care/common';
import { saveTextSize } from '@/app/patient/account/preference-actions';
import { tx, type PatientLocale } from '@/lib/patient/copy';
import type { TextSize } from '@/lib/patient/member-preferences-contract';

/** Normal, Large or Extra large (prototype D8). Saved per member; the patient layout applies it. */
export function TextSizePreference({ locale: l, value, onSaved }: { locale: PatientLocale; value: TextSize; onSaved?: (value:TextSize)=>void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(next: TextSize) {
    if (busy || next === value) return;
    setBusy(true); setError('');
    try {
      const result = await saveTextSize(next);
      if (result.ok) { onSaved?.(next); router.refresh(); }
      else setError(tx(l, 'Տեքստի չափը չպահպանվեց։ Փորձեք կրկին։', 'Your text size could not be saved. Try again.', 'Не удалось сохранить размер текста. Попробуйте снова.'));
    } catch { setError(tx(l, 'Տեքստի չափը չպահպանվեց։ Փորձեք կրկին։', 'Your text size could not be saved. Try again.', 'Не удалось сохранить размер текста. Попробуйте снова.')); }
    setBusy(false);
  }
  const options: readonly [TextSize, string][] = [
    ['normal', tx(l, 'Սովորական', 'Normal', 'Обычный')],
    ['large', tx(l, 'Մեծ', 'Large', 'Крупный')],
    ['xlarge', tx(l, 'Շատ մեծ', 'Extra large', 'Очень крупный')],
  ];
  return <section className="space-y-3" aria-busy={busy}>
    <header className="flex items-center gap-3"><IconTile icon={Type}/><h2 className="text-h2">{tx(l, 'Տեքստի չափը', 'Text size', 'Размер текста')}</h2></header>
    <div role="group" aria-label={tx(l, 'Ընտրել տեքստի չափը', 'Choose your text size', 'Выберите размер текста')} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-1 rounded-xl border p-1">
      {options.map(([id, label]) => <button type="button" key={id} aria-pressed={value === id} disabled={busy} onClick={() => void change(id)} className={`flex min-h-11 items-center justify-center gap-1 rounded-lg px-1 text-center text-body2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-70 ${value === id ? 'bg-brand-navy text-on-inverse' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{value === id && <Check className="size-4 shrink-0 max-[359px]:hidden" aria-hidden/>}<span className="min-w-0 [overflow-wrap:normal]">{label}</span></button>)}
    </div>
    <p className="text-caption text-muted-foreground">{tx(l, 'Գործում է այս հավելվածի բոլոր էջերում և ձեր բոլոր սարքերում։', 'Applies to every page of this app, on all your devices.', 'Применяется ко всем страницам приложения на всех ваших устройствах.')}</p>
    {busy && <p role="status" className="text-caption text-muted-foreground">{tx(l, 'Պահպանվում է…', 'Saving…', 'Сохраняется…')}</p>}
    {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
  </section>;
}
