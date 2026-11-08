"use client";

import { useRef, useState } from "react";
import { CalendarX2 } from "lucide-react";
import type { Appointment, PilotActionState, PilotFormAction } from "@/lib/real-booking/appointment-schema";
import { BookingRecovery, bookingControl, bookingCopy as t, type BookingLocale } from "./appointment-status";

/** Two-step cancel. The visit stays booked until the clinic email is accepted. */
export function CancelVisit({ appointment, commandId, action, locale, refreshHref, staff, portal, withdraw }: { appointment: Appointment; commandId: string; action: PilotFormAction; locale: BookingLocale; refreshHref: string; staff?: boolean; portal?: boolean; withdraw?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [agreement, setAgreement] = useState("");
  const [state, setState] = useState<PilotActionState>({ ok: false });
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const recorded = !!(state.commandRecorded || state.outcomeUnknown || state.ok || ['pending', 'saved', 'unknown', 'conflict', 'unavailable'].includes(state.code ?? ''));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || recorded || (staff && !agreement.trim())) return;
    sending.current = true; setBusy(true);
    const form = new FormData();
    form.set('commandId', commandId);
    form.set('appointmentId', appointment.id);
    form.set('revision', String(appointment.revision));
    form.set('agreementSource', staff ? agreement : '');
    let result: PilotActionState;
    try { result = await action(state, form); } catch { result = { ok: false, code: 'unknown', outcomeUnknown: true }; }
    setState(result); setBusy(false);
    // A recorded or unknown result keeps the button locked; only a fresh page gets a new command.
    if (!(result.commandRecorded || result.outcomeUnknown || result.ok)) sending.current = false;
  }
  const message = state.code === 'saved'
    ? portal ? withdraw ? t(locale, "Your request is cancelled. The clinic can see this.", "Ձեր հարցումը չեղարկված է։ Կլինիկան տեսնում է դա։", "Ваша заявка отменена. Клиника видит это.") : t(locale, "The visit is cancelled. The clinic can see this.", "Այցը չեղարկված է։ Կլինիկան տեսնում է դա։", "Визит отменён. Клиника видит это.")
    : t(locale, "The clinic has been emailed and the visit is cancelled.", "Կլինիկային նամակ է ուղարկվել, և այցը չեղարկված է։", "Клинике отправлено письмо, визит отменён.")
    : state.outcomeUnknown || state.code === 'unknown'
      ? t(locale, "We could not confirm that the clinic was told. Check the saved visit before trying again.", "Չհաջողվեց հաստատել, որ կլինիկան տեղեկացվել է։ Նոր փորձից առաջ ստուգեք պահպանված այցը։", "Не удалось подтвердить, что клиника уведомлена. Перед новой попыткой проверьте сохранённый визит.")
      : state.code === 'failed'
        ? t(locale, staff ? "The cancellation email failed. The visit is still booked. Retry the email below after checking the clinic address." : "The cancellation email failed, so the visit is still booked. Contact Noreon to cancel.", staff ? "Չեղարկման նամակը չի ուղարկվել։ Այցը դեռ գրանցված է։ Ստուգեք կլինիկայի հասցեն և կրկին ուղարկեք նամակը։" : "Չեղարկման նամակը չի ուղարկվել, ուստի այցը դեռ գրանցված է։ Չեղարկելու համար կապվեք Noreon-ի հետ։", staff ? "Письмо об отмене не отправлено. Визит остаётся записанным. Проверьте адрес клиники и повторите отправку ниже." : "Письмо об отмене не отправлено, поэтому визит остаётся записанным. Для отмены свяжитесь с Noreon.")
        : state.code === 'pending' || state.code === 'arrangement-review'
          ? t(locale, "Your cancellation is recorded. The visit stays booked until the clinic email is sent.", "Չեղարկումը գրանցված է։ Այցը գրանցված կմնա, մինչև կլինիկային նամակն ուղարկվի։", "Ваша отмена зарегистрирована. Визит остаётся записанным до отправки письма клинике.")
          : state.code === 'conflict'
            ? t(locale, "The visit changed. Check the latest details before cancelling.", "Այցը փոխվել է։ Չեղարկելուց առաջ ստուգեք վերջին տվյալները։", "Визит изменился. Перед отменой проверьте актуальные данные.")
            : state.code === 'invalid'
              ? t(locale, "Record how the member agreed to cancel.", "Նշեք, թե ինչպես է անդամը համաձայնել չեղարկմանը։", "Укажите, как участник согласился на отмену.")
              : state.code === 'unavailable'
                ? t(locale, "Cancelling is unavailable right now. The visit is still booked.", "Չեղարկումն այժմ անհասանելի է։ Այցը դեռ գրանցված է։", "Отмена сейчас недоступна. Визит остаётся записанным.")
                : '';
  return <details className="border-t border-border" open={confirming || undefined}>
    <summary onClick={event => { event.preventDefault(); setConfirming(!confirming); }} className="inline-flex min-h-11 cursor-pointer list-none items-center py-2 text-body2 text-muted-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">{withdraw ? t(locale, "Cancel request", "Չեղարկել հարցումը", "Отменить заявку") : t(locale, "Cancel this visit", "Չեղարկել այս այցը", "Отменить этот визит")}</summary>
    <form onSubmit={submit} className="space-y-3 pb-3" aria-busy={busy}>
      <p className="text-body2">{portal ? (withdraw ? t(locale, "The clinic will see that you no longer need this time.", "Կլինիկան կտեսնի, որ այս ժամն այլևս ձեզ պետք չէ։", "Клиника увидит, что это время вам больше не нужно.") : t(locale, staff ? "The visit is cancelled at once and the clinic sees it in its portal." : "Your visit is cancelled at once and the clinic sees it in its portal.", staff ? "Այցն անմիջապես չեղարկվում է, և կլինիկան տեսնում է դա իր համակարգում։" : "Ձեր այցն անմիջապես չեղարկվում է, և կլինիկան տեսնում է դա իր համակարգում։", staff ? "Визит отменяется сразу, и клиника видит это в своём портале." : "Ваш визит отменяется сразу, и клиника видит это в своём портале.")) : t(locale, staff ? "We will email the clinic, with Noreon copied. The visit stays booked until that email is accepted." : "We will email the clinic, with Noreon copied, to cancel. Your visit stays booked until that email is accepted.", staff ? "Մենք նամակ կուղարկենք կլինիկային՝ Noreon-ին պատճենով։ Այցը գրանցված կմնա, մինչև նամակն ընդունվի։" : "Մենք չեղարկման նամակ կուղարկենք կլինիկային՝ Noreon-ին պատճենով։ Ձեր այցը գրանցված կմնա, մինչև նամակն ընդունվի։", staff ? "Мы отправим клинике письмо с копией для Noreon. Визит остаётся записанным, пока письмо не будет принято." : "Мы отправим клинике письмо об отмене с копией для Noreon. Ваш визит остаётся записанным, пока письмо не будет принято.")}</p>
      {staff && <label className="block space-y-2 text-body2"><span className="font-medium">{t(locale, "Member agreement", "Անդամի համաձայնությունը", "Согласие участника")}</span><span className="block text-caption text-muted-foreground">{t(locale, "Record how and when the member asked to cancel.", "Նշեք՝ անդամը ինչպես և երբ է խնդրել չեղարկել։", "Укажите, как и когда участник попросил отменить визит.")}</span><textarea name="agreementSource" value={agreement} onChange={event => setAgreement(event.target.value)} disabled={busy || recorded} required maxLength={1000} rows={2} className={bookingControl} /></label>}
      {message && <p role={state.ok ? 'status' : 'alert'} className="text-body2">{message}</p>}
      {recorded ? <BookingRecovery href={refreshHref} locale={locale} /> : <button type="submit" disabled={busy || (staff && !agreement.trim())} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-destructive px-4 py-2 text-body2 font-medium text-destructive sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"><CalendarX2 aria-hidden className="size-4 shrink-0" />{busy ? t(locale, "Cancelling…", "Չեղարկվում է…", "Отменяем…") : withdraw ? t(locale, "Yes, cancel this request", "Այո, չեղարկել հարցումը", "Да, отменить эту заявку") : t(locale, "Yes, cancel this visit", "Այո, չեղարկել այս այցը", "Да, отменить этот визит")}</button>}
    </form>
  </details>;
}
