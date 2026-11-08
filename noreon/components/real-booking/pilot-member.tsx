"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, CalendarDays, House, MapPin } from "lucide-react";
import { bookingDateText, bookingTimeText, termsText } from "@/lib/real-booking/display-time";
import type { Appointment, PilotActionState, PilotBookingData, PilotFormAction, PublicBookingOffer, PublicProgramItem } from "@/lib/real-booking/appointment-schema";
import { CancelVisit } from "./cancel-visit";
import { BookingJourney, BookingTests, VisitActor, testStates } from "./booking-tests";
import { ClinicProposal } from "./clinic-proposal";
import { canBookNewVisit, countsForProgramme, programmeVisits } from "@/lib/real-booking/visit-gate";
import { TestPrices, MemberPaymentStatus, paymentFor, type MemberPricing } from "@/components/pilot-commerce/member-pricing";
import { AppointmentStatus, visitAttended, BookingCoverage, BookingRecovery, BookingUnavailable, bookingControl, bookingCopy as t, type BookingLocale } from "./appointment-status";

type SelectionProps = { offers: PublicBookingOffer[]; program: PublicProgramItem[]; locale: BookingLocale; commandId: string; action: PilotFormAction; refreshHref: string; appointment?: Appointment; staff?: boolean; rebook?: boolean; clinicOnly?: boolean };
const day = (value: string) => new Date(Date.parse(value) + 4 * 3600000).toISOString().slice(0, 10);
const locationKey = (offer: PublicBookingOffer) => `${offer.mode}:${offer.clinicId}`;
function SelectionSession(props: SelectionProps) {
  // A server-supplied command identifies one immutable form context. Explicit refresh creates a new one.
  const [context] = useState(() => props);
  const { offers, program, commandId, refreshHref, appointment, staff, rebook, clinicOnly } = context;
  const { locale, action } = props;
  const modes = (['home', 'clinic'] as const).filter(mode => offers.some(offer => offer.mode === mode));
  const [mode, setMode] = useState<'home' | 'clinic' | ''>(modes.length === 1 ? modes[0] : '');
  const providers = (value: string) => offers.filter((offer, i) => offer.mode === value && offers.findIndex(candidate => locationKey(candidate) === locationKey(offer)) === i);
  const [location, setLocation] = useState(() => modes.length === 1 && providers(modes[0]).length === 1 ? locationKey(providers(modes[0])[0]) : "");
  const [date, setDate] = useState("");
  const [offerId, setOfferId] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [agreement, setAgreement] = useState("");
  const [state, setState] = useState<PilotActionState>({ ok: false });
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const recorded = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = !!(state.commandRecorded || state.outcomeUnknown || state.ok || ['pending', 'saved', 'unknown', 'conflict', 'unavailable', 'tests-changed'].includes(state.code ?? ''));
  const selected = offers.find(offer => offer.id === offerId);
  const locations = mode ? providers(mode) : [];
  function chooseMode(value: 'home' | 'clinic') { setMode(value); const only = providers(value); setLocation(only.length === 1 ? locationKey(only[0]) : ''); setDate(''); setOfferId(''); }
  const localOffers = offers.filter(offer => locationKey(offer) === location);
  const dates = [...new Set(localOffers.map(offer => day(offer.startsAt)))].sort();
  const visibleOffers = localOffers.filter(offer => day(offer.startsAt) === date);
  const disabled = busy || locked;
  const ready = !!selected && (selected.mode !== 'home' || !!homeAddress.trim()) && (!staff || !!agreement.trim());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || recorded.current || !ready || locked || !selected) return;
    sending.current = true;
    setBusy(true);
    const form = new FormData();
    form.set('commandId', commandId);
    form.set('offerId', selected.id);
    form.set('offerVersion', selected.version);
    form.set('suggestedSetFingerprint', JSON.stringify(program.map(t => t.id)));
    form.set('homeAddress', selected.mode === 'home' ? homeAddress : '');
    if (appointment) {
      form.set('appointmentId', appointment.id);
      form.set('revision', String(appointment.revision));
      form.set('agreementSource', staff ? agreement : '');
    }
    let result: PilotActionState;
    try { result = await action(state, form); }
    catch { result = { ok: false, code: 'unknown', outcomeUnknown: true }; }
    // Guard synchronously as well as in the rendered button, including duplicate submit events.
    recorded.current = !!(result.commandRecorded || result.outcomeUnknown || result.ok || ['pending', 'saved', 'unknown', 'conflict', 'unavailable', 'tests-changed'].includes(result.code ?? ''));
    sending.current = false;
    if (!mounted.current) return;
    setState(result);
    setBusy(false);
  }
  const message = state.outcomeUnknown || state.code === 'unknown'
    ? t(locale, "The booking result is unknown. Your entries are still here. Check the saved booking before continuing.", "Գրանցման արդյունքն անհայտ է։ Ձեր մուտքագրած տվյալները դեռ այստեղ են։ Շարունակելուց առաջ ստուգեք պահպանված այցը։", "Результат записи неизвестен. Введённые данные остаются здесь. Прежде чем продолжить, проверьте сохранённую запись.")
    : state.code === 'tests-changed'
      ? t(locale, "Your test list changed. Refresh to see the new list and total before booking.", "Ձեր հետազոտությունների ցանկը փոխվել է։ Թարմացրեք էջը՝ նոր ցանկն ու ընդհանուր գումարը տեսնելու համար, ապա գրանցեք այցը։", "Ваш список исследований изменился. Обновите страницу, чтобы увидеть новый список и общую стоимость перед записью.")
    : state.code === 'arrangement-review'
      ? t(locale,"An email-service receipt is saved, but the arrangement needs review. Check the saved visit before continuing.","Նամակի ծառայության անդորրագիրը պահպանված է, սակայն պայմանավորվածությունը պետք է վերանայել։ Շարունակելուց առաջ ստուգեք պահպանված այցը։", "Подтверждение от почтовой службы сохранено, но договорённость требует проверки. Прежде чем продолжить, проверьте сохранённый визит.")
    : state.code === 'invalid'
      ? t(locale, "Check your choices and address. Your entries are still here.", "Ստուգեք ընտրություններն ու հասցեն։ Ձեր մուտքագրած տվյալները դեռ այստեղ են։", "Проверьте выбранные варианты и адрес. Введённые данные остаются здесь.")
      : state.code === 'conflict'
        ? t(locale, "The saved booking or choices changed. Check the latest details before continuing.", "Պահպանված այցը կամ տարբերակները փոխվել են։ Շարունակելուց առաջ ստուգեք վերջին տվյալները։", "Сохранённая запись или доступные варианты изменились. Прежде чем продолжить, проверьте актуальные данные.")
        : state.code === 'failed'
          ? t(locale, "The booking could not be completed. Check the saved status before another attempt.", "Չհաջողվեց ավարտել գրանցումը։ Նոր փորձից առաջ ստուգեք պահպանված վիճակը։", "Не удалось завершить запись. Перед новой попыткой проверьте сохранённый статус.")
          : state.code === 'unavailable'
            ? t(locale, "Booking is unavailable. Check saved details and current choices.", "Գրանցումն անհասանելի է։ Ստուգեք պահպանված տվյալներն ու ընթացիկ տարբերակները։", "Запись недоступна. Проверьте сохранённые данные и доступные варианты.")
            : state.commandRecorded || state.ok || state.code === 'pending' || state.code === 'saved'
              ? t(locale, "Your request is recorded. Check its saved status for the result.", "Ձեր հարցումը գրանցված է։ Արդյունքը տեսնելու համար ստուգեք պահպանված վիճակը։", "Ваша заявка зарегистрирована. Проверьте её сохранённый статус, чтобы узнать результат.")
              : '';
  return <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
    <fieldset disabled={disabled} className="space-y-4">
      {clinicOnly ? <legend className="mb-3 text-body2 font-medium">{t(locale, "Choose a clinic time", "Ընտրեք ժամ կլինիկայում", "Выбрать время в клинике")}</legend> : <legend className="mb-3 flex items-center gap-2 text-h3"><CalendarDays aria-hidden className="size-5 shrink-0 text-brand-navy" />{t(locale, appointment && !rebook ? "Choose a new visit" : "Choose a visit", appointment && !rebook ? "Ընտրել նոր այց" : "Ընտրել այց", appointment && !rebook ? "Выбрать новый визит" : "Выбрать визит")}</legend>}
      {!clinicOnly && <fieldset><legend className="mb-2 text-body2 font-medium">{t(locale, "Where should the visit happen?", "Որտե՞ղ անցկացնել այցը", "Где должен состояться визит?")}</legend><div className="grid gap-2 sm:grid-cols-2">{modes.map(value => <label key={value} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="radio" name="visitMode" value={value} checked={mode === value} disabled={disabled} onChange={() => chooseMode(value)} className="mt-0.5 size-4 shrink-0 accent-primary" required /><span><span className="block font-medium">{value === 'home' ? t(locale, "Home visit", "Այց տանը", "Визит на дом") : t(locale, "At a clinic", "Կլինիկայում", "В клинике")}</span><span className="block text-caption text-muted-foreground">{value === 'home' ? t(locale, "A nurse comes to your address.", "Բուժքույրը կգա ձեր հասցեով։", "Медсестра приедет по вашему адресу.") : t(locale, "You go to the clinic.", "Դուք կայցելեք կլինիկա։", "Вам нужно приехать в клинику.")}</span></span></label>)}</div></fieldset>}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode && locations.length > 1 && <label className="block space-y-2 text-body2"><span className="font-medium">{mode === 'home' ? t(locale, "Nurse service", "Բուժքրոջ ծառայություն", "Служба выезда медсестёр") : t(locale, "Clinic", "Կլինիկա", "Клиника")}</span><select name="visitLocation" value={location} disabled={disabled} onChange={event => { setLocation(event.target.value); setDate(''); setOfferId(''); }} className={bookingControl} required><option value="">{t(locale, "Choose", "Ընտրել", "Выбрать")}</option>{locations.map(offer => <option key={locationKey(offer)} value={locationKey(offer)}>{offer.clinicName}</option>)}</select></label>}
        {mode === 'clinic' && location && !selected && localOffers[0] && <p className="flex items-start gap-2 break-words text-body2 sm:col-span-2"><MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /><span><span className="block font-medium">{localOffers[0].clinicName}</span>{localOffers[0].clinicAddress && <span className="block text-muted-foreground">{localOffers[0].clinicAddress}</span>}</span></p>}
        <label className="block space-y-2 text-body2"><span className="font-medium">{t(locale, "Date", "Ամսաթիվ", "Дата")}</span><select name="visitDate" value={date} disabled={disabled || !location} onChange={event => { setDate(event.target.value); setOfferId(''); }} className={bookingControl} required><option value="">{t(locale, "Choose an offered date", "Ընտրել առաջարկվող օրը", "Выберите доступную дату")}</option>{dates.map(value => <option key={value} value={value}>{bookingDateText(localOffers.find(offer => day(offer.startsAt) === value)!.startsAt, locale)}</option>)}</select></label>
      </div>
      {date && <fieldset><legend className="mb-2 text-body2 font-medium">{t(locale, "Offered times (UTC+4)", "Առաջարկվող ժամերը (UTC+4)", "Доступное время (UTC+4)")}</legend><div className="grid gap-2 sm:grid-cols-2">{visibleOffers.map(offer => <label key={offer.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-3 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="radio" name="offerId" value={offer.id} checked={offerId === offer.id} disabled={disabled} onChange={() => setOfferId(offer.id)} className="size-4 shrink-0 accent-primary" required /><span>{bookingTimeText(offer.startsAt, locale)}–{bookingTimeText(offer.endsAt, locale)}</span></label>)}</div></fieldset>}
      {selected && <div className="space-y-3 border-l-2 border-brand-navy pl-4"><p className="font-medium text-body2">{selected.clinicName}</p><p className="flex items-start gap-2 text-body2"><MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /><span className="break-words">{selected.mode === 'home' ? t(locale, "Home visit", "Այց տանը", "Визит на дом") : selected.clinicAddress}</span></p><p className="text-caption text-muted-foreground">{termsText({ ...selected, location: selected.clinicAddress ?? '' }, locale)} (UTC+4)</p><BookingCoverage arrangement={selected} program={program} locale={locale} /></div>}
      {selected?.mode === 'home' && <label className="block space-y-2 text-body2"><span className="font-medium">{t(locale, "Home visit address", "Տնային այցի հասցեն", "Адрес визита на дом")}</span><textarea name="homeAddress" value={homeAddress} onChange={event => setHomeAddress(event.target.value)} disabled={disabled} required maxLength={1000} rows={3} className={bookingControl} /></label>}
      {staff && <label className="block space-y-2 text-body2"><span className="font-medium">{t(locale, "Member agreement", "Անդամի համաձայնությունը", "Согласие участника")}</span><p className="text-caption text-muted-foreground">{t(locale, "Record how and when the member agreed to this change.", "Նշեք՝ անդամը ինչպես և երբ է համաձայնել փոփոխությանը։", "Укажите, как и когда участник согласился на это изменение.")}</p><textarea name="agreementSource" value={agreement} onChange={event => setAgreement(event.target.value)} disabled={disabled} required maxLength={1000} rows={2} className={bookingControl} /></label>}
    </fieldset>
    {message && <p role={state.ok || state.commandRecorded ? 'status' : 'alert'} className="text-body2">{message}</p>}
    {locked && <div className="space-y-3"><p className="text-caption text-muted-foreground">{t(locale, "Opening saved details replaces this form. Keep a note of unfinished entries first.", "Պահպանված տվյալները բացելիս այս ձևը կփոխարինվի։ Նախ պահեք ձեր անավարտ գրառումները։", "При открытии сохранённых данных эта форма будет заменена. Сначала сохраните незавершённые записи отдельно.")}</p><BookingRecovery href={refreshHref} locale={locale} /></div>}
    <p className="text-caption text-muted-foreground">{(selected ? selected.source === 'clinic-hours' : offers.every(offer => offer.source === 'clinic-hours')) ? (staff ? t(locale, "The clinic sees the change in its portal and confirms it.", "Կլինիկան փոփոխությունը տեսնում է իր համակարգում և հաստատում է այն։", "Клиника увидит изменение в своём портале и подтвердит его.") : t(locale, "We send your request to the clinic. Your visit is booked once the clinic confirms it.", "Մենք ձեր հարցումն ուղարկում ենք կլինիկային։ Այցը գրանցված է, երբ կլինիկան հաստատի այն։", "Мы отправим вашу заявку в клинику. Визит будет записан после подтверждения клиникой.")) : staff ? t(locale, "The clinic is emailed about the change, with Noreon copied.", "Կլինիկային նամակ կուղարկվի փոփոխության մասին՝ Noreon-ին պատճենով։", "Мы отправим клинике письмо об изменении с копией для Noreon.") : t(locale, "We email the clinic to arrange your visit, with Noreon copied. Your visit is booked once that email is sent.", "Մենք նամակ ենք ուղարկում կլինիկային՝ Noreon-ին պատճենով, ձեր այցը կազմակերպելու համար։ Այցը գրանցված է, երբ նամակն ուղարկվի։", "Мы отправим клинике письмо для организации вашего визита с копией для Noreon. Визит будет записан после отправки письма.")}</p>
    <button type="submit" disabled={disabled || !ready} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"><CalendarDays aria-hidden className="size-4 shrink-0" />{busy ? t(locale, "Recording…", "Գրանցվում է…", "Сохраняем…") : t(locale, appointment && !rebook ? "Record visit change" : "Book this visit", appointment && !rebook ? "Գրանցել այցի փոփոխությունը" : "Գրանցել այս այցը", appointment && !rebook ? "Записать изменение визита" : "Записаться на этот визит")}</button>
  </form>;
}
/** Clinic scheduling on and email off: a clinic visit is booked by slot, a home visit is a request a Noreon admin
 * arranges. Both are offered up front with equal weight; only the home visit asks for an address. */
function VisitChoice({ locale, clinic, home }: { locale: BookingLocale; clinic: React.ReactNode; home: React.ReactNode }) {
  const [choice, setChoice] = useState<'clinic' | 'home' | ''>('');
  const choiceName = useId();
  const options = [
    { value: 'clinic' as const, Icon: Building2, label: t(locale, "At a clinic", "Կլինիկայում", "В клинике"), detail: t(locale, "Pick a time slot and go to the clinic.", "Ընտրեք ազատ ժամ և այցելեք կլինիկա։", "Выберите время и приезжайте в клинику.") },
    { value: 'home' as const, Icon: House, label: t(locale, "Home visit", "Այց տանը", "Визит на дом"), detail: t(locale, "A nurse comes to you. Send your preferred times and Noreon arranges the visit.", "Բուժքույրը կգա ձեզ մոտ։ Ուղարկեք նախընտրելի ժամերը, և Noreon-ը կկազմակերպի այցը։", "Медсестра приедет к вам. Отправьте удобное время, и Noreon организует визит.") },
  ];
  return <div className="space-y-5" data-visit-choice>
    <fieldset><legend className="mb-3 flex items-center gap-2 text-h3"><CalendarDays aria-hidden className="size-5 shrink-0 text-brand-navy" />{t(locale, "Where should the visit happen?", "Որտե՞ղ անցկացնել այցը", "Где должен состояться визит?")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{options.map(({ value, Icon, label, detail }) => <label key={value} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-4 py-4 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="radio" name={`visitChoice-${choiceName}`} data-visit-choice value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 size-4 shrink-0 accent-primary" /><Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-navy" /><span><span className="block font-medium">{label}</span><span className="block text-caption text-muted-foreground">{detail}</span></span></label>)}</div>
    </fieldset>
    {choice === 'clinic' && clinic}
    {choice === 'home' && home}
  </div>;
}
export function PilotSelectionForm(props: SelectionProps) { return <SelectionSession key={`${props.commandId}:${props.appointment?.id ?? 'new'}:${props.appointment?.revision ?? -1}`} {...props} />; }
export function PilotMemberBooking({ journeyIndex, data, locale, commandId, changeCommandIds, cancelCommandIds, proposalCommandIds, selectAction, changeAction, cancelAction, proposalAction, refreshHref, pricing, homeRequestOpen = false, homeVisit, doneTestIds = [] }: { journeyIndex?: number; homeRequestOpen?: boolean; doneTestIds?: readonly string[]; homeVisit?: React.ReactNode; data: PilotBookingData; locale: BookingLocale; commandId: string; changeCommandIds: Record<string, string>; cancelCommandIds?: Record<string, string>; proposalCommandIds?: Record<string, string>; selectAction: PilotFormAction; changeAction: PilotFormAction; cancelAction?: PilotFormAction; proposalAction?: PilotFormAction; refreshHref: string; pricing?: MemberPricing }) {
  const homeHeading = useId();
  const offered = data.available && data.offers.length > 0;
  // WP-5: an earlier programme's attended or past visit is history; it neither blocks a new booking
  // nor marks today's tests booked.
  const current = programmeVisits(data.appointments);
  const bookNew = canBookNewVisit(data.appointments);
  // The up-front clinic or home choice replaces the slot form while nothing is booked yet.
  // QA 176: a test whose visit took place (a completed home visit, an attended clinic visit) is done:
  // no price, no new booking choice for it. When every test is done, the page says so instead.
  const states = testStates(data.program, current, doneTestIds);
  const toArrange = data.program.filter(item => item.method !== "home-log" && states.get(item.id) !== "done");
  const allDone = data.program.some(item => item.method !== "home-log") && toArrange.length === 0;
  const choosing = !!homeVisit && data.available && data.program.length > 0 && bookNew && !allDone;
  const clinicOffers = data.offers.filter(offer => offer.mode === 'clinic');
  return <div className="w-full space-y-5"><header><h1 className="text-h1">{t(locale, "Arrange your visit", "Կազմակերպել ձեր այցը", "Организовать ваш визит")}</h1></header>
    <BookingJourney appointments={current} current={journeyIndex} locale={locale} />
    {(data.program.length > 0 || data.appointments.length > 0) && <BookingTests program={data.program.length ? data.program : (data.appointments.find(a => a.status !== 'cancelled') ?? data.appointments[0]).currentProgram ?? (data.appointments.find(a => a.status !== 'cancelled') ?? data.appointments[0]).program} appointments={current} locale={locale} offered={data.available && data.offers.length > 0} homeRequest={homeRequestOpen || data.unavailableReason === 'legacy-reconciliation'} doneTestIds={doneTestIds} />}
    {pricing && toArrange.length > 0 && !homeRequestOpen && !current.some(appointment => appointment.status !== "cancelled") && <TestPrices items={toArrange} pricing={pricing} locale={locale} />}
    {data.appointments.map(appointment => {
      const settledVisit = !!appointment.current && (appointment.status === 'confirmed' || appointment.status === 'failed') && appointment.noticePurpose !== 'cancellation';
      // B1: a change stays with the same clinic; another clinic means cancel and book again.
      const sameClinic = data.offers.filter(offer => offer.clinicId === appointment.current?.clinicId);
      // QA F-03: once the clinic has recorded the arrival or the results, the visit is settled; a no-show stays open.
      const checkedIn = visitAttended(appointment);
      const reschedule = offered && !checkedIn && sameClinic.length > 0 && data.canChange && appointment.status === 'confirmed' && changeCommandIds[appointment.id];
      const rebook = offered && appointment.status === 'cancelled' && countsForProgramme(appointment) && changeCommandIds[appointment.id];
      // Clinic-portal visits are cancelled in the portal; a request the clinic has not answered can be withdrawn.
      const portal = appointment.portal?.channel === 'portal';
      const withdraw = portal && appointment.status === 'notification-pending' && !appointment.current && appointment.noticePurpose !== 'cancellation';
      const cancel = cancelAction && cancelCommandIds?.[appointment.id] && !checkedIn && ((portal ? settledVisit && appointment.status === 'confirmed' : data.canCancel && settledVisit) || withdraw);
      const proposal = proposalAction && proposalCommandIds?.[appointment.id] && !checkedIn && appointment.portal?.proposal;
      // A clinic's proposed time comes first: it waits on the member.
      return <div key={appointment.id} data-visit-card className="journey-card w-full space-y-4">{proposal && <ClinicProposal appointment={appointment} commandId={proposalCommandIds![appointment.id]} action={proposalAction!} locale={locale} refreshHref={refreshHref} />}{appointment.status !== 'cancelled' && <VisitActor appointment={appointment} locale={locale} />}<AppointmentStatus appointment={appointment} locale={locale} clinics={data.clinics} hideStatus={!!proposal} />
        {pricing && (paymentFor(pricing, "appointment", appointment.id) ? <MemberPaymentStatus payment={paymentFor(pricing, "appointment", appointment.id)} locale={locale} /> : appointment.status !== "cancelled" && <TestPrices items={(appointment.currentProgram ?? appointment.program).filter(item => item.method !== "home-log")} pricing={pricing} locale={locale} />)}
        {reschedule && <details className="border-t border-border"><summary className="min-h-12 cursor-pointer py-3 text-body2 font-medium text-brand-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t(locale, "Change time", "Փոխել ժամը", "Изменить время")}</summary><p className="pb-3 text-caption text-muted-foreground">{t(locale, "You can move this visit to another time with the same clinic. To change clinic, cancel this visit and book again.", "Կարող եք այցը տեղափոխել նույն կլինիկայի մեկ այլ ժամի։ Կլինիկան փոխելու համար չեղարկեք այս այցը և նորից գրանցվեք։", "Можно перенести визит на другое время в той же клинике. Чтобы сменить клинику, отмените этот визит и запишитесь снова.")}</p><PilotSelectionForm offers={sameClinic} program={data.program.length ? data.program : appointment.program} locale={locale} commandId={changeCommandIds[appointment.id]} appointment={appointment} action={changeAction} refreshHref={refreshHref} /></details>}
        {cancel && <CancelVisit appointment={appointment} commandId={cancelCommandIds![appointment.id]} action={cancelAction!} locale={locale} refreshHref={refreshHref} portal={portal} withdraw={withdraw} />}
        {rebook && <PilotSelectionForm offers={data.offers} program={data.program.length ? data.program : appointment.program} locale={locale} commandId={changeCommandIds[appointment.id]} appointment={appointment} action={changeAction} refreshHref={refreshHref} rebook />}
        {/* QA N-04: a settled card has nothing to refresh; only a card waiting on the clinic offers it. */}
        {!reschedule && !cancel && !rebook && !proposal && ['notification-pending', 'unknown', 'reconciliation'].includes(appointment.status) && <BookingRecovery href={refreshHref} locale={locale} />}
      </div>;
    })}
    {allDone && !homeRequestOpen ? <p role="status" data-visit-done className="journey-card w-full text-body2">{t(locale, "Your visit is done. Your results are with your doctor.", "Ձեր այցն ավարտված է։ Ձեր արդյունքները ձեր բժշկի մոտ են։", "Ваш визит завершён. Ваши результаты у вашего врача.")}</p>
    : !data.available && homeRequestOpen && data.unavailableReason === 'legacy-reconciliation' ? <p role="status" className="text-body2 text-muted-foreground">{t(locale, "You have a home visit request below. To book a clinic visit instead, cancel that request first.", "Ստորև ունեք տնային այցի հարցում։ Կլինիկայում այց գրանցելու համար նախ չեղարկեք այդ հարցումը։", "Ниже есть ваша заявка на визит на дом. Чтобы записаться в клинику, сначала отмените эту заявку.")}</p> : !data.available ? <BookingUnavailable data={data} locale={locale} refreshHref={refreshHref} /> : !data.program.length ? <p role="status" className="text-body2 text-muted-foreground">{t(locale, "There is no assigned program to arrange.", "Այց կազմակերպելու համար նշանակված ծրագիր չկա։", "Нет назначенной программы для организации визита.")}</p> : homeVisit && bookNew ? <VisitChoice locale={locale} home={homeVisit} clinic={clinicOffers.length ? <PilotSelectionForm offers={clinicOffers} program={data.program} locale={locale} commandId={commandId} action={selectAction} refreshHref={refreshHref} clinicOnly /> : <div className="space-y-3"><p role="status" className="text-body2 text-muted-foreground">{t(locale, "No clinic times are currently offered. You can ask for a home visit instead.", "Այժմ կլինիկայում ազատ ժամեր չկան։ Փոխարենը կարող եք խնդրել այց տանը։", "Сейчас в клиниках нет доступного времени. Можно запросить визит на дом.")}</p><BookingRecovery href={refreshHref} locale={locale} /></div>} />
    : !data.offers.length ? <div className="space-y-3"><p role="status" className="text-body2 text-muted-foreground">{t(locale, "No visit times are currently offered.", "Այժմ այցի ժամեր առաջարկված չեն։", "Сейчас нет доступного времени для визитов.")}</p><BookingRecovery href={refreshHref} locale={locale} /></div> : bookNew ? <PilotSelectionForm offers={data.offers} program={data.program} locale={locale} commandId={commandId} action={selectAction} refreshHref={refreshHref} /> : null}
    {homeVisit && !choosing && !allDone && <section aria-labelledby={homeHeading} className="journey-card w-full space-y-3"><h2 id={homeHeading} className="text-h3">{t(locale, "Prefer a home visit?", "Նախընտրո՞ւմ եք այց տանը", "Предпочитаете визит на дом?")}</h2><p className="text-body2 text-muted-foreground">{t(locale, "A nurse comes to your address. Send your preferred time and Noreon arranges the visit with you.", "Բուժքույրը կգա ձեր հասցեով։ Ուղարկեք նախընտրելի ժամը, և Noreon-ը ձեզ հետ կկազմակերպի այցը։", "Медсестра приедет по вашему адресу. Отправьте удобное время, и Noreon согласует с вами визит.")}</p>{homeVisit}</section>}
  </div>;
}
