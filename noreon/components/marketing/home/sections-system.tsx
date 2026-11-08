"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MonitorIcon,
  RefreshCwIcon,
  SearchIcon,
  TestTubeIcon,
  UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Band,
  Card,
  Heading,
  Track,
} from "@/components/marketing/home/primitives";
import { Ref } from "@/components/marketing/home/sources";
import { Button } from "@/components/ui/button";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * Sections 04 and 05: the loop the product claims to run, and the reason it has
 * to run at all.
 *
 * These two sit next to each other on purpose. The step sequence is the
 * product's shape, and on its own it is a diagram anybody could draw. The
 * action gap is the cited evidence that the last three steps are the hard ones,
 * which is what turns the diagram into an argument.
 */

// ---------------------------------------------------------------------------
// 04 — How it works
// ---------------------------------------------------------------------------

const STEPS: {
  title: LocalizedHyEn;
  tag: LocalizedHyEn;
  icon: typeof UserIcon;
  body: LocalizedHyEn;
  chips: LocalizedHyEn[];
}[] = [
  {
    title: { hy: "Հասկանալ", en: "Understand" },
    tag: { hy: "Առողջական պատկեր", en: "Health profile" },
    icon: UserIcon,
    body: {
      hy: "Կազմեք մանրամասն առողջական պատկեր՝ անամնեզից, բժշկական պատմությունից, նախորդ արդյունքներից, ապրելակերպից և առկա առողջական տվյալներից։",
      en: "Build a detailed health profile from anamnesis, medical history, previous results, lifestyle and available health data.",
    },
    chips: [
      { hy: "Անամնեզ", en: "Anamnesis" },
      { hy: "Բժշկական գրառումներ", en: "Medical records" },
      { hy: "Ապրելակերպ", en: "Lifestyle" },
      { hy: "Ընտանեկան պատմություն", en: "Family history" },
    ],
  },
  {
    title: { hy: "Հայտնաբերել", en: "Detect" },
    tag: { hy: "Ռիսկի գործոններ", en: "Risk factors" },
    icon: SearchIcon,
    body: {
      hy: "Բացահայտեք սրտանոթային ռիսկի գործոնները և այն ոլորտները, որոնք լրացուցիչ ուսումնասիրություն են պահանջում։",
      en: "Identify cardiovascular risk factors and the areas that require further investigation.",
    },
    chips: [
      { hy: "Ռիսկի գնահատում", en: "Risk scoring" },
      { hy: "Կարմիր նշաններ", en: "Red flags" },
      { hy: "Տվյալների բացեր", en: "Gaps in data" },
    ],
  },
  {
    title: { hy: "Հետազոտել", en: "Test" },
    tag: { hy: "Ախտորոշում", en: "Diagnostics" },
    icon: TestTubeIcon,
    body: {
      hy: "Առաջարկեք համապատասխան հետազոտություններ, բացատրեք՝ ինչու են դրանք կարևոր, և համակարգեք հաջորդ քայլը։",
      en: "Recommend relevant diagnostics, explain why they matter and coordinate the next step.",
    },
    chips: [
      { hy: "Լիպիդային վահանակ", en: "Lipid panel" },
      { hy: "ԱՃՄ", en: "ABPM" },
      { hy: "ԷՍԳ", en: "ECG" },
      { hy: "Գործընկեր լաբորատորիաներ", en: "Partner labs" },
    ],
  },
  {
    title: { hy: "Գործել", en: "Act" },
    tag: { hy: "Հստակ առաջնահերթություններ", en: "Clear priorities" },
    icon: ActivityIcon,
    body: {
      hy: "Արդյունքները վերածեք հստակ առաջնահերթությունների՝ դեղորայքի, չափումների, սննդակարգի, ֆիզիկական ակտիվության, քնի, քաշի և հսկողության շուրջ։",
      en: "Translate results into clear priorities across medication, measurements, nutrition, physical activity, sleep, weight and follow-up.",
    },
    chips: [
      { hy: "Դեղորայք", en: "Medication" },
      { hy: "Չափումներ", en: "Measurements" },
      { hy: "Սննդակարգ", en: "Nutrition" },
      { hy: "Ակտիվություն", en: "Activity" },
    ],
  },
  {
    title: { hy: "Հսկել", en: "Monitor" },
    tag: { hy: "Միացված տվյալներ", en: "Connected data" },
    icon: MonitorIcon,
    body: {
      hy: "Միացրեք կրելի սարքերը, բժշկական սարքերը, հետևողականության ազդանշանները և հսկողության արդյունքները՝ հասկանալու, թե իրականում ինչ է կատարվում։",
      en: "Connect wearables, medical devices, adherence signals and follow-up results to understand what is actually happening.",
    },
    chips: [
      { hy: "Տնային ՃՃ", en: "Home BP" },
      { hy: "Կրելի սարքեր", en: "Wearables" },
      { hy: "Դեղատուփ", en: "Pill box" },
      { hy: "Հսկողություն", en: "Follow-up" },
    ],
  },
  {
    title: { hy: "Հարմարեցնել", en: "Adapt" },
    tag: { hy: "Ճշգրտել ծրագիրը", en: "Refine the plan" },
    icon: RefreshCwIcon,
    body: {
      hy: "Օգտագործեք երկարաժամկետ տվյալները՝ կանխարգելման ծրագիրը ճշգրտելու և հաջորդ քայլը հստակ պահելու համար։",
      en: "Use longitudinal data to refine the prevention plan and keep the next action clear.",
    },
    chips: [
      { hy: "Դինամիկայի դիտարկում", en: "Trend review" },
      { hy: "Ծրագրի թարմացում", en: "Plan update" },
      { hy: "Փոխանցում", en: "Escalation" },
    ],
  },
];

/** How long a step holds before the sequence moves on by itself. */
const DWELL_MS = 6500;

/** How long the sequence stays put after somebody has driven it by hand. */
const PAUSE_MS = 25000;

/**
 * The six steps, as a control rather than a diagram.
 *
 * The sequence advances on its own while the section is on screen, because the
 * claim being made is that this is a loop rather than a checklist, and a static
 * row of six boxes says the opposite. Three things keep that from being an
 * annoyance: it only runs while the section is actually visible, touching any
 * control stops it for twenty-five seconds, and it does not run at all under
 * `prefers-reduced-motion`.
 *
 * The step panel is a live region so the automatic change is announced rather
 * than happening silently under a screen reader.
 */
export function HowItWorks() {
  const { t } = useMarketingLocale();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const pausedUntil = useRef(0);

  /** Any deliberate press owns the sequence for a while afterwards. */
  const drive = useCallback((next: number) => {
    pausedUntil.current = Date.now() + PAUSE_MS;
    setStep(((next % STEPS.length) + STEPS.length) % STEPS.length);
  }, []);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.3 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setStep((s) => (s + 1) % STEPS.length);
    }, DWELL_MS);
    return () => window.clearInterval(id);
  }, [visible]);

  const active = STEPS[step];
  const index = String(step + 1).padStart(2, "0");

  return (
    <Band id="how" tone="card">
      <div className="grid items-end gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        <Heading
          eyebrow={{ hy: "04 · Ինչպես է աշխատում", en: "04 · How it works" }}
          title={{
            hy: "Մեկ համակարգ կապում է ռիսկի հայտնաբերումը կայուն գործողության և չափելի առաջընթացի հետ։",
            en: "One system connects risk detection to sustained action and measurable progress.",
          }}
        />
        <p className="text-muted-foreground text-body1 text-pretty">
          {t({
            hy: "Հարթակը միավորում է առողջական պատմությունը, անհատականացված ախտորոշումը, կլինիկական ուղղորդումը, միացված տվյալները և վարքային աջակցությունը սրտանոթային կանխարգելման մեկ շարունակական ճանապարհի մեջ։",
            en: "The platform combines health history, personalised diagnostics, clinical guidance, connected data and behavioural support in one continuous cardiovascular prevention journey.",
          })}
        </p>
      </div>

      <div ref={sectionRef} className="mt-10">
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <li key={s.title.en}>
                <button
                  type="button"
                  onClick={() => drive(i)}
                  aria-current={on}
                  className={cn(
                    "press relative h-full w-full overflow-hidden rounded-xl p-4 text-left ring-1 transition-colors",
                    on
                      ? "bg-card ring-brand-teal shadow-[var(--shadow-lg)]"
                      : "bg-background ring-[var(--border-subtle)] hover:bg-card",
                  )}
                >
                  {/* The rule that fills across the selected step is the only
                      thing on screen reporting that the sequence is running on a
                      timer. Without it the panel below changes for no visible
                      reason. */}
                  <span
                    aria-hidden
                    className={cn(
                      "bg-brand-teal absolute inset-x-0 top-0 h-0.75 origin-left transition-transform duration-500",
                      on ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "font-heading text-caption font-extrabold tracking-widest tabular-nums",
                        on ? "text-brand-gold-deep" : "text-muted-foreground",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-8.5 shrink-0 place-items-center rounded-lg transition-colors",
                        on
                          ? "bg-surface-subtle-teal text-[var(--noreon-teal-800)]"
                          : "bg-card text-muted-foreground",
                      )}
                    >
                      <s.icon className="size-4.5" />
                    </span>
                  </span>
                  <span
                    className={cn(
                      "font-heading text-body2 mt-3.5 block font-extrabold tracking-wide uppercase",
                      on ? "text-[var(--text-strong)]" : "text-foreground",
                    )}
                  >
                    {t(s.title)}
                  </span>
                  <span className="text-muted-foreground text-caption mt-1 block">
                    {t(s.tag)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <Card
          lift={false}
          className="mt-4 grid items-center gap-8 rounded-3xl shadow-[var(--shadow-lg)] lg:grid-cols-[1.2fr_0.8fr] lg:gap-12"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3.5">
              <p className="text-overline text-[var(--noreon-teal-800)]">
                {t({ hy: "Քայլ", en: "Step" })} {index} · {t(active.title)}
              </p>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="press size-11 rounded-full"
                  aria-label={t({ hy: "Նախորդ քայլը", en: "Previous step" })}
                  onClick={() => drive(step - 1)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <span className="font-heading text-muted-foreground text-caption w-13 text-center font-bold tabular-nums">
                  {index} / 06
                </span>
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="press size-11 rounded-full"
                  aria-label={t({ hy: "Հաջորդ քայլը", en: "Next step" })}
                  onClick={() => drive(step + 1)}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            </div>

            <div aria-live="polite">
              <p className="font-heading text-h3 md:text-h2 text-[var(--text-strong)] mt-4 font-bold tracking-tight text-pretty">
                {t(active.body)}
              </p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {active.chips.map((chip) => (
                  <li
                    key={chip.en}
                    className="bg-background text-body2 rounded-pill px-4 py-2 ring-1 ring-[var(--border-subtle)]"
                  >
                    {t(chip)}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The loop, drawn. The arc is one sixth of the circumference and it
              travels rather than accumulating, because the claim is that this
              repeats, not that it finishes. */}
          <div className="flex min-w-0 justify-center">
            <svg
              viewBox="0 0 220 220"
              className="w-full max-w-62"
              role="img"
              aria-label={t({
                hy: "Կանխարգելման շարունակական շրջափուլ",
                en: "Continuous prevention loop",
              })}
            >
              <circle
                cx="110"
                cy="110"
                r="84"
                fill="none"
                stroke="var(--chart-track)"
                strokeWidth="10"
              />
              <circle
                cx="110"
                cy="110"
                r="84"
                fill="none"
                stroke="var(--chart-primary)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="88 440"
                strokeDashoffset={+(44 - step * 87.96).toFixed(1)}
                transform="rotate(-90 110 110)"
                className="transition-[stroke-dashoffset] duration-500"
              />
              {STEPS.map((_, i) => {
                const a = ((-90 + i * 60) * Math.PI) / 180;
                return (
                  <circle
                    key={i}
                    cx={+(110 + 84 * Math.cos(a)).toFixed(1)}
                    cy={+(110 + 84 * Math.sin(a)).toFixed(1)}
                    r={i === step ? 9 : 5}
                    fill={
                      i === step ? "var(--chart-primary)" : "var(--border-default)"
                    }
                    stroke="var(--surface-card)"
                    strokeWidth="2"
                    className="transition-all duration-400"
                  />
                );
              })}
              <text
                x="110"
                y="104"
                textAnchor="middle"
                fill="var(--text-strong)"
                fontSize="15"
                fontWeight="800"
                letterSpacing="1.2"
              >
                {t(active.title).toUpperCase()}
              </text>
              <text
                x="110"
                y="124"
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="11"
              >
                {t({ hy: "քայլ", en: "step" })} {index} {t({ hy: "/", en: "of" })} 06
              </text>
            </svg>
          </div>
        </Card>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 05 — The action gap
// ---------------------------------------------------------------------------

const GAP: { value: string; pct: number; fill: string; body: LocalizedHyEn; ref: number }[] = [
  {
    value: "27–40%",
    pct: 40,
    fill: "var(--status-danger-fg)",
    body: {
      hy: "Հակահիպերտենզիվ դեղորայքին չհետևելու գնահատված մակարդակը մեծ մետավերլուծության մեջ։",
      en: "Estimated non-adherence to antihypertensive medication in a large meta-analysis.",
    },
    ref: 4,
  },
  {
    value: "~50%",
    pct: 50,
    fill: "var(--status-danger-fg)",
    body: {
      hy: "Դեղորայքի ընդհատումը մոտենում է 50%-ի առաջին հակահիպերտենզիվ նշանակումից երկու տարվա ընթացքում։",
      en: "Medication discontinuation approaches 50% within two years after the first antihypertensive prescription.",
    },
    ref: 4,
  },
  {
    value: "31%",
    pct: 31,
    fill: "var(--status-warning-fg)",
    body: {
      hy: "Աշխարհի մեծահասակների գրեթե մեկ երրորդը, մոտավորապես 1,8 միլիարդ մարդ, չի հասնում ֆիզիկական ակտիվության խորհուրդ տրվող մակարդակին։",
      en: "Nearly one-third of adults worldwide, around 1.8 billion people, do not achieve recommended levels of physical activity.",
    },
    ref: 5,
  },
  {
    value: "2×+",
    pct: 100,
    fill: "var(--status-warning-fg)",
    body: {
      hy: "Աղի համաշխարհային միջին սպառումը կազմում է օրական մոտ 11 գ, ինչը ավելի քան երկու անգամ գերազանցում է ԱՀԿ-ի՝ օրական 5 գ-ից պակասի խորհուրդը։ Նատրիումի ավելցուկը 2023 թվականին կապված է եղել մոտավորապես 1,7 միլիոն մահվան հետ։",
      en: "Average global salt intake is about 11 g a day, more than twice the WHO recommendation of less than 5 g. Excess sodium was associated with an estimated 1.7 million deaths in 2023.",
    },
    ref: 6,
  },
];

export function ActionGap() {
  const { t } = useMarketingLocale();

  return (
    <Band id="action-gap">
      <Heading
        eyebrow={{ hy: "05 · Գործողության բացը", en: "05 · The action gap" }}
        title={{
          hy: "Կանխարգելման կրիտիկական բացը կայուն կատարումն է։",
          en: "The critical gap in prevention is sustained execution.",
        }}
        lead={{
          hy: "Երբ սրտանոթային ռիսկը հայտնաբերված է, հաջորդ մարտահրավերը կայուն հետևողականությունն է՝ դեղորայքի, չափումների, ախտորոշման, ֆիզիկական ակտիվության, սննդակարգի և հսկողության ողջ ընթացքում։",
          en: "Once cardiovascular risk is identified, the next challenge is sustained adherence across medication, measurements, diagnostics, physical activity, nutrition and follow-up.",
        }}
      />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GAP.map((fact, i) => (
          <Card
            key={fact.value}
            className="rise"
            style={{ "--rise": i } as React.CSSProperties}
          >
            <p className="font-heading text-display3 text-[var(--text-strong)] tabular-nums tracking-tight">
              {fact.value}
              <Ref n={fact.ref} className="text-brand-gold-deep ml-0.5 text-[0.34em]" />
            </p>
            <Track pct={fact.pct} fill={fact.fill} className="my-4" />
            <p className="text-muted-foreground text-body2 text-pretty">
              {t(fact.body)}
            </p>
          </Card>
        ))}
      </div>

      {/* The section closes on a navy bar rather than a sentence, because this
          is the hinge of the page: everything above is the problem and
          everything below is the product, and the reader is being handed from
          one to the other. */}
      <div className="bg-surface-inverse text-on-inverse mt-10 flex flex-wrap items-center justify-between gap-6 rounded-3xl p-6 md:p-10">
        <p className="font-heading text-h2 md:text-display3 max-w-lg font-extrabold tracking-tight text-balance">
          {t({
            hy: "Մեկ համակարգը պետք է կապի ռիսկի հայտնաբերումը, գործողությունը, հետևողականությունը և չափելի փոփոխությունը։",
            en: "One system should connect risk detection, action, adherence and measurable change.",
          })}
        </p>
        <Button
          size="lg"
          variant="secondary"
          className="press text-body1 h-auto min-h-13 w-full px-7 py-3 whitespace-normal sm:h-13 sm:w-auto sm:py-0"
          nativeButton={false}
          render={<Link href="/#dashboards" />}
        >
          {t({ hy: "Տեսնել վահանակներում", en: "See it in the dashboards" })}
          <ArrowRightIcon aria-hidden />
        </Button>
      </div>
    </Band>
  );
}
