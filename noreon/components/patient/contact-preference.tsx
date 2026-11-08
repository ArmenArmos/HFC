'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, MessageCircle, Phone, PhoneCall, Save, Send } from 'lucide-react';
import { CareLink, IconTile, stamp } from '@/components/patient-care/common';
import { Button } from '@/components/ui/button';
import { tx, type PatientLocale } from '@/lib/patient/copy';
import { cancelCallback, requestCallback, saveContactPreference } from '@/app/patient/account/preference-actions';
import { CONTACT_TIMES, type CallbackFrom, type CallbackResult, type ContactChannel, type ContactTime, type MemberContactStatus, type PreferenceResult } from '@/lib/patient/member-preferences-contract';

/** How the care team should contact the member, and a callback request (prototype D6). */
export function ContactPreference({ locale: l, status }: { locale: PatientLocale; status: MemberContactStatus }) {
  const router = useRouter();
  const [channel, setChannel] = useState<ContactChannel>(status.contactChannel);
  const [times, setTimes] = useState<ContactTime[]>(status.contactTimes);
  const [saved, setSaved] = useState<PreferenceResult | null>(null);
  const [callback, setCallback] = useState<CallbackResult | null>(null);
  const [pending, start] = useTransition();
  const timeLabel: Record<ContactTime, string> = {
    morning: tx(l, 'Առավոտ', 'Morning', "Утро"), afternoon: tx(l, 'Կեսօրից հետո', 'Afternoon', "День"), evening: tx(l, 'Երեկո', 'Evening', "Вечер"),
  };
  const failed = tx(l, 'Չհաջողվեց պահպանել։ Ձեր ընտրությունը մնացել է այս էջում։ Փորձեք նորից։', 'Could not save. Your choice is still on this page. Try again.', "Не удалось сохранить. Ваш выбор остался на этой странице. Попробуйте снова.");
  const callbackError = (r: Extract<CallbackResult, { ok: false }>) => r.reason === 'rate_limited'
    ? tx(l, 'Դուք այսօր արդեն մի քանի հարցում եք ուղարկել։ Փորձեք վաղը կամ գրեք Telegram-ով։', 'You have sent several requests today. Try tomorrow, or write to us in Telegram.', "Сегодня вы уже отправили несколько запросов. Попробуйте завтра или напишите нам в Telegram.")
    : r.reason === 'not_open' ? tx(l, 'Այս հարցումն արդեն փակված է։', 'This request is already closed.', "Этот запрос уже закрыт.")
    : tx(l, 'Հարցումը չուղարկվեց։ Փորձեք նորից։', 'Your request was not sent. Try again.', "Не удалось отправить запрос. Попробуйте снова.");
  function ask(from: CallbackFrom) {
    setCallback(null);
    start(async () => {
      try { const r = await requestCallback(from); setCallback(r); if (r.ok) router.refresh(); }
      catch { setCallback({ ok: false, reason: 'unavailable' }); }
    });
  }
  function cancel(id: string) {
    setCallback(null);
    start(async () => {
      try { const r = await cancelCallback(id); setCallback(r); router.refresh(); }
      catch { setCallback({ ok: false, reason: 'unavailable' }); }
    });
  }
  return <div className="max-w-2xl space-y-6">
    <header className="flex items-start gap-3"><IconTile icon={PhoneCall}/><div className="min-w-0 space-y-2">
      <h1 className="min-w-0 text-h1 [overflow-wrap:anywhere]">{tx(l, 'Կապ և հետզանգ', 'Contact and callback', "Связь и обратный звонок")}</h1>
      <p className="text-body2 text-muted-foreground">{tx(l, 'Ասեք, թե ինչպես է ձեզ հարմար, որ կապվենք ձեզ հետ։ Հաղորդագրություններ ուղարկում ենք միայն Telegram-ով։', 'Tell us how you prefer to be contacted. We send messages only in Telegram.', "Укажите, как с вами удобнее связаться. Сообщения мы отправляем только в Telegram.")}</p>
    </div></header>

    <form className="journey-card space-y-5" onSubmit={e => { e.preventDefault(); setSaved(null); start(async () => {
      try { const r = await saveContactPreference({ channel, times }); setSaved(r); if (r.ok) router.refresh(); }
      catch { setSaved({ ok: false, reason: 'unavailable' }); }
    }); }}>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-2 text-body1 font-medium">{tx(l, 'Ինչպես կապվել ձեզ հետ', 'How to contact you', "Как с вами связаться")}</legend>
        {(['telegram', 'phone'] as const).map(value => <label key={value} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-muted/60 ${channel === value ? 'border-brand-teal bg-surface-subtle-teal' : 'border-border bg-background'}`}>
          <input className="size-5 shrink-0 accent-brand-teal" type="radio" name="contact-channel" value={value} checked={channel === value} onChange={() => { setChannel(value); setSaved(null); }}/>
          {value === 'telegram' ? <Send className="size-5 shrink-0" aria-hidden/> : <Phone className="size-5 shrink-0" aria-hidden/>}
          <span className="min-w-0 text-body2 font-medium">{value === 'telegram' ? tx(l, 'Telegram հաղորդագրություն', 'Telegram message', "Сообщение в Telegram") : tx(l, 'Հեռախոսազանգ', 'Phone call', "Телефонный звонок")}
            <span className="mt-1 block text-caption font-normal text-muted-foreground">{value === 'telegram' ? tx(l, 'Խնամքի թիմը գրում է ձեզ Telegram-ում։', 'Your care team writes to you in Telegram.', "Медицинская команда напишет вам в Telegram.") : tx(l, 'Խնամքի թիմից մեկը զանգում է ձեզ։', 'Someone from the care team calls you.', "Вам позвонит сотрудник медицинской команды.")}</span></span>
        </label>)}
      </fieldset>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-1 text-body1 font-medium">{tx(l, 'Հարմար ժամեր', 'Best times', "Удобное время")}</legend>
        <p className="text-caption text-muted-foreground">{tx(l, 'Ոչինչ մի նշեք, եթե ցանկացած ժամ հարմար է։', 'Choose none if any time suits you.', "Если вам удобно в любое время, ничего не выбирайте.")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {CONTACT_TIMES.map(t => <label key={t} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-muted/60 ${times.includes(t) ? 'border-brand-teal bg-surface-subtle-teal' : 'border-border bg-background'}`}>
            <input type="checkbox" className="size-5 shrink-0 accent-brand-teal" checked={times.includes(t)} onChange={e => { setSaved(null); setTimes(e.target.checked ? [...times, t] : times.filter(x => x !== t)); }}/>
            <span className="min-w-0 text-body2 font-medium">{timeLabel[t]}</span>
          </label>)}
        </div>
      </fieldset>
      <Button className="h-auto min-h-11 max-w-full gap-2 whitespace-normal px-4 py-3" type="submit" disabled={pending}><Save className="size-4" aria-hidden/>{tx(l, 'Պահպանել կապի եղանակը', 'Save how to contact me', "Сохранить способ связи")}</Button>
      {saved && <p role={saved.ok ? 'status' : 'alert'} className={`flex items-start gap-2 rounded-xl border p-4 text-body2 ${saved.ok ? 'border-border bg-surface-subtle-teal' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>{saved.ok && <Check className="mt-0.5 size-4 shrink-0" aria-hidden/>}{saved.ok ? tx(l, 'Պահպանված է։', 'Saved.', "Сохранено.") : failed}</p>}
    </form>

    <section aria-labelledby="callback" className="journey-card space-y-4">
      <header className="flex items-center gap-3"><IconTile icon={MessageCircle}/><h2 id="callback" className="text-h2">{tx(l, 'Խնդրել, որ կապվենք ձեզ հետ', 'Ask us to contact you', "Попросить связаться с вами")}</h2></header>
      <p className="text-body2">{tx(l, 'Սա սովորական հարցերի համար է։ Եթե հիմա վատ եք զգում, զանգահարեք 103։', 'This is for routine questions. If you feel unwell now, call 103.', "Это для обычных вопросов. Если вам сейчас плохо, позвоните 103.")}</p>
      {status.openRequest
        ? <div className="space-y-3 rounded-xl border bg-surface-subtle-teal p-4">
            <p role="status" className="flex items-start gap-2 text-body2"><Check className="mt-0.5 size-4 shrink-0" aria-hidden/><span>{tx(l,
              `Ձեր հարցումն ուղարկվել է ${stamp(status.openRequest.createdAt, l)}։ Խնամքի թիմը կտեսնի այն և կփորձի կապվել ձեզ հետ ձեր նախընտրած եղանակով։`,
              `Your request was sent on ${stamp(status.openRequest.createdAt, l)}. The care team will see it and try to reach you the way you prefer.`, `Ваш запрос отправлен ${stamp(status.openRequest.createdAt, l)}. Медицинская команда увидит его и постарается связаться с вами удобным для вас способом.`)}</span></p>
            <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={() => cancel(status.openRequest!.id)}>{tx(l, 'Չեղարկել հարցումը', 'Cancel my request', "Отменить мой запрос")}</Button>
          </div>
        : status.callbacksEnabled
        ? <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-auto min-h-11 w-full max-w-full whitespace-normal px-4 py-3 sm:w-auto" disabled={pending} onClick={() => ask('nurse')}>{tx(l, 'Խնդրել բուժքրոջը կապվել ինձ հետ', 'Ask a nurse to contact me', "Попросить медсестру связаться со мной")}</Button>
            <Button type="button" variant="outline" className="h-auto min-h-11 w-full max-w-full whitespace-normal px-4 py-3 sm:w-auto" disabled={pending} onClick={() => ask('care_team')}>{tx(l, 'Խնդրել խնամքի թիմին կապվել ինձ հետ', 'Ask the care team to contact me', "Попросить медицинскую команду связаться со мной")}</Button>
          </div>
        : <p className="text-body2 text-muted-foreground">{tx(l, 'Հետզանգի հարցումները դեռ հասանելի չեն։ Կարող եք պահպանել ձեր նախընտրած կապի եղանակը։', 'Callback requests are not available yet. You can still save how you prefer to be contacted.', "Запросы на обратный звонок пока недоступны. Вы можете сохранить удобный для вас способ связи.")}</p>}
      {callback && !callback.ok && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-body2 text-destructive">{callbackError(callback)}</p>}
      {callback?.ok && callback.result === 'cancelled' && <p role="status" className="text-body2">{tx(l, 'Հարցումը չեղարկված է։', 'Your request is cancelled.', "Ваш запрос отменён.")}</p>}
    </section>
    <CareLink href="/patient/account" icon={ArrowLeft}>{tx(l, 'Վերադառնալ իմ էջ', 'Back to Me', "Вернуться в мой профиль")}</CareLink>
  </div>;
}
