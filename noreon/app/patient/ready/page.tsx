import Link from "next/link";
import { HeartHandshake, MessageCircle, Route, Users } from "lucide-react";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { buttonVariants } from "@/components/ui/button";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { MeetZoe } from "@/components/patient/meet-zoe";
import { OnboardingSteps } from "@/components/patient/onboarding-steps";
import { readZoeConsents } from "@/lib/zoe/member";

/**
 * Sign-up step 5 (prototype "Meet Zoe"): what Zoe does and does not do. Staging draft copy for
 * Armen/Tatevik: no claims beyond the Zoe statement; Zoe is not a doctor. No 103 button or link on
 * sign-up and onboarding screens (Khikar, 19 Oct 22:51, Gohar Q5).
 */
export default async function Ready() {
  const { profile } = await requireRegistered();
  const l = profile.locale;
  // Fable #277 F3: Zoe's lines follow the member's own choice and whether direct answers are on.
  let zoe: Awaited<ReturnType<typeof readZoeConsents>> = null;
  try { zoe = await readZoeConsents(); } catch { zoe = null; }
  const reads = zoe?.readsMessages === true;
  // Gohar D-011: Zoe introduces herself only to a member who said yes to her. After "Continue without
  // Zoe" (or with Zoe off, or an unreadable choice) the step is a neutral welcome from the care team.
  if (!reads) return <NeutralWelcome locale={l} name={profile.name} />;
  const does: [typeof Route, string][] = [
    [Route, tx(l, "Պարզ բառերով բացատրում եմ ձեր հաջորդ քայլը։", "I explain your next step in plain words.", "Я объясняю ваш следующий шаг простыми словами.")],
    [MessageCircle, tx(l, "Կարդում եմ ձեր հաղորդագրությունները՝ օգնելու ձեր խնամքի թիմին։", "I read your messages to help your care team.", "Я читаю ваши сообщения, чтобы помочь вашей медицинской команде.")],
    ...(zoe?.directAnswers ? [[MessageCircle, tx(l, "Ինքս պատասխանում եմ այցերի և հավելվածի մասին պարզ հարցերին։", "I answer simple questions about visits and the app myself.", "Я сама отвечаю на простые вопросы о визитах и приложении.")] as [typeof Route, string]] : []),
    [Users, tx(l, "Բժշկական ամեն ինչ փոխանցում եմ ձեր խնամքի թիմին։", "I pass anything medical to your care team.", "Все медицинские вопросы я передаю вашей медицинской команде.")],
  ];
  return (
    <PatientShell locale={l} navigation={false}>
      <div className="mx-auto max-w-md space-y-5">
        <OnboardingSteps step={5} locale={l} />
        <MeetZoe locale={l} name={profile.name} team={false} />
        <section className="journey-card" aria-labelledby="zoe-does-title">
          <h2 id="zoe-does-title" className="text-h2">{tx(l, "Ինչով կարող եմ օգնել", "How I can help", "Чем я могу помочь")}</h2>
          <ul className="flex flex-col gap-3">
            {does.map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-3 text-body2">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand-teal" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <p className="text-body2 text-muted-foreground">
            {tx(l, "Ես բժիշկ չեմ և ախտորոշում չեմ անում։", "I am not a doctor and I do not diagnose.", "Я не врач и не ставлю диагнозы.")}
          </p>
        </section>
        <Link className={buttonVariants({ className: "h-12 w-full" })} href="/patient/ready/team">
          {tx(l, "Ծանոթանալ իմ խնամքի թիմին", "Meet my care team", "Познакомиться с моей медицинской командой")}
        </Link>
      </div>
    </PatientShell>
  );
}

function NeutralWelcome({ locale: l, name }: { locale: PatientLocale; name: string }) {
  const first = name.trim().split(/\s+/)[0];
  return (
    <PatientShell locale={l} navigation={false}>
      <div className="mx-auto max-w-md space-y-5" data-welcome="care-team">
        <OnboardingSteps step={5} locale={l} />
        <section className="journey-card" aria-labelledby="welcome-title">
          <div className="flex items-start gap-3">
            <span className="journey-avatar" aria-hidden><HeartHandshake className="size-5" /></span>
            <div className="min-w-0 space-y-2">
              <h1 id="welcome-title" className="text-h1">
                {first ? tx(l, `Բարի գալուստ, ${first}։`, `Welcome, ${first}.`, `Добро пожаловать, ${first}.`) : tx(l, "Բարի գալուստ։", "Welcome.", "Добро пожаловать.")}
              </h1>
              <p className="text-body1 text-muted-foreground">
                {tx(l, "Ձեր հաշիվը պատրաստ է։ Ձեր խնամքի թիմը կօգնի ձեզ ծրագրի յուրաքանչյուր քայլում։", "Your account is ready. Your care team will help you through each step of the programme.", "Ваш аккаунт готов. Ваша медицинская команда поможет вам на каждом шаге программы.")}
              </p>
            </div>
          </div>
        </section>
        <Link className={buttonVariants({ className: "h-12 w-full" })} href="/patient/ready/team">
          {tx(l, "Ծանոթանալ իմ խնամքի թիմին", "Meet my care team", "Познакомиться с моей медицинской командой")}
        </Link>
      </div>
    </PatientShell>
  );
}
