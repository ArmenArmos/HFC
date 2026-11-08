"use client";
import { useState, useEffect, useTransition, useRef, useSyncExternalStore } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { requestPhoneCode, switchTelegramAccount, verifyPhoneCode } from "@/app/patient/actions";
import { armenianNationalDigits, armenianPhoneFromNational, foreignInternationalNumber, normalizePhone } from "@/lib/patient/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PatientShell } from "./patient-shell";
import { OnboardingSteps } from "./onboarding-steps";
import { safeRequest } from "@/lib/patient/transport";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { PhoneCodeDelivery } from "@/lib/patient/phone-code-policy";
import type { ContactRefusal } from "@/lib/telegram-auth/member-signin";
import { continuePath } from "@/lib/patient/continue-path";
// A full reserved number can be pasted into the same field. This only parses input;
// admission and transport are decided by the server, never by this component.
const fullReservedNumber = (value: string) => /^\+999\d{0,11}$/.test(value);
const entryPhone = (value: string) => fullReservedNumber(value) ? normalizePhone(value) : armenianPhoneFromNational(value);
const subscribeToHydration = () => () => {};
/** Shown when the sign-in limits for this network or number are reached. */
const tooManyTries = (locale: PatientLocale) =>
  tx(locale, "Չափազանց շատ փորձեր։ Սպասեք մի քանի րոպե և նորից փորձեք։", "Too many tries. Wait a few minutes and try again.", "Слишком много попыток. Подождите несколько минут и попробуйте снова.");
const clientReady = () => true;
const serverReady = () => false;
/** `next`: an allowed page to open after sign-in (lib/patient/continue-path); `linkExpired`: arrived from an expired Telegram link. */
/** The start token of the bot link on the page, sent back so the server can keep that exact link. */
const shownLinkToken=(url:string)=>/[?&]start=([A-Za-z0-9_-]+)/.exec(url)?.[1];
export function PhoneEntry({ delivery = "sms", initialLocale = "hy", siteKey: configuredSiteKey, next, linkExpired = false }: { delivery?: PhoneCodeDelivery; initialLocale?: PatientLocale; siteKey: string; next?: string | null; linkExpired?: boolean }) {
  const [locale, setLocale] = useState<PatientLocale>(initialLocale),
    // Armenian national input, or a pasted full reserved number.
    [national, setNational] = useState(""),
    [code, setCode] = useState(""),
    [stage, setStage] = useState<"phone" | "security" | "prove" | "code">("phone"),
    [proveUrl, setProveUrl] = useState(""),
    [error, setError] = useState(""),
    [cooldown, setCooldown] = useState(0),
    [busy, start] = useTransition();
  const [contactRefusal, setContactRefusal] = useState<ContactRefusal>();
  const refusalMessage = contactRefusal === "phone_mismatch"
    ? tx(locale,
      "Telegram-ի հաշիվը, որից կիսվել եք համարով, ունի Ձեր մուտքագրածից տարբեր հեռախոսահամար։ Փոխեք համարն այստեղ կամ կիսվեք այն Telegram հաշվից, որն օգտագործում է այս համարը։",
      "The Telegram account you shared from has a different phone number than the one you typed. Change the number here, or share from the Telegram account that uses this number.",
      "В аккаунте Telegram, из которого вы поделились контактом, указан другой номер телефона, чем тот, который вы ввели. Измените номер здесь или поделитесь контактом из аккаунта Telegram с этим номером.")
    : contactRefusal === "not_own_contact"
      ? tx(locale,
        "Դուք կիսվել եք ուրիշի կոնտակտով կամ փոխանցված կոնտակտի քարտով։ Noreon բոտում սեղմեք «Կիսվել իմ համարով» կոճակը՝ Ձեր սեփական համարով կիսվելու համար։",
        "You shared someone else’s contact or a forwarded contact card. In the Noreon bot, use the “Share my phone number” button to share your own number.",
        "Вы отправили чужой контакт или пересланную карточку контакта. В боте Noreon нажмите «Поделиться номером телефона», чтобы отправить свой номер.")
      : contactRefusal === "stale"
        ? tx(locale,
          "Համարով կիսվելու այս փորձն այլևս չի գործում։ Կրկին բացեք Noreon բոտը և սեղմեք «Կիսվել իմ համարով» կոճակը՝ Ձեր սեփական համարով կիսվելու համար։",
          "That contact share is out of date. Open the Noreon bot again and use the “Share my phone number” button to share your own number.",
          "Этот контакт уже устарел. Снова откройте бота Noreon и нажмите «Поделиться номером телефона», чтобы отправить свой номер.")
        : "";
  const interactive = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  // The page decides (lib/captcha.ts); "" means no widget and no token.
  const siteKey = configuredSiteKey || undefined;
  const captcha = useRef<HCaptcha>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousStage = useRef(stage);
  // The number a code was already sent for automatically (see the auto-send effect below).
  const autoSent = useRef<string | null>(null);
  // Gohar D-010: the typed number survives a visit to Help and back (this tab only, never the URL).
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("noreon.signup.phone.v1");
      if (saved && (/^\d{1,8}$/.test(saved) || fullReservedNumber(saved))) {
        // A code already requested for this number is not sent again just because the page reopened (review R1).
        const sent = window.sessionStorage.getItem("noreon.signup.phone-sent.v1");
        if (sent && sent === entryPhone(saved)) autoSent.current = sent;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after hydration
        setNational(saved);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (national) window.sessionStorage.setItem("noreon.signup.phone.v1", national);
      else window.sessionStorage.removeItem("noreon.signup.phone.v1");
    } catch {}
  }, [national]);
  // Keep the chosen language, including one from ?locale=, for the profile form after sign-in.
  useEffect(() => {
    if (typeof document !== "undefined") document.cookie = `noreon_locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }, [locale]);
  useEffect(() => {
    if (busy || previousStage.current === stage) return;
    previousStage.current = stage;
    if (stage === "security") heading.current?.focus();
    else input.current?.focus();
  }, [stage, busy]);
  const phone = entryPhone(national);
  const shownPhone = phone ?? `+374${national}`;
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReady, setCaptchaReady] = useState(false);
  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  // Automatic sends on returns from the bot (see below): when the last one went and how many on this step.
  const returns = useRef({ last: 0, count: 0 });
  const send = () => {
    if (busy || (stage === "code" && cooldown > 0)) return;
    const quiet = stage === "code" || stage === "prove";
    const number = phone;
    if (!number) {
      setError(
        tx(locale, "Ստուգեք հեռախոսահամարը։", "Check your phone number.", "Проверьте номер телефона."),
      );
      return;
    }
    // With a CAPTCHA widget the number is confirmed on its own screen first; without one the code goes at once.
    if (stage === "phone" && siteKey) return;
    if (siteKey && (quiet ? !captchaReady : !captchaToken)) return;
    setError("");
    start(async () => {
      let token = captchaToken;
      if (siteKey && quiet) {
        try {
          // Supabase consumes CAPTCHA tokens on every send. Resend gets its own
          // token without leaving another checkbox on the code-entry screen.
          token = (await captcha.current?.execute({ async: true }))?.response ?? "";
          if (!token) throw new Error("missing-captcha-token");
        } catch {
          captcha.current?.resetCaptcha();
          setError(tx(locale, "Անվտանգության ստուգումը չի ավարտվել։ Փորձեք կրկին։", "The security check didn’t finish. Try again.", "Проверка безопасности не завершена. Попробуйте снова."));
          return;
        }
      }
      const result = await safeRequest(() =>
        // On the bot step the page sends back the link it shows: the server keeps that link while it is open.
        requestPhoneCode(number, token || undefined, stage === "prove" ? shownLinkToken(proveUrl) : undefined),
      );
      captcha.current?.resetCaptcha();
      setCaptchaToken("");
      if (result?.ok) {
        setContactRefusal(undefined);
        setCode("");
        try { window.sessionStorage.setItem("noreon.signup.phone-sent.v1", number); } catch {}
        if (stage !== "code") setCaptchaReady(false);
        setStage("code");
        setCooldown(60);
      } else if (result && "reason" in result && result.reason === "prove" && "url" in result) {
        setContactRefusal(result.contactRefusal);
        if (result.url) setProveUrl(result.url);
        if (stage !== "prove") {
          setCaptchaReady(false);
          returns.current = { last: Date.now(), count: 0 };
        }
        if (stage === "prove" && !result.contactRefusal) setError(tx(locale,
          "Ձեր համարը Telegram-ից դեռ չենք ստացել։ Noreon բոտում սեղմեք Start, ապա «Կիսվել իմ համարով», հետո վերադարձեք այստեղ։",
          "We haven't received your number from Telegram yet. In the Noreon bot, press Start, then tap “Share my phone number”, then come back here.",
          "Мы ещё не получили ваш номер из Telegram. В боте Noreon нажмите «Запустить» (Start), затем «Поделиться номером телефона» и вернитесь сюда."));
        setStage("prove");
      } else if (result && "reason" in result && result.reason === "pending")
        setError(tx(locale,
          "Ձեր համարը Telegram-ից ճանապարհին է։ Սպասեք մի քանի վայրկյան և նորից սեղմեք կոճակը։",
          "Your number is on its way from Telegram. Wait a few seconds, then tap the button again.",
          "Ваш номер уже в пути из Telegram. Подождите несколько секунд и нажмите кнопку ещё раз."));
      else if (result && "reason" in result && result.reason === "busy")
        setError(tx(locale, "Մի պահ սպասեք և փորձեք կրկին։", "Wait a moment and try again.", "Подождите немного и попробуйте снова."));
      else if (result && "reason" in result && result.reason === "rate_limited")
        setError(tooManyTries(locale));
      else
        setError(
          tx(
            locale,
            "Չհաջողվեց ուղարկել կոդը։ Ստուգեք համարը կամ փորձեք ավելի ուշ։",
            "We couldn’t send a code. Check your number or try again later.", "Не удалось отправить код. Проверьте номер или попробуйте позже.",
          ),
        );
    });
  };
  // Khikar, 19 Oct: no tap to send the code. Without a CAPTCHA widget the code goes as soon as the number is
  // complete (a short pause allows a last correction), once per number. Every complete number takes the same
  // path as the button did, so nothing here tells a bound number from an unbound one.
  useEffect(() => {
    if (siteKey || stage !== "phone" || !phone || !interactive || busy || autoSent.current === phone) return;
    const timer = setTimeout(() => {
      autoSent.current = phone;
      send();
    }, 700);
    return () => clearTimeout(timer);
  });
  // Back from the bot after sharing the number: ask for the code again without a tap. Without CAPTCHA only
  // (review F-02); one request at a time, at least 5 s apart and at most 5 per bot step (review F-03).
  useEffect(() => {
    if (siteKey || stage !== "prove" || typeof document === "undefined") return;
    const back = () => {
      const now = Date.now(), r = returns.current;
      if (document.visibilityState !== "visible" || busy || now - r.last < 5000 || r.count >= 5) return;
      r.last = now;
      r.count += 1;
      send();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  });
  // Exactly once per complete code: the button or the sixth digit (typed, pasted or filled from the message).
  const verified = useRef("");
  const verify = (value: string) => {
    if (busy || !interactive || value.length !== 6 || verified.current === value) return;
    verified.current = value;
    setError("");
    start(async () => {
      const result = await safeRequest(() =>
        verifyPhoneCode(phone ?? "", value),
      );
      // No answer about this code (network, service, rate limit): the button may try the same code again.
      // A rejected code is never sent twice; the member corrects it first.
      if (!result || ("reason" in result && (result.reason === "unavailable" || result.reason === "rate_limited"))) verified.current = "";
      if (result?.ok) {
        setCode("");
        try {
          window.sessionStorage.removeItem("noreon.signup.phone.v1");
          window.sessionStorage.removeItem("noreon.signup.phone-sent.v1");
        } catch {}
        // A full load, so the tab is bound to this account before anything on the next page can write (QA a6-01).
        window.location.replace(continuePath(next) ?? "/patient/dashboard");
      } else if (result && "reason" in result && result.reason === "sign_in_again") {
        setCode("");
        setStage("phone");
        setError(tx(locale, "Ձեր Telegram հաշիվը փոխվել է։ Մուտք գործեք կրկին։", "Your Telegram account changed. Sign in again.", "Ваш аккаунт Telegram изменился. Войдите снова."));
      } else if (result && "reason" in result && result.reason === "rate_limited")
        setError(tooManyTries(locale));
      else if (result && "reason" in result && result.reason === "resend")
        setError(tx(locale, "Այս կոդն այլևս չի գործում։ Ուղարկեք նոր կոդ։", "This code no longer works. Send a new code.", "Этот код больше не действует. Отправьте новый код."));
      else
        setError(
          tx(
            locale,
            "Կոդը սխալ է կամ ժամկետանց։ Փորձեք կրկին։",
            "That code is invalid or expired. Try again.", "Код неверен или срок его действия истёк. Попробуйте снова.",
          ),
        );
    });
  };
  return (
    <PatientShell locale={locale} navigation={false}>
      <div className="mx-auto max-w-md">
        <OnboardingSteps step={stage === "code" ? 2 : 1} locale={locale} />
        <div className="mb-4 mt-3 flex justify-end gap-2">
          <Button
            className="h-11"
            variant={locale === "hy" ? "secondary" : "ghost"}
            onClick={() => setLocale("hy")}
          >
            Հայ
          </Button>
          <Button
            className="h-11"
            variant={locale === "en" ? "secondary" : "ghost"}
            onClick={() => setLocale("en")}
          >
            English
          </Button>
          <Button
            className="h-11"
            variant={locale === "ru" ? "secondary" : "ghost"}
            onClick={() => setLocale("ru")}
          >
            Русский
          </Button>
        </div>
        {linkExpired && stage === "phone" && (
          <p role="status" data-link-expired className="mb-4 rounded-xl border bg-muted/40 p-4 text-body2">
            {tx(locale, "Telegram-ի հղումն այլևս չի գործում։ Մուտք գործեք, և մենք կբացենք նույն էջը։", "The Telegram link has expired. Sign in and we will open the same page.", "Срок действия ссылки Telegram истёк. Войдите, и мы откроем ту же страницу.")}
          </p>
        )}
        <div className={stage === "phone" ? "mb-5 space-y-2 rounded-2xl bg-brand-navy p-5 text-on-inverse" : "mb-5 space-y-2"}>
        <h1 ref={heading} tabIndex={-1} className="text-h1 focus:outline-none">
          {stage === "phone"
            ? tx(
                locale,
                "Բարի գալուստ Noreon",
                "Welcome to Noreon", "Добро пожаловать в Noreon",
              )
            : stage === "security"
              ? tx(locale, "Հաստատեք Ձեր համարը", "Confirm your number", "Подтвердите ваш номер")
            : stage === "prove"
              ? tx(locale, "Հաստատեք համարը Telegram-ում", "Confirm your number in Telegram", "Подтвердите номер в Telegram")
            : tx(
                locale,
                delivery === "whatsapp" ? "Ստուգեք WhatsApp-ը" : delivery === "telegram" ? "Ստուգեք Telegram-ը" : "Ստուգեք ձեր հաղորդագրությունները",
                delivery === "whatsapp" ? "Check WhatsApp" : delivery === "telegram" ? "Check Telegram" : "Check your messages", delivery === "whatsapp" ? "Проверьте WhatsApp" : delivery === "telegram" ? "Проверьте Telegram" : "Проверьте ваши сообщения",
              )}
        </h1>
        <p className={stage === "phone" ? "text-body2 text-on-inverse-muted" : "text-body2 text-muted-foreground"}>
          {stage === "phone"
            ? tx(
                locale,
                "Մուտք գործեք կամ ստեղծեք Ձեր հաշիվը։",
                "Sign in or create your account.", "Войдите или создайте аккаунт.",
              )
            : stage === "security"
              ? tx(locale, delivery === "whatsapp" ? `Մուտքի կոդը կուղարկենք ${shownPhone} համարի WhatsApp-ին։` : delivery === "telegram" ? `Մուտքի կոդը կուղարկենք ${shownPhone} համարի Telegram-ին։` : `Մուտքի կոդը կուղարկենք ${shownPhone} համարին։`, delivery === "whatsapp" ? `We’ll send a code to WhatsApp on ${shownPhone}.` : delivery === "telegram" ? `We’ll send a code to Telegram on ${shownPhone}.` : `We’ll text a code to ${shownPhone}.`, delivery === "whatsapp" ? `Мы отправим код в WhatsApp на номер ${shownPhone}.` : delivery === "telegram" ? `Мы отправим код в Telegram на номер ${shownPhone}.` : `Мы отправим SMS с кодом на номер ${shownPhone}.`)
            : stage === "prove"
              ? tx(locale, `Բացեք Noreon բոտը Telegram-ում և սեղմեք «Կիսվել իմ համարով»։ Ապա վերադարձեք այստեղ։ Համարը պետք է լինի ${shownPhone}։`, `Open the Noreon bot in Telegram and tap “Share my phone number”. Then come back here. The number must be ${shownPhone}.`, `Откройте бота Noreon в Telegram и нажмите «Поделиться номером телефона». Затем вернитесь сюда. Номер должен быть ${shownPhone}.`)
            : tx(
                locale,
                delivery === "whatsapp" ? `Մուտքագրեք ${shownPhone} համարի WhatsApp-ին ուղարկված կոդը։` : delivery === "telegram" ? `Մուտքագրեք Telegram-ում ուղարկված կոդը։` : `Մուտքագրեք ${shownPhone} համարին ուղարկված կոդը։`,
                delivery === "whatsapp" ? `Enter the code sent to WhatsApp on ${shownPhone}.` : delivery === "telegram" ? "Enter the code we sent you in Telegram." : `Enter the code sent to ${shownPhone}.`, delivery === "whatsapp" ? `Введите код, отправленный в WhatsApp на номер ${shownPhone}.` : delivery === "telegram" ? "Введите код, который мы отправили вам в Telegram." : `Введите код, отправленный на номер ${shownPhone}.`,
              )}
        </p>
        </div>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !interactive) return;
            if (stage === "phone") {
              if (!phone) {
                setError(tx(locale, "Մուտքագրեք 8 թվանշան +374-ից հետո։", "Enter the 8 digits after +374.", "Введите 8 цифр после +374."));
                return;
              }
              setError("");
              if (!siteKey) {
                autoSent.current = phone;
                send();
                return;
              }
              setCaptchaToken("");
              setCaptchaReady(false);
              setStage("security");
            } else if (stage !== "code") send();
            else if (code.length !== 6) setError(tx(locale, "Մուտքագրեք 6 թվանշանանոց կոդը։", "Enter the 6-digit code.", "Введите шестизначный код."));
            else verify(code);
          }}
        >
          {stage !== "security" && stage !== "prove" && <div className="space-y-2">
            <Label htmlFor="phone-code">
              {stage === "phone"
                ? tx(locale, "Հեռախոսահամար", "Phone number", "Номер телефона")
                : tx(locale, "Վեցանիշ կոդ", "6-digit code", "Шестизначный код")}
            </Label>
            {stage === "phone" ? (
              <div
                className="flex h-12 items-stretch overflow-hidden rounded-lg border border-input text-base focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
              >
                <span id="phone-prefix" className="flex select-none items-center border-r border-input bg-muted px-3 font-medium text-muted-foreground">
                  {fullReservedNumber(national) ? "+" : "+374"}
                </span>
                <input
                  ref={input}
                  id="phone-code"
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-base tracking-wide outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="XXXXXXXX"
                  aria-describedby="phone-prefix phone-hint"
                  value={fullReservedNumber(national) ? national.slice(1) : national}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[\s()-]/g, "");
                    const full = fullReservedNumber(national) && !raw.startsWith("+") ? `+${raw}` : raw;
                    if (fullReservedNumber(full)) {
                      setNational(full);
                      setError("");
                      return;
                    }
                    if (foreignInternationalNumber(e.target.value)) {
                      setNational("");
                      setError(tx(locale, "Noreon-ն աշխատում է միայն հայկական (+374) համարներով։", "Noreon works with Armenian (+374) numbers only.", "Noreon работает только с армянскими номерами (+374)."));
                      return;
                    }
                    setNational(armenianNationalDigits(e.target.value));
                    if (error) setError("");
                  }}
                  aria-required="true"
                  disabled={busy || !interactive}
                />
              </div>
            ) : (
              <Input
                ref={input}
                id="phone-code"
                className="h-12 text-base"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(value);
                  // The sixth digit signs in: typed, pasted or filled from the message (CAPTCHA off only; review F-02).
                  if (value.length === 6 && !siteKey) verify(value);
                }}
                aria-required="true"
                disabled={busy || !interactive}
              />
            )}
            {stage === "phone" && (
              <p id="phone-hint" className="text-caption text-muted-foreground">
                {fullReservedNumber(national) ? shownPhone : tx(locale, `Մուտքագրեք 8 թվանշանը +374-ից հետո (${national.length}/8)։`, `Enter the 8 digits after +374 (${national.length}/8).`, `Введите 8 цифр после +374 (${national.length}/8).`)}
              </p>
            )}
          </div>}
          {stage === "phone" && <p className="text-caption text-muted-foreground">{tx(locale, delivery === "whatsapp" ? "Մուտքի կոդը՝ WhatsApp-ով։ Գաղտնաբառ պետք չէ։" : delivery === "telegram" ? "Մուտքի կոդը՝ Telegram-ով։ Գաղտնաբառ պետք չէ։" : "Մուտքի կոդը՝ SMS-ով։ Գաղտնաբառ պետք չէ։", delivery === "whatsapp" ? "A code by WhatsApp. No password needed." : delivery === "telegram" ? "A code in Telegram. No password needed." : "A code by SMS. No password needed.", delivery === "whatsapp" ? "Код в WhatsApp. Пароль не нужен." : delivery === "telegram" ? "Код в Telegram. Пароль не нужен." : "Код по SMS. Пароль не нужен.")}</p>}
          {/* Khikar, 19 Oct 22:51 (Gohar Q6): Telegram coming to the front is expected, so say so first. STAGING HY. */}
          {stage === "phone" && delivery === "telegram" && busy && (
            <p role="status" data-telegram-opening className="text-body2 text-muted-foreground">
              {tx(locale, "Բացում ենք Telegram-ը՝ կոդն ուղարկելու համար…", "Opening Telegram to send your code…", "Открываем Telegram для отправки кода…")}
            </p>
          )}
          {stage === "prove" && refusalMessage && (
            <p role="alert" className="text-sm text-destructive">{refusalMessage}</p>
          )}
          {stage === "prove" && proveUrl && (
            <a className="flex min-h-12 w-full items-center justify-center rounded-md border border-input px-3 py-2 text-center text-base font-medium" href={proveUrl} target="_blank" rel="noreferrer">
              {contactRefusal === "phone_mismatch"
                ? tx(locale, "Կիսվել ճիշտ Telegram հաշվից", "Share from the right Telegram account", "Поделиться из нужного аккаунта Telegram")
                : tx(locale, "Բացել Telegram-ը", "Open Telegram", "Открыть Telegram")}
            </a>
          )}
          {siteKey && stage !== "phone" && (
            <div className={stage === "security" ? "-mx-2 flex justify-center" : undefined}>
              <HCaptcha
                key={stage}
                ref={captcha}
                sitekey={siteKey}
                size={stage === "security" ? "normal" : "invisible"}
                onReady={() => setCaptchaReady(true)}
                onVerify={stage === "security" ? setCaptchaToken : undefined}
                onExpire={() => setCaptchaToken("")}
                onError={() => {
                  setCaptchaToken("");
                  setError(tx(locale, "Անվտանգության ստուգումը չի ավարտվել։ Փորձեք կրկին։", "The security check didn’t finish. Try again.", "Проверка безопасности не завершена. Попробуйте снова."));
                }}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="h-12 w-full"
            disabled={
              busy || !interactive ||
              (stage === "code" && code.length !== 6) ||
              (stage === "security" && Boolean(siteKey) && !captchaToken)
            }
          >
            {busy
              ? tx(locale, "Խնդրում ենք սպասել…", "Please wait…", "Подождите…")
              : stage === "phone"
                ? siteKey
                  ? tx(locale, "Շարունակել", "Continue", "Продолжить")
                  : tx(locale, "Ուղարկել կոդը", "Send the code", "Отправить код")
                : stage === "security" ? tx(locale, "Ուղարկել հաստատման կոդ", "Send verification code", "Отправить код подтверждения")
                : stage === "prove" ? tx(locale, "Կիսվել եմ համարով, ուղարկել կոդը", "I’ve shared my number. Send the code", "Номер отправлен. Отправить код")
                : tx(locale, "Հաստատել և շարունակել", "Verify and continue", "Подтвердить и продолжить")}
          </Button>
        </form>
        {stage !== "phone" && (
          <div className="mt-4 flex flex-wrap justify-between gap-3">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                captcha.current?.resetCaptcha();
                setCaptchaToken("");
                setCaptchaReady(false);
                setStage("phone");
                setCode("");
                setError("");
                setContactRefusal(undefined);
                // The number already sent stays remembered: only an edit sends again (review F-01).
              }}
            >
              {tx(locale, "Փոխել համարը", "Change number", "Изменить номер")}
            </Button>
            {stage === "code" && delivery === "telegram" && <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setError("");
                start(async () => {
                  const result = await safeRequest(() => switchTelegramAccount(phone ?? ""));
                  if (result && "reason" in result && result.reason === "prove" && "url" in result) {
                    setContactRefusal(result.contactRefusal);
                    if (result.url) setProveUrl(result.url);
                    setCaptchaReady(false);
                    setStage("prove");
                  } else setError(tx(locale, "Չհաջողվեց։ Փորձեք ավելի ուշ։", "That did not work. Try again later.", "Не удалось выполнить действие. Попробуйте позже."));
                });
              }}
            >
              {tx(locale, "Չունեմ այդ Telegram հաշիվը", "I no longer have that Telegram account", "У меня больше нет этого аккаунта Telegram")}
            </Button>}
            {stage === "code" && <Button
              variant="ghost"
              disabled={
                busy || cooldown > 0 || (Boolean(siteKey) && !captchaReady)
              }
              onClick={send}
            >
              {cooldown > 0
                ? `${tx(locale, "Կրկին ուղարկել", "Resend", "Отправить снова")} (${cooldown})`
                : tx(locale, "Կրկին ուղարկել կոդը", "Resend code", "Отправить код снова")}
            </Button>}
          </div>
        )}
        {siteKey && stage === "code" && (
          <p className="mt-5 text-caption text-muted-foreground">
            {tx(locale, "Պաշտպանված է hCaptcha-ով։", "Protected by hCaptcha.", "Защищено hCaptcha.")}{" "}
            <a className="underline" href="https://www.hcaptcha.com/privacy" target="_blank" rel="noreferrer">{tx(locale, "Գաղտնիություն", "Privacy", "Конфиденциальность")}</a>{" · "}
            <a className="underline" href="https://www.hcaptcha.com/terms" target="_blank" rel="noreferrer">{tx(locale, "Պայմաններ", "Terms", "Условия")}</a>
          </p>
        )}
        <p className="mt-5 text-caption text-muted-foreground">
          {tx(
            locale,
            "Շտապ օգնության ծառայություն չէ։",
            "Not an emergency service.", "Это не служба скорой помощи.",
          )}
        </p>
      </div>
    </PatientShell>
  );
}
