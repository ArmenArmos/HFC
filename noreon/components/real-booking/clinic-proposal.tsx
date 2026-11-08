"use client";

import { memberInstruction } from "@/lib/text-language";
import { useId, useRef, useState } from "react";
import { CalendarClock, MapPin } from "lucide-react";
import { termsText } from "@/lib/real-booking/display-time";
import type { Appointment, PilotActionState, PilotFormAction } from "@/lib/real-booking/appointment-schema";
import { BookingRecovery, bookingCopy as t, type BookingLocale } from "./appointment-status";

/** A clinic suggested another time. Nothing moves until the member accepts it. */
export function ClinicProposal({ appointment, commandId, action, locale, refreshHref }: { appointment: Appointment; commandId: string; action: PilotFormAction; locale: BookingLocale; refreshHref: string }) {
  const headingId = useId();
  const proposal = appointment.portal?.proposal;
  const [state, setState] = useState<PilotActionState>({ ok: false });
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  if (!proposal) return null;
  const recorded = !!(state.commandRecorded || state.outcomeUnknown || state.ok || ['conflict', 'unavailable'].includes(state.code ?? ''));
  async function answer(accept: boolean) {
    if (sending.current || recorded) return;
    sending.current = true; setBusy(true);
    const form = new FormData();
    form.set('commandId', commandId);
    form.set('proposalId', proposal!.id);
    form.set('accept', String(accept));
    let result: PilotActionState;
    try { result = await action(state, form); } catch { result = { ok: false, code: 'unknown', outcomeUnknown: true }; }
    setState(result); setBusy(false);
    if (!(result.commandRecorded || result.outcomeUnknown || result.ok)) sending.current = false;
  }
  const message = state.code === 'saved' ? t(locale, "Done. Your visit is at the new time.", "Պատրաստ է։ Ձեր այցը նոր ժամին է։", "Готово. Ваш визит перенесён на новое время.")
    : state.code === 'declined' ? t(locale, "You declined the new time. Your booking has not changed.", "Դուք մերժեցիք նոր ժամը։ Ձեր գրանցումը չի փոխվել։", "Новое время отклонено. Ваша запись не изменилась.")
    : state.code === 'conflict' ? t(locale, "That time is no longer available, or the booking changed. Check the latest details.", "Այդ ժամն այլևս հասանելի չէ, կամ գրանցումը փոխվել է։ Ստուգեք վերջին տվյալները։", "Это время больше недоступно или запись изменилась. Проверьте актуальные данные.")
    : state.code === 'invalid' ? t(locale, "That time does not cover your tests. Choose another time below.", "Այդ ժամը չի ներառում ձեր հետազոտությունները։ Ստորև ընտրեք այլ ժամ։", "Это время не подходит для ваших анализов. Выберите другое время ниже.")
    : state.code === 'unavailable' ? t(locale, "Answering is unavailable right now. Your booking has not changed.", "Պատասխանելն այժմ անհասանելի է։ Ձեր գրանցումը չի փոխվել։", "Ответить сейчас нельзя. Ваша запись не изменилась.")
    : state.outcomeUnknown || state.code === 'unknown' ? t(locale, "We could not confirm your answer. Check the saved booking before trying again.", "Չհաջողվեց հաստատել ձեր պատասխանը։ Նոր փորձից առաջ ստուգեք պահպանված այցը։", "Не удалось подтвердить ваш ответ. Перед новой попыткой проверьте сохранённую запись.") : '';
  const button = "inline-flex min-h-12 w-full items-center justify-center rounded-lg px-4 py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 sm:w-auto";
  return <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-brand-navy p-4" aria-busy={busy}>
    <h2 id={headingId} className="flex items-center gap-2 text-body1 font-semibold"><CalendarClock aria-hidden className="size-5 shrink-0 text-brand-navy" />{t(locale, "New time proposed: accept or decline", "Կլինիկան նոր ժամ է առաջարկել։ Ընդունեք կամ մերժեք", "Предложено новое время: примите или отклоните")}</h2>
    <p className="text-h3">{termsText({ startsAt: proposal.startsAt, endsAt: proposal.endsAt, timezone: 'Asia/Yerevan', mode: 'clinic', location: proposal.clinicAddress }, locale)} (UTC+4)</p>
    <p className="flex items-start gap-2 break-words text-body2"><MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{proposal.clinicName} · {proposal.clinicAddress}</span></p>
    {proposal.note && <p className="break-words text-body2">{t(locale, "Note from the clinic", "Կլինիկայի նշումը", "Примечание от клиники")}: {memberInstruction(proposal.note, locale)}</p>}
    <p className="text-caption text-muted-foreground">{appointment.current ? t(locale, "If you accept, your visit moves to this time. If you decline, it stays as it is.", "Եթե ընդունեք, ձեր այցը կտեղափոխվի այս ժամին։ Եթե մերժեք, այն կմնա նույնը։", "Если вы согласитесь, визит будет перенесён на это время. Если откажетесь, он останется без изменений.") : t(locale, "If you accept, your visit is booked at this time. If you decline, your request stays with the clinic.", "Եթե ընդունեք, ձեր այցը կգրանցվի այս ժամին։ Եթե մերժեք, ձեր հարցումը կմնա կլինիկայում։", "Если вы согласитесь, визит будет записан на это время. Если откажетесь, ваша заявка останется у клиники.")}</p>
    {message && <p role={state.ok ? 'status' : 'alert'} className="text-body2">{message}</p>}
    {recorded ? <BookingRecovery href={refreshHref} locale={locale} /> : <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void answer(true)} className={`${button} bg-primary text-primary-foreground`}>{t(locale, "Accept new time", "Ընդունել նոր ժամը", "Принять новое время")}</button>
      <button type="button" disabled={busy} onClick={() => void answer(false)} className={`${button} border border-border`}>{t(locale, "Decline new time", "Մերժել նոր ժամը", "Отклонить новое время")}</button>
    </div>}
  </section>;
}
