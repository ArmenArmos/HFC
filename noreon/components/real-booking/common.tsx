"use client";

import { memberInstruction } from "@/lib/text-language";
import { createContext, useActionState, useContext, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useBookingRefresh } from "./recovery-context";
import type { BookingFormState, BookingRequest, BookingPreference } from "@/lib/real-booking/schema";
export { testTitle } from "@/lib/patient/catalogue-label";
import { termsText, bookingTimestampText, bookingLocationText } from "@/lib/real-booking/display-time";
export { termsText } from "@/lib/real-booking/display-time";

import { pick, type Locale } from "@/lib/locale";
export type { Locale } from "@/lib/locale";
export const choose = (locale: Locale, en: string, hy: string, ru: string) => pick(locale, { en, hy, ru });
export const fieldClass = "min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-body2";
export function localTime(value: string) { return new Date(Date.parse(value) + 4 * 3600000).toISOString().slice(0, 16); }
export type Audience = "member" | "staff";
export function PreferredArrangement({ terms, locale, collapsed, audience = "member" }: { terms: BookingPreference; locale: Locale; collapsed: boolean; audience?: Audience }) {
  const content = <div className="space-y-1"><p className="text-body2">{termsText(terms, locale)} (UTC+4)</p><p className="break-words text-body2">{bookingLocationText(terms.mode, locale)} · {audience === "staff" ? terms.location : memberInstruction(terms.location, locale)}</p></div>;
  return collapsed ? <details><summary className="min-h-11 cursor-pointer py-2 text-body2">{choose(locale, "Original preference", "Սկզբնական նախընտրությունը", "Исходное предпочтение")}</summary>{content}</details> : <div className="space-y-1"><p className="text-caption text-muted-foreground">{audience === "staff" ? choose(locale, "Member’s preferred date and time", "Անդամի նախընտրելի ամսաթիվն ու ժամը", "Предпочтительные дата и время участника") : choose(locale, "Your preferred date and time", "Ձեր նախընտրելի ամսաթիվն ու ժամը", "Предпочтительные дата и время")}</p>{content}</div>;
}
export function statusText(status: BookingRequest["status"], locale: Locale, audience: Audience = "member") {
  if (audience === "staff" && status === "provider-proposed") return choose(locale, "Member acceptance needed", "Անհրաժեշտ է անդամի համաձայնությունը", "Требуется согласие участника");
  if (audience === "staff" && status === "completed") return choose(locale, "Completed: the nurse recorded the visit", "Ավարտված է. բուժքույրը գրանցել է այցը", "Завершено: медсестра зарегистрировала визит");
  const labels = { requested: ["Requested", "Հարցումն ուղարկված է", "Запрошено"], "provider-proposed": ["Your acceptance needed", "Անհրաժեշտ է Ձեր համաձայնությունը", "Требуется ваше согласие"], confirmed: ["Confirmed", "Հաստատված է", "Подтверждено"], "change-pending": ["Provider response pending", "Սպասում է ծառայություն մատուցողի պատասխանին", "Ожидается ответ поставщика услуг"], cancelled: ["Cancelled", "Չեղարկված է", "Отменено"], completed: ["Visit done", "Այցը կայացել է", "Визит состоялся"] };
  return labels[status][locale === "ru" ? 2 : locale === "hy" ? 1 : 0];
}
// Saving refreshes the page and remounts revision-keyed forms, so success is announced above them.
const SavedNotice = createContext<((message: string) => void) | null>(null);
export function BookingNotices({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState("");
  return <SavedNotice.Provider value={setNotice}><p role="status" className={notice ? "border-l-2 border-primary pl-4 text-body2" : "sr-only"}>{notice}</p>{children}</SavedNotice.Provider>;
}
// QA F-05: a member's saved command says what happened, not "check its status".
const SAVED: Record<string, [string, string, string]> = {
  create: ["Your request is sent. You will see the confirmed details here.", "Ձեր հարցումն ուղարկված է։ Հաստատված մանրամասները կտեսնեք այստեղ։", "Ваш запрос отправлен. Подтверждённые данные появятся здесь."],
  accept: ["Done. You accepted the visit details.", "Պատրաստ է։ Դուք ընդունեցիք այցի մանրամասները։", "Готово. Вы приняли условия визита."],
  cancel: ["Your cancellation is saved. You can see its status above.", "Ձեր չեղարկումը պահպանված է։ Կարգավիճակը տեսեք վերևում։", "Отмена сохранена. Её статус можно увидеть выше."],
  "request-change": ["Your change request is sent. You can see its status above.", "Փոփոխության ձեր հարցումն ուղարկված է։ Կարգավիճակը տեսեք վերևում։", "Запрос на изменение отправлен. Его статус можно увидеть выше."],
};
// A cancel that still needs the provider keeps the server wording (it is only requested).
const savedText = (operation: string, locale: Locale) => SAVED[operation]?.[locale === "ru" ? 2 : locale === "hy" ? 1 : 0];
export function BookingForm({ action, children, label, locale = "en", request, operation, disabled = false }: {
  action: (state: BookingFormState, form: FormData) => Promise<BookingFormState>; children?: React.ReactNode; label: string; locale?: Locale; request?: BookingRequest; operation: string; disabled?: boolean;
}) {
  const router = useRouter();
  const refreshInChat = useBookingRefresh();
  const announce = useContext(SavedNotice);
  const commandId = useRef<string | null>(null);
  const [state, submit, pending] = useActionState(async (previous: BookingFormState, form: FormData): Promise<BookingFormState & {messageRu?: string}> => {
    announce?.("");
    const invalid = (en: string, hy: string, ru: string): BookingFormState & {messageRu: string} => ({ok: false, code: "invalid", message: en, messageHy: hy, messageRu: ru});
    const memberPreference = ["create", "request-change"].includes(String(form.get("operation")));
    if (memberPreference) {
      const start = String(form.get("startsAt") ?? "");
      const parse = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ? Date.parse(`${value}+04:00`) : NaN;
      const startsAt = parse(start);
      if (!Number.isFinite(startsAt)) return invalid("Choose a valid preferred arrival start date and time.", "Ընտրեք նախընտրելի ժամի սկզբի վավեր ամսաթիվն ու ժամը։", "Выберите допустимые предпочтительные дату и время начала прибытия.");
      if (startsAt <= Date.now()) return {ok: false, code: "past-time", message: "Choose a future preferred date and time."};
      form.delete("endsAt");
      const mode = form.get("mode"), location = String(form.get("location") ?? "").trim();
      if (mode !== "clinic" && mode !== "home" && mode !== "office") return invalid("Choose a clinic, home or office preference.", "Ընտրեք կլինիկայի, տան կամ աշխատավայրի տարբերակը։", "Выберите клинику, дом или офис.");
      if (location.length < 3 || location.length > 1000) return mode === "office" ? invalid("Enter your office address, between 3 and 1,000 characters.", "Մուտքագրեք աշխատավայրի հասցեն՝ 3-ից 1000 նիշ։", "Введите адрес офиса, от 3 до 1,000 символов.") : mode === "home" ? invalid("Enter your home address, between 3 and 1,000 characters.", "Մուտքագրեք տան հասցեն՝ 3-ից 1000 նիշ։", "Введите домашний адрес, от 3 до 1,000 символов.") : invalid("Choose a preferred clinic or enter its name, between 3 and 1,000 characters.", "Ընտրեք նախընտրելի կլինիկան կամ մուտքագրեք դրա անունը՝ 3-ից 1000 նիշ։", "Выберите предпочтительную клинику или введите её название, от 3 до 1,000 символов.");
    }
    for (const key of ["startsAt", "endsAt", "obtainedAt"]) {
      const value = form.get(key);
      if (typeof value === "string" && value) form.set(key, new Date(`${value}+04:00`).toISOString());
    }
    if (operation === "cancel" && !form.has("confirmCancel")) return invalid("Confirm that you want to cancel this request.","Հաստատեք, որ ցանկանում եք չեղարկել այս հարցումը։","Подтвердите отмену этой заявки.");
    const response = await action(previous, form);
    if (response.ok) {
      announce?.((response.providerPending ? null : savedText(operation, locale)) ?? choose(locale, response.message, response.messageHy ?? "Հարցումը պահպանվել է։ Ստուգեք ընթացիկ կարգավիճակը։", "Запрос сохранён. Проверьте текущий статус."));
      if (!refreshInChat) router.refresh();
    }
    return response;
  }, { ok: false, message: "" });
  const message = state.outcomeUnknown ? choose(locale, "The result is unknown. Do not send again. Check current details before another action.", "Արդյունքն անհայտ է։ Կրկին մի ուղարկեք։ Նոր գործողությունից առաջ ստուգեք ընթացիկ տվյալները։", "Результат неизвестен. Не отправляйте повторно. Перед следующим действием проверьте актуальные данные.") : state.ok && !state.providerPending && savedText(operation, locale) ? savedText(operation, locale) : choose(locale, state.message, state.ok ? state.messageHy ?? "Հարցումը պահպանվել է։ Ստուգեք ընթացիկ կարգավիճակը։" : state.code === "conflict" ? "Հարցումը կամ տվյալները փոխվել են։ Թարմացրեք էջը և կրկին ստուգեք։" : state.code === "clinical-hold" ? "Հետազոտության հարցումը կասեցված է։ Ստուգեք առողջության ցուցումները և կապվեք Նորեոն Հելթի թիմի հետ։" : state.code === "provider-action" ? "Ստուգեք գրանցված պայմանավորվածությունը․ անհրաժեշտ է ծառայություն մատուցողի հետ ճշտում, ոչ թե կրկնակի հարցում։" : state.code === "past-time" ? "Ընտրեք ապագա ժամային միջակայք։" : state.code === "invalid" ? state.messageHy ?? "Ստուգեք ժամը, հասցեն և պարտադիր դաշտերը։" : "Հարցումը չի պահպանվել։ Թարմացրեք էջը և կրկին փորձեք։", state.ok ? "Запрос сохранён. Проверьте текущий статус." : state.code === "conflict" ? "Запрос или данные изменились. Обновите страницу и проверьте снова." : state.code === "clinical-hold" ? "Запрос на анализы приостановлен. Проверьте рекомендации по здоровью и свяжитесь с командой Нореон Хелс." : state.code === "provider-action" ? "Проверьте зарегистрированную договорённость: требуется уточнение у поставщика услуг, а не повторный запрос." : state.code === "past-time" ? "Выберите будущий интервал времени." : state.code === "invalid" ? state.messageRu ?? "Проверьте время, адрес и обязательные поля." : "Запрос не сохранён. Обновите страницу и попробуйте снова.");
  return <form noValidate={["create", "request-change"].includes(operation)} action={submit} onReset={event => event.preventDefault()} className="space-y-4">
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="commandId" ref={node => { if (node) node.value = commandId.current ??= crypto.randomUUID(); }} />
    {request && <><input type="hidden" name="id" value={request.id} /><input type="hidden" name="revision" value={request.revision} /><input type="hidden" name="algorithmVersion" value={request.algorithmVersion} /></>}
    <fieldset disabled={pending || state.ok || !!state.outcomeUnknown} className="min-w-0 space-y-4">{children}<Button type="submit" disabled={disabled} className="min-h-11 max-w-full whitespace-normal px-4">{pending ? choose(locale, "Saving…", "Պահպանվում է…", "Сохраняется…") : label}</Button></fieldset>
    {state.message && !(state.ok && announce) && <p role={state.ok ? "status" : "alert"} className={`text-body2 ${state.ok ? "" : "text-destructive"}`}>{message}</p>}
    {!state.ok && state.message && <Button type="button" variant="outline" className="min-h-11" onClick={() => { if (refreshInChat) refreshInChat(); else if (state.outcomeUnknown) window.location.reload(); else router.refresh(); }}>{choose(locale, "Reload current status", "Թարմացնել կարգավիճակը", "Обновить текущий статус")}</Button>}
  </form>;
}
export function TermsFields({ terms, locale = "en", actual = false, clinics, homeOnly = false }: { terms?: BookingPreference; locale?: Locale; actual?: boolean; clinics?: {id: string; name: string; address: string}[]; homeOnly?: boolean }) {
  const [mode, setMode] = useState(homeOnly ? "home" : terms?.mode ?? "clinic");
  const [homeAddress, setHomeAddress] = useState(terms?.mode === "home" ? terms.location : "");
  const [officeAddress, setOfficeAddress] = useState(terms?.mode === "office" ? terms.location : "");
  const [clinicName, setClinicName] = useState(terms?.mode === "clinic" ? terms.location : "");
  const choices = clinics && terms?.mode === "clinic" && !clinics.some(clinic => clinic.name === terms.location || `${clinic.name} · ${clinic.address}` === terms.location) ? [{id: "recorded-preference", name: terms.location, address: ""}, ...clinics] : clinics;
  const [clinicId, setClinicId] = useState(choices?.find(clinic => clinic.name === terms?.location || `${clinic.name} · ${clinic.address}` === terms?.location)?.id ?? choices?.[0]?.id ?? "");
  const clinic = choices?.find(clinic => clinic.id === clinicId);
  return <>
    <p className="text-caption text-muted-foreground">{choose(locale, "All times are in Yerevan (UTC+4).", "Բոլոր ժամերը Երևանի ժամային գոտում են (UTC+4)։", "Всё время указано по Еревану (UTC+4).")}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1 text-body2"><span>{actual ? choose(locale, "Provider arrival window start", "Ծառայություն մատուցողի ժամանման միջակայքի սկիզբ", "Начало интервала прибытия поставщика услуг") : choose(locale, "Preferred date and time", "Նախընտրելի ամսաթիվ և ժամ", "Предпочтительные дата и время")}</span><input className={fieldClass} required type="datetime-local" name="startsAt" defaultValue={terms ? localTime(terms.startsAt) : undefined} /></label>
      {actual && <label className="min-w-0 space-y-1 text-body2"><span>{actual ? choose(locale, "Provider arrival window end", "Ծառայություն մատուցողի ժամանման միջակայքի ավարտ", "Окончание интервала прибытия поставщика услуг") : choose(locale, "Preferred arrival until", "Նախընտրելի ժամի ավարտ", "Предпочтительное время окончания прибытия")}</span><input className={fieldClass} required type="datetime-local" name="endsAt" defaultValue={terms?.endsAt ? localTime(terms.endsAt) : undefined} /></label>}
    </div>
    {!actual && <p className="text-caption text-muted-foreground">{choose(locale, "This is your preferred start time. The provider confirms the actual arrival window.", "Սա Ձեր նախընտրելի սկզբի ժամն է։ Իրական ժամային միջակայքը հաստատում է ծառայություն մատուցողը։", "Это предпочтительное время начала. Поставщик услуг подтвердит фактический интервал прибытия.")}</p>}
    <input type="hidden" name="timezone" value="Asia/Yerevan" />
    {homeOnly ? <input type="hidden" name="mode" value="home" /> : <label className="block space-y-1 text-body2"><span>{choose(locale, "Where", "Որտեղ", "Где")}</span><div className="relative"><select className={`${fieldClass} h-12 appearance-none pr-10`} name="mode" value={mode} onChange={event => setMode(event.target.value as "clinic" | "home" | "office")}><option value="clinic">{choose(locale, "At a clinic", "Կլինիկայում", "В клинике")}</option><option value="home">{choose(locale, "At home, if the provider offers it", "Տանը, եթե ծառայությունը հասանելի է", "Дома, если поставщик услуг предлагает такой вариант")}</option><option value="office">{choose(locale, "At an office, if the provider offers it", "Աշխատավայրում, եթե ծառայությունը հասանելի է", "В офисе, если поставщик услуг предлагает такой вариант")}</option></select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div></label>}
    {mode === "clinic" && clinics ? <div className="space-y-2">
      <label className="block space-y-1 text-body2"><span>{choose(locale, "Preferred clinic", "Նախընտրելի կլինիկա", "Предпочтительная клиника")}</span><div className="relative"><select className={`${fieldClass} h-12 appearance-none pr-10`} name="clinic" value={clinicId} onChange={event => setClinicId(event.target.value)} required><option value="" disabled>{choose(locale, "Choose a clinic", "Ընտրեք կլինիկա", "Выбрать клинику")}</option>{choices?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div></label>
      {clinic?.address && <p className="break-words text-body2 text-muted-foreground">{clinic.address}</p>}
      {!clinics.length && <p role="status" className="text-body2">{choose(locale, "No demo clinics are available. Choose a home or office preference, or try again later.", "Փորձնական կլինիկաներ հասանելի չեն։ Ընտրեք տան կամ աշխատավայրի տարբերակը կամ փորձեք ավելի ուշ։", "Демонстрационные клиники недоступны. Выберите дом или офис либо попробуйте позже.")}</p>}
      <input type="hidden" name="location" value={clinic ? clinic.address ? `${clinic.name} · ${clinic.address}` : clinic.name : ""} />
    </div> : mode === "home" || mode === "office" ? <label className="block space-y-1 text-body2"><span>{mode === "office" ? choose(locale, "Office address and access notes", "Աշխատավայրի հասցե և մուտքի նշումներ", "Адрес офиса и инструкции для входа") : choose(locale, "Home address", "Տան հասցե", "Домашний адрес")}</span><textarea key={mode} className={fieldClass} name="location" required minLength={3} maxLength={1000} rows={2} value={mode === "office" ? officeAddress : homeAddress} onChange={event => mode === "office" ? setOfficeAddress(event.target.value) : setHomeAddress(event.target.value)} /></label> : <label className="block space-y-1 text-body2"><span>{choose(locale, "Preferred clinic name", "Նախընտրելի կլինիկայի անուն", "Название предпочтительной клиники")}</span><input key="clinic" className={fieldClass} name="location" required minLength={3} maxLength={1000} value={clinicName} onChange={event => setClinicName(event.target.value)} /></label>}
  </>;
}
export function Arrangement({ arrangement, locale, title, audience = "staff" }: { audience?: Audience; arrangement: NonNullable<BookingRequest["proposal"]>; locale: Locale; title: string }) {
  return <div className="space-y-2 border-l-2 border-primary pl-4">
    <h3 className="text-body2 font-semibold">{title}</h3><p className="text-body2 font-medium">{arrangement.provider}</p>
    <p className="text-body2">{termsText(arrangement.terms, locale)} <span className="text-caption">(UTC+4)</span></p>
    <p className="break-words text-body2">{bookingLocationText(arrangement.terms.mode, locale)} · {audience === "staff" ? arrangement.terms.location : memberInstruction(arrangement.terms.location, locale)}</p>
    <details><summary className="min-h-11 cursor-pointer py-2 text-body2 font-medium">{choose(locale, "Preparation and provider source", "Նախապատրաստում և աղբյուր", "Подготовка и источник сведений поставщика услуг")}</summary>
      <p className="whitespace-pre-wrap break-words text-body2">{audience === "staff" ? arrangement.preparation : memberInstruction(arrangement.preparation, locale)}</p>
      <dl className="mt-3 space-y-2 text-caption text-muted-foreground"><div><dt>{choose(locale, "Source", "Աղբյուր", "Источник")}</dt><dd className="whitespace-pre-wrap break-words">{audience === "staff" ? arrangement.source : memberInstruction(arrangement.source, locale)}</dd></div><div><dt>{choose(locale, "Obtained", "Ստացվել է", "Получено")}</dt><dd>{bookingTimestampText(arrangement.obtainedAt, locale)} (UTC+4) · {arrangement.channel}</dd></div></dl>
    </details>
  </div>;
}
