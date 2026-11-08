"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfile } from "@/app/patient/actions";
import { birthDateProblem, nameProblem, parseBirthDate } from "@/lib/patient/validation";
import type { PatientProfile } from "@/lib/patient/types";
import { safeRequest } from "@/lib/patient/transport";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { clinicalLocale } from "@/lib/locale";
import { PatientShell } from "./patient-shell";
import { BirthDatePicker } from "./birth-date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShieldCheck, UserRound } from "lucide-react";
import { CareLink, IconTile } from "@/components/patient-care/common";
import {SelectField} from '@/components/ui/select-field';
import { zoeStatement as zoeStatementText } from "@/lib/zoe/consent-copy";
import { OnboardingSteps } from "./onboarding-steps";
import { SIGNUP_DRAFT_MAX_AGE_MS, SIGNUP_DRAFT_PREFIX, sweepSignupDrafts } from "@/lib/patient/signup-draft";

type FieldErrors = { name?: string; birth?: string; sex?: string };
/** The unfinished sign-up, kept on this device for this member only: a visit to Help and back
 *  (Gohar D-010) or quitting and signing in again (Gohar Q1, Khikar 19 Oct) returns to the same step
 *  with what was entered. Never in the URL; removed when the profile is saved, after 14 days, or on sign-out. */
const draftStorageKey = (member: string) => `${SIGNUP_DRAFT_PREFIX}v2:${member}`;
type Draft = { name: string; birth: string; sex: string; locale: PatientLocale; step: "details" | "consent"; savedAt?: number };
function readDraft(member: string): Partial<Draft> | null {
  sweepSignupDrafts();
  try {
    const raw = window.localStorage.getItem(draftStorageKey(member));
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return null;
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > SIGNUP_DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(draftStorageKey(member));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
function writeDraft(member: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(draftStorageKey(member), JSON.stringify({ ...draft, savedAt: Date.now() }));
    else window.localStorage.removeItem(draftStorageKey(member));
  } catch {
    // Private mode or storage full: the form still works, only the draft is not kept.
  }
}
function nameMessage(locale: PatientLocale, value: string): string | undefined {
  const problem = nameProblem(value);
  if (!problem) return undefined;
  return {
    empty: tx(locale, "Մուտքագրեք ձեր անունը։", "Enter your name.", "Введите ваше имя."),
    short: tx(locale, "Անունը պետք է ունենա առնվազն 2 տառ։", "Your name needs at least 2 letters.", "Имя должно содержать не менее 2 букв."),
    long: tx(locale, "Անունը կարող է ունենալ առավելագույնը 60 նիշ։", "Your name can have up to 60 characters.", "Имя может содержать до 60 символов."),
    characters: tx(
      locale,
      "Օգտագործեք միայն տառեր։ Բացատը, գծիկը (-) և ապաթարցը (’) թույլատրվում են։",
      "Use letters only. Spaces, hyphens (-) and apostrophes (’) are fine.", "Используйте только буквы. Допускаются пробелы, дефисы (-) и апострофы (’).",
    ),
  }[problem];
}
function birthMessage(locale: PatientLocale, value: string, today: string): string | undefined {
  const problem = birthDateProblem(value, today);
  if (!problem) return undefined;
  return {
    empty: tx(locale, "Մուտքագրեք ձեր ծննդյան ամսաթիվը։", "Enter your date of birth.", "Введите вашу дату рождения."),
    invalid: tx(locale, "Մուտքագրեք իրական ամսաթիվ քառանիշ տարիով, օրինակ՝ 20/09/1960։", "Enter a real date with a four-digit year, for example 20/09/1960.", "Введите существующую дату с годом из четырёх цифр, например 20/09/1960."),
    young: tx(locale, "Noreon-ը 18 տարեկան և ավելի մեծահասակների համար է։", "Noreon is for adults aged 18 and over.", "Noreon предназначен для взрослых от 18 лет."),
    old: tx(locale, "Ստուգեք ծննդյան տարեթիվը։", "Check the year of birth.", "Проверьте год рождения."),
  }[problem];
}
const sexMessage = (locale: PatientLocale, value: string) =>
  value === "male" || value === "female" ? undefined : tx(locale, "Ընտրեք տարբերակներից մեկը։", "Choose one of the options.", "Выберите один из вариантов.");

export function ProfileForm({
  profile,
  expectedRevision,
  today,
  initialLocale = "hy",
  zoeStatement = false,
  zoeDirectAnswers = false,
  draftKey,
  embedded = false,
  memberChatV2 = false,
  saveAction = saveProfile,
  onSaved,
  onLocaleChange,
}: {
  profile: PatientProfile | null;
  expectedRevision: number;
  today: string;
  initialLocale?: PatientLocale;
  /** Show the Zoe statement with the consent text and two choices: "Agree and continue" (also
   *  records Zoe reading messages) or "Continue without Zoe" (enrolment only; Fable F1). */
  zoeStatement?: boolean;
  /** Zoe answers simple questions herself: the statement says so (Fable F3). */
  zoeDirectAnswers?: boolean;
  /** Sign-up only: the member's id, so an unfinished sign-up resumes on this device (no draft without it). */
  draftKey?: string;
  /** Reuse the exact enrolment consent and validation inside the member conversation. */
  embedded?: boolean;
  /** Server-selected destination after enrolment consent and a successful new profile save. */
  memberChatV2?: boolean;
  saveAction?: typeof saveProfile;
  onSaved?: () => void;
  /** Sign-up inside the chat: the language was chosen here, so the page around the form follows. */
  onLocaleChange?: (locale: PatientLocale) => void;
}) {
  // Keep the version paired with these drafts even if a server refresh updates props.
  const [snapshotRevision] = useState(expectedRevision);
  const [conflict, setConflict] = useState(false);
  const [name, setName] = useState(profile?.name ?? ""),
    [birth, setBirth] = useState(
      profile
        ? `${profile.birthDate.slice(8)}/${profile.birthDate.slice(5, 7)}/${profile.birthDate.slice(0, 4)}`
        : "",
    ),
    [sex, setSex] = useState(profile?.biologicalSex ?? ""),
    [locale, setLocale] = useState<PatientLocale>(
      profile?.locale ?? initialLocale,
    ),
    [consent, setConsent] = useState(!!profile),
    [consentError, setConsentError] = useState(false),
    [fieldErrors, setFieldErrors] = useState<FieldErrors>({}),
    [error, setError] = useState(""),
    [busy, start] = useTransition(),
    // Sign-up is two screens (prototype "Join" steps 3 and 4): details, then consent. The one save
    // still happens on Agree, with the consent, exactly as before. Editing is one screen.
    [step, setStep] = useState<"details" | "consent">("details");
  const router = useRouter();
  const sending = useRef(false);
  const saved = useRef(false);
  const consentStep = !profile && step === "consent";
  const nameInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  // The page's language the form last matched, so a restored draft can tell the page it differs.
  const pageLocale = useRef(initialLocale);
  // Sign-up only: restore the tab's draft once, then keep it current. Editing an existing
  // profile starts from the saved details instead.
  const [draftLoaded, setDraftLoaded] = useState(!!profile || !draftKey);
  useEffect(() => {
    if (profile || !draftKey) return;
    const draft = readDraft(draftKey);
    /* eslint-disable react-hooks/set-state-in-effect -- one read of browser storage after hydration */
    if (draft) {
      if (typeof draft.name === "string") setName(draft.name.slice(0, 100));
      if (typeof draft.birth === "string") setBirth(draft.birth.slice(0, 10));
      if (draft.sex === "male" || draft.sex === "female") setSex(draft.sex);
      if (draft.locale === "hy" || draft.locale === "en" || draft.locale === "ru") {
        setLocale(draft.locale);
        // The page around the form (menu, language card) must show the language the form is really in.
        if (draft.locale !== pageLocale.current) onLocaleChange?.(draft.locale);
      }
      if (draft.step === "consent" && !nameProblem(draft.name ?? "") && !birthDateProblem(draft.birth ?? "", today) && (draft.sex === "male" || draft.sex === "female"))
        setStep("consent");
    }
    setDraftLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // The draft is read once per sign-up; later language changes must not re-read it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, today, draftKey]);
  useEffect(() => {
    if (profile || !draftKey || !draftLoaded) return;
    writeDraft(draftKey, { name, birth, sex, locale, step });
  }, [profile, draftKey, draftLoaded, name, birth, sex, locale, step]);
  // Sign-up only: a language chosen elsewhere on the page (the menu) applies here too, on either screen.
  useEffect(() => {
    if (profile || pageLocale.current === initialLocale) return;
    pageLocale.current = initialLocale;
    setLocale(initialLocale);
  }, [profile, initialLocale]);
  const validateDetails = () => {
    const next: FieldErrors = {
      name: nameMessage(locale, name),
      birth: birthMessage(locale, birth, today),
      sex: sexMessage(locale, sex),
    };
    setFieldErrors(next);
    if (next.name) nameInput.current?.focus();
    else if (next.birth) document.getElementById("birth-date")?.focus();
    else if (next.sex) document.getElementById("patient-sex")?.focus();
    return !next.name && !next.birth && !next.sex;
  };
  const content = (
      <div className="mx-auto max-w-lg space-y-5">
        {!profile && <OnboardingSteps step={consentStep ? 4 : 3} locale={locale} />}
        {profile && !embedded && (
          <CareLink href="/patient/account" icon={ArrowLeft}>
            {tx(locale, "Վերադառնալ «Ես»", "Back to Me", "Вернуться в мой профиль")}
          </CareLink>
        )}
        <div className="journey-card rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <header className="flex items-center gap-3">
            <IconTile icon={consentStep ? ShieldCheck : UserRound} />
            <h1 className="text-h1">
              {profile
                ? tx(locale, "Ձեր տվյալները", "Your details", "Ваши данные")
                : consentStep
                  ? tx(locale, "Նախքան սկսելը", "Before we start", "Прежде чем начать")
                  : tx(locale, "Եկեք ծանոթանանք։", "Let’s get to know you.", "Давайте познакомимся.")}
            </h1>
          </header>
          <p className="mb-6 mt-3 text-body2 text-muted-foreground [overflow-wrap:normal]">
            {consentStep
              ? tx(
                  locale,
                  "Կարդացեք, թե ինչպես ենք օգտագործում ձեր տվյալները, և համաձայնեք՝ շարունակելու համար։",
                  "Read how we use your information, then agree to continue.", "Прочитайте, как мы используем ваши данные, и дайте согласие, чтобы продолжить.",
                )
              : profile
              ? tx(
                  locale,
                  "Թարմացրեք ձեր տվյալները կամ լեզուն։ Ձեր պլանավորված այցերն ու հրապարակված պլանը պահպանվում են։",
                  "Update your details or language. Your bookings and published plan are kept.", "Обновите ваши данные или язык. Ваши записи на приём и опубликованный план сохранятся.",
                )
              : tx(
                  locale,
                  "Հեռախոսահամարը հաստատված է։ Լրացրեք հիմնական տվյալները՝ ձեր հաշիվը պատրաստելու համար։",
                  "Your phone is verified. Add your basic details to get your account ready.", "Ваш телефон подтверждён. Укажите основные данные, чтобы подготовить ваш аккаунт.",
                )}
          </p>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (sending.current || (embedded && saved.current) || conflict) return;
              // Fable F1/N2: Zoe is a separate, freely given choice: a yes only when the member pressed
              // "Agree and continue" itself; Enter and "Continue without Zoe" enrol with a no (Gohar D-011).
              const submitter = (e.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | null | undefined;
              // The choice is sent only when the statement was on screen: yes for the visible button, no
              // for "Continue without Zoe" and Enter. Without the statement nothing is recorded.
              const withZoe = !profile && zoeStatement ? submitter?.value === "with-zoe" : undefined;
              // Gohar D-001/D-002/D-009: our own checks and messages, in the member's language.
              if (!consentStep && !validateDetails()) return;
              const birthDate = parseBirthDate(birth);
              if (!birthDate) return;
              setError("");
              if (!profile && step === "details") {
                setStep("consent");
                return;
              }
              if (!profile && !consent) {
                setConsentError(true);
                consentInput.current?.focus();
                consentInput.current?.scrollIntoView({ block: "center" });
                return;
              }
              sending.current = true;
              start(async () => {
                const result = await safeRequest(() =>
                  saveAction(
                    {
                      name,
                      birthDate,
                      biologicalSex: sex as "male" | "female",
                      locale,
                    },
                    consent,
                    snapshotRevision,
                    withZoe,
                  ),
                );
                sending.current = false;
                if (result && "reason" in result && result.reason === "conflict") {
                  setConflict(true);
                  setError(tx(locale,
                    "Ձեր պահպանված տվյալները փոխվել են։ Ձեր մուտքագրած փոփոխությունները դեռ այստեղ են։ Վերբեռնեք պահպանված տվյալները՝ շարունակելու համար։",
                    "Your saved details changed. Your edits are still here. Reload saved details to continue.", "Ваши сохранённые данные изменились. Внесённые вами изменения остаются здесь. Загрузите сохранённые данные заново, чтобы продолжить.",
                  ));
                  return;
                }
                if (result?.ok) {
                  saved.current = true;
                  if (!profile && draftKey) writeDraft(draftKey, null);
                  if (!profile && memberChatV2) {
                    router.replace("/patient/chat");
                    router.refresh();
                  } else if (onSaved) onSaved();
                  else {
                    router.replace(profile ? "/patient/account" : "/patient/ready");
                    router.refresh();
                  }
                } else
                  setError(
                    result?.reason === "invalid"
                      ? tx(
                          locale,
                          "Ստուգեք տվյալները։ Այս տարբերակը 18–110 տարեկանների համար է։",
                          "Check your details. This version is for ages 18–110.", "Проверьте ваши данные. Эта версия предназначена для возраста от 18 до 110 лет.",
                        )
                      : tx(
                          locale,
                          "Չհաջողվեց պահել։ Ձեր տվյալները դեռ այստեղ են։ Փորձեք կրկին։",
                          "We couldn’t save. Your details are still here. Try again.", "Не удалось сохранить. Ваши данные остаются здесь. Попробуйте снова.",
                        ),
                  );
              });
            }}
          >
            <fieldset disabled={busy} className="min-w-0 space-y-6">
              {!consentStep && (<>
              <div className="space-y-2">
                <Label htmlFor="patient-name">
                  {tx(locale, "Ձեր անունը", "Your name", "Ваше имя")}
                </Label>
                <Input
                  ref={nameInput}
                  id="patient-name"
                  autoComplete="name"
                  className="h-12 bg-background text-base"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: nameMessage(locale, e.target.value) }));
                  }}
                  onBlur={() => {
                    if (name.trim()) setFieldErrors((f) => ({ ...f, name: nameMessage(locale, name) }));
                  }}
                  aria-required="true"
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? "patient-name-error" : undefined}
                  maxLength={100}
                  disabled={busy}
                />
                {fieldErrors.name && (
                  <p id="patient-name-error" className="text-sm text-destructive">
                    {fieldErrors.name}
                  </p>
                )}
              </div>
              <BirthDatePicker
                value={birth}
                onChange={(value) => {
                  setBirth(value);
                  if (fieldErrors.birth) setFieldErrors((f) => ({ ...f, birth: birthMessage(locale, value, today) }));
                }}
                onBlur={() => {
                  if (birth.trim()) setFieldErrors((f) => ({ ...f, birth: birthMessage(locale, birth, today) }));
                }}
                error={fieldErrors.birth}
                assessmentDate={today}
                locale={locale}
              />
              <div className="space-y-2">
                <Label htmlFor="patient-sex">
                  {tx(locale, "Կենսաբանական սեռ", "Biological sex", "Биологический пол")}
                </Label>
                <SelectField
                  id="patient-sex"
                  disabled={busy}
                  value={sex}
                  aria-invalid={fieldErrors.sex ? true : undefined}
                  aria-describedby={fieldErrors.sex ? "patient-sex-error" : undefined}
                  onValueChange={(value) => {
                    setSex(value);
                    setFieldErrors((f) => ({ ...f, sex: undefined }));
                  }}
                  placeholder={tx(locale, "Ընտրել", "Choose", "Выбрать")}
                  options={[
                    { value: "male", label: tx(locale, "Արական", "Male", "Мужской") },
                    { value: "female", label: tx(locale, "Իգական", "Female", "Женский") },
                  ]}
                />
                {fieldErrors.sex && (
                  <p id="patient-sex-error" className="text-sm text-destructive">
                    {fieldErrors.sex}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-language">
                  {tx(locale, "Լեզու", "Language", "Язык")}
                </Label>
                <SelectField
                  id="patient-language"
                  value={locale}
                  onValueChange={(value) => {
                    const next = value as PatientLocale;
                    setLocale(next);
                    if (!profile) onLocaleChange?.(next);
                    // Shown messages follow the new language.
                    setFieldErrors((f) => ({
                      name: f.name && nameMessage(next, name),
                      birth: f.birth && birthMessage(next, birth, today),
                      sex: f.sex && sexMessage(next, sex),
                    }));
                  }}
                  options={[
                    { value: "hy", label: "Հայերեն" },
                    { value: "en", label: "English" },
                    { value: "ru", label: "Русский" },
                  ]}
                />
              </div>
              </>)}
              {consentStep && (
                <div className="space-y-5 rounded-xl bg-accent p-4">
                  {/* The consent statement and acceptance are the approved Armenian or English wording; a Russian reader sees Armenian. */}
                  <h2 className="text-h3">
                    {tx(
                      locale,
                      "Ինչպես են պահվում ձեր տվյալները",
                      "How your information is used", "Как используются ваши данные",
                    )}
                  </h2>
                  <p className="text-body2 leading-relaxed [overflow-wrap:normal]">
                    {tx(
                      clinicalLocale(locale),
                      "Noreon-ը պահում է ձեր մուտքագրած տվյալները՝ ձեր առողջության պրոֆիլը և չափումների պատմությունը ցույց տալու համար։ Սա պիլոտային տարբերակ է․ այս փուլում չափումները ավտոմատ բժշկական գնահատում կամ բժշկին ծանուցում չեն առաջացնում։ Շտապ օգնության կարիք ունենալիս մի սպասեք այս ծառայությանը։",
                      "Noreon stores the information you enter to show your health profile and measurement history. This is a pilot preview: measurements do not trigger automatic medical interpretation or a notification to a doctor. Do not wait for this service if you need emergency help.", "Noreon хранит введённые вами данные, чтобы показывать ваш профиль здоровья и историю измерений. Это пилотная версия: измерения не вызывают автоматической медицинской оценки или уведомления врача. Если вам нужна скорая помощь, не ждите ответа этой службы.",
                    )}
                  </p>
                  <label className="flex items-start gap-3 text-sm leading-relaxed">
                    <input
                      ref={consentInput}
                      className="mt-1 size-5 shrink-0 accent-primary"
                      type="checkbox"
                      checked={consent}
                      aria-required="true"
                      aria-invalid={consentError || undefined}
                      aria-describedby={consentError ? "patient-consent-error" : undefined}
                      onChange={(e) => {
                        setConsent(e.target.checked);
                        setConsentError(false);
                      }}
                      disabled={busy}
                    />
                    <span>
                      {tx(
                        clinicalLocale(locale),
                        "Համաձայն եմ այս պիլոտային տարբերակում իմ տվյալների օգտագործմանը։",
                        "I agree to this use of my information in the pilot preview.", "Я согласен с таким использованием моих данных в пилотной версии.",
                      )}
                    </span>
                  </label>
                  {consentError && (
                    <p id="patient-consent-error" role="alert" className="text-sm text-destructive">
                      {tx(
                        locale,
                        "Շարունակելու համար հաստատեք ձեր համաձայնությունը։",
                        "Please agree to continue.", "Дайте согласие, чтобы продолжить.",
                      )}
                    </p>
                  )}
                </div>
              )}
              {consentStep && zoeStatement && (
                // Gohar Q2 (Khikar, 19 Oct 22:51): the tick above is the data-use consent for every
                // account; Zoe is a separate choice made with the buttons below, with no tick of its own.
                <div className="space-y-4 rounded-xl border p-4" data-zoe-choice>
                  <h2 className="text-h3">{tx(locale, "Zoe՝ ձեր խնամքի օգնականը", "Zoe, your care assistant", "Zoe, ваш помощник по заботе о здоровье")}</h2>
                  <p className="text-body2 leading-relaxed [overflow-wrap:normal]" data-zoe-statement>
                    {zoeStatementText(clinicalLocale(locale), zoeDirectAnswers)}
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground" data-zoe-buttons-explained>
                    {tx(
                      locale,
                      "Երկու կոճակների համար էլ նախ նշեք վերևի համաձայնությունը։ «Համաձայն եմ և շարունակում եմ»՝ միացնում է նաև Zoe-ին։ «Շարունակել առանց Zoe-ի»՝ ստեղծում է ձեր հաշիվը առանց Zoe-ի։ Zoe-ի համար առանձին նշում պետք չէ։",
                      "Tick the box above for either button. “Agree and continue” also turns Zoe on. “Continue without Zoe” creates your account without her. Zoe needs no separate tick.", "Для любой из двух кнопок сначала отметьте согласие выше. «Согласиться и продолжить» также подключает Zoe. «Продолжить без Zoe» создаёт ваш аккаунт без неё. Отдельная отметка для Zoe не нужна.",
                    )}
                  </p>
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {conflict && (
                <Button type="button" variant="outline" className="h-12 w-full" onClick={() => window.location.reload()}>
                  {tx(locale, "Վերբեռնել պահպանված տվյալները", "Reload saved details", "Загрузить сохранённые данные заново")}
                </Button>
              )}
              {consentStep && zoeStatement && (
                // Fable N2: the first submit button is the one an implicit submit (Enter) uses, so
                // it is a hidden "without Zoe": a yes to Zoe needs the visible button.
                <button type="submit" name="zoe" value="without-zoe" tabIndex={-1} aria-hidden="true" className="sr-only" disabled={busy || conflict} />
              )}
              <Button type="submit" name="zoe" value={consentStep && zoeStatement ? "with-zoe" : undefined} className="h-auto min-h-12 w-full whitespace-normal" disabled={busy || conflict}>
                {busy
                  ? tx(locale, "Պահվում է…", "Saving…", "Сохраняется…")
                  : profile
                    ? tx(locale, "Պահել փոփոխությունները", "Save changes", "Сохранить изменения")
                    : consentStep
                      ? tx(locale, "Համաձայն եմ և շարունակում եմ", "Agree and continue", "Согласиться и продолжить")
                      : tx(locale, "Շարունակել", "Continue", "Продолжить")}
              </Button>
              {consentStep && zoeStatement && (
                <Button type="submit" name="zoe" value="without-zoe" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy || conflict}>
                  {tx(locale, "Շարունակել առանց Zoe-ի", "Continue without Zoe", "Продолжить без Zoe")}
                </Button>
              )}
              {consentStep && (
                <Button type="button" variant="ghost" className="h-12 w-full" onClick={() => { setError(""); setStep("details"); }}>
                  {tx(locale, "Հետ՝ իմ տվյալներին", "Back to my details", "Вернуться к моим данным")}
                </Button>
              )}
            </fieldset>
          </form>
        </div>
      </div>
  );
  return embedded ? <section data-chat-profile>{content}</section> : <PatientShell locale={locale} navigation={!!profile}>{content}</PatientShell>;
}
