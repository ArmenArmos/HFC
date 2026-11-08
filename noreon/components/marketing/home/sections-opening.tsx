"use client";

import {
  ActivityIcon,
  CheckIcon,
  ClockIcon,
  HeartIcon,
  LandmarkIcon,
  ShieldCheckIcon,
  UserIcon,
  BuildingIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { HeroDashboard } from "@/components/marketing/home/dashboard-preview";
import {
  ArrowLink,
  Band,
  Card,
  Closer,
  Heading,
  InverseCard,
  Shell,
} from "@/components/marketing/home/primitives";
import { Ref } from "@/components/marketing/home/sources";
import { Button } from "@/components/ui/button";
import { useMarketingLocale } from "@/components/marketing/locale";
import { MEMBER_APP_URL } from "@/lib/marketing/links";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * Sections 01 to 03: the hero, who the platform is for, and the evidence that
 * sets up everything after it.
 *
 * The order is the argument. Cardiovascular disease is the biggest killer and
 * most of it is preventable, so the problem is not knowledge. The problem is
 * that once risk is found, almost nothing carries the person from a
 * recommendation to a sustained change. That is the gap this product is built
 * around, and the page has to establish it with cited evidence before it is
 * allowed to show a single screen of software.
 *
 * Every figure in the reality section is somebody else's published finding and
 * carries a marker back to `sources.tsx`. None of them is a Noreon outcome,
 * because there is no Noreon outcome data yet.
 */

// ---------------------------------------------------------------------------
// 01 — Hero
// ---------------------------------------------------------------------------

/** The two things the hero is allowed to claim before the argument starts. */
const PROMISES: { title: LocalizedHyEn; body: LocalizedHyEn }[] = [
  {
    title: {
      hy: "Սրտանոթային առողջությունն առաջինը։",
      en: "Cardiovascular health first.",
    },
    body: {
      hy: "Շարունակական կանխարգելումը՝ ի սկզբանե։",
      en: "Continuous prevention by design.",
    },
  },
  {
    title: { hy: "Մշակված մասնագետների հետ", en: "Designed with specialists" },
    body: {
      hy: "Ուղեցույցների վրա հիմնված կլինիկական տրամաբանություն",
      en: "Guideline-based clinical logic",
    },
  },
];

export function Hero() {
  const { t } = useMarketingLocale();

  return (
    <section
      id="top"
      className="bg-surface-inverse-deep text-on-inverse relative isolate overflow-hidden"
    >
      {/* The hero's light source. It is the same radial the navy Panel uses,
          pulled to the top right where the dashboard card leaves the ground
          empty, so the band has a direction rather than reading as a printed
          rectangle. */}
      <span
        aria-hidden
        className="breathe pointer-events-none absolute -top-1/4 right-0 -z-10 aspect-square w-3/4"
        style={{ backgroundImage: "var(--panel-glow)" }}
      />

      {/* `min-w-0` on both children, because a grid item's automatic minimum is
          its min-content width: one `whitespace-nowrap` button inside is enough
          to widen the column past the viewport and set the whole document
          scrolling sideways on a phone. */}
      <Shell className="grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14 lg:py-28">
        <div className="rise-group min-w-0">
          <p className="text-overline text-brand-mint ring-on-inverse/20 bg-on-inverse/5 rounded-pill inline-flex items-center gap-2.5 px-4 py-2 ring-1">
            <span
              className="bg-brand-mint size-1.5 shrink-0 animate-pulse rounded-full"
              aria-hidden
            />
            {t({
              hy: "Կանխարգելիչ առողջության ենթակառուցվածք",
              en: "Preventive health infrastructure",
            })}
          </p>

          <h1 className="text-h1 sm:text-display3 md:text-display2 lg:text-display1 mt-6 font-extrabold tracking-tight text-balance break-words">
            {t({
              hy: "Մեկ համակարգ։ Ռիսկի հայտնաբերումից մինչև կայուն փոփոխություն։",
              en: "One system. From risk detection to lasting change.",
            })}
          </h1>

          <p className="text-on-inverse-muted text-body1 md:text-h3 mt-6 max-w-xl text-pretty md:font-normal">
            {t({
              hy: "Սրտանոթային կանխարգելման շարունակական հարթակ, որը կապում է ռիսկի գնահատումը, ախտորոշումը, կլինիկական ուղղորդումը, միացված սարքերը, վարքի փոփոխությունը և մոնիտորինգը, որպեսզի ամեն հայտնաբերված ռիսկ հանգեցնի կայուն գործողության և չափելի առաջընթացի։",
              en: "A continuous cardiovascular prevention platform connecting risk assessment, diagnostics, clinical guidance, connected devices, behaviour change and monitoring, so every detected risk can lead to sustained action and measurable progress.",
            })}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {/* `whitespace-nowrap` is baked into the button variant, and these
                labels are longer in Armenian than in English. Below `sm` they
                wrap and take the full column instead of setting the page
                scrolling sideways. */}
            <Button
              variant="outline-inverse"
              size="lg"
              className="press text-body1 h-auto min-h-13 w-full px-6 py-3 whitespace-normal sm:h-13 sm:w-auto sm:py-0 sm:whitespace-nowrap"
              nativeButton={false}
              render={<Link href="/#action-gap" />}
            >
              {t({ hy: "Ծանոթանալ գործողության բացին", en: "Explore the action gap" })}
            </Button>
          </div>

          <ul className="border-on-inverse/16 mt-10 flex flex-wrap gap-x-11 gap-y-6 border-t pt-7">
            {PROMISES.map((promise) => (
              <li key={promise.title.en}>
                <p className="font-heading text-body1 flex items-center gap-2 font-bold">
                  <CheckIcon className="text-brand-mint size-4 shrink-0" aria-hidden />
                  {t(promise.title)}
                </p>
                <p className="text-on-inverse-muted text-caption mt-1">
                  {t(promise.body)}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rise min-w-0" style={{ "--rise": 3 } as React.CSSProperties}>
          <HeroDashboard />
        </div>
      </Shell>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 02 — Audience
// ---------------------------------------------------------------------------

const AUDIENCES: {
  id: string;
  icon: typeof BuildingIcon;
  title: LocalizedHyEn;
  body: LocalizedHyEn;
  cta: LocalizedHyEn;
  href: Route;
}[] = [
  {
    id: "organizations",
    icon: BuildingIcon,
    title: {
      hy: "Բիզնեսների և ապահովագրողների համար",
      en: "For businesses and insurers",
    },
    body: {
      hy: "Հայտնաբերեք ռիսկն ավելի վաղ, բարելավեք հետևողականությունը և օգնեք անդամներին ձեռնարկել այն քայլերը, որոնք նվազեցնում են կանխարգելելի առողջական ռիսկերը։",
      en: "Identify risk earlier, improve follow-through, and help members take the actions that reduce preventable health risks.",
    },
    cta: { hy: "Տեսնել գործողության բացը", en: "See the action gap" },
    href: "/#action-gap",
  },
  {
    id: "government",
    icon: LandmarkIcon,
    title: { hy: "Կառավարությունների համար", en: "For governments" },
    body: {
      hy: "Վերածեք բնակչության սքրինինգը ռիսկի շարունակական կառավարման, հսկողության և չափելի կանխարգելիչ գործողության։",
      en: "Turn population screening into continuous risk management, follow-up and measurable preventive action.",
    },
    cta: { hy: "Տեսնել բնակչության վահանակը", en: "See the population dashboard" },
    href: "/#dashboards",
  },
  {
    id: "individuals",
    icon: UserIcon,
    title: { hy: "Անհատների համար", en: "For individuals" },
    body: {
      hy: "Իմացեք ձեր ռիսկերը, հասկացեք՝ ինչ անել հաջորդը, և ստացեք գործնական աջակցություն, որ իրականում անեք դա։",
      en: "Know your risks, understand what to do next, and get practical support to actually do it.",
    },
    cta: { hy: "Բացել հավելվածը", en: "Open the app" },
    // The only card that leaves the page: it opens the member app's sign-in.
    href: MEMBER_APP_URL as Route,
  },
];

export function Audience() {
  const { t } = useMarketingLocale();

  return (
    <Band id="organizations">
      <Heading
        eyebrow={{ hy: "02 · Մեկ էկոհամակարգ", en: "02 · One ecosystem" }}
        title={{
          hy: "Կանխարգելման մեկ էկոհամակարգ։ Կառուցված մարդու շուրջ։",
          en: "One prevention ecosystem. Built around the person.",
        }}
        lead={{
          hy: "Հարթակը կապում է գործատուներին, ապահովագրողներին, բուժհաստատություններին և հանրային առողջապահական համակարգերը կանխարգելման մեկ շարունակական ճանապարհի շուրջ, միաժամանակ տալով յուրաքանչյուր մարդու մեկ պարզ տեղ՝ հասկանալու և կառավարելու իր առողջությունը։",
          en: "The platform connects employers, insurers, healthcare providers and public-health systems around one continuous prevention journey, while giving every person one simple place to understand and manage their health.",
        }}
      />

      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {AUDIENCES.map((audience, i) => (
          <Card
            key={audience.id}
            id={audience.id === "government" ? "government" : undefined}
            className="rise flex scroll-mt-20 flex-col"
            style={{ "--rise": i } as React.CSSProperties}
          >
            <span
              className="bg-surface-subtle-teal text-[var(--noreon-teal-800)] grid size-13 shrink-0 place-items-center rounded-xl"
              aria-hidden
            >
              <audience.icon className="size-6" />
            </span>
            <h3 className="text-h3 md:text-h2 mt-5 text-balance">{t(audience.title)}</h3>
            <p className="text-muted-foreground text-body1 mt-3 flex-1 text-pretty">
              {t(audience.body)}
            </p>
            <ArrowLink href={audience.href} className="mt-4">
              {t(audience.cta)}
            </ArrowLink>
          </Card>
        ))}
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 03 — The reality
// ---------------------------------------------------------------------------

/**
 * The four tints a figure's medallion can take on the navy ground.
 *
 * They are not decoration: the hue says which kind of fact this is. Teal is the
 * measurement, red is the loss, green is the part that is preventable, gold is
 * the part that is being missed. Written out as whole class strings because
 * Tailwind reads source text, not composed strings.
 */
const TONE = {
  teal: "bg-brand-teal/20 text-brand-mint",
  danger: "bg-destructive/25 text-[var(--noreon-danger-400)]",
  success: "bg-[var(--status-success-fg)]/25 text-[var(--noreon-teal-300)]",
  gold: "bg-brand-gold/20 text-brand-gold-light",
} as const;

const REALITY: {
  value: string;
  icon: typeof ActivityIcon;
  tone: "teal" | "danger" | "success" | "gold";
  body: LocalizedHyEn;
  ref: number;
}[] = [
  {
    value: "No. 1",
    icon: ActivityIcon,
    tone: "teal",
    body: {
      hy: "Սրտանոթային հիվանդությունները մահվան առաջատար պատճառն են աշխարհում։",
      en: "Cardiovascular disease is the leading cause of death worldwide.",
    },
    ref: 1,
  },
  {
    value: "19.8M",
    icon: HeartIcon,
    tone: "danger",
    body: {
      hy: "Մարդ մահացել է սրտանոթային հիվանդություններից 2022 թվականին, ինչը համաշխարհային բոլոր մահերի մոտավորապես 32%-ն է։",
      en: "People died from cardiovascular disease in 2022, approximately 32% of all deaths globally.",
    },
    ref: 1,
  },
  {
    value: "80%",
    icon: ShieldCheckIcon,
    tone: "success",
    body: {
      hy: "Համաշխարհային սրտի ֆեդերացիան նշում է, որ սրտանոթային հիվանդություններից մահերի 80%-ը կանխարգելելի է։",
      en: "The World Heart Federation states that 80% of cardiovascular disease deaths are preventable.",
    },
    ref: 2,
  },
  {
    value: "77%",
    icon: ClockIcon,
    tone: "gold",
    body: {
      hy: "Զարկերակային գերճնշում ունեցող մեծահասակների 77%-ի մոտ այն վերահսկվում չէ։",
      en: "77% of adults with hypertension do not have it under control.",
    },
    ref: 3,
  },
];

/**
 * The first dark band on the page.
 *
 * Navy is the brand's authority colour and this is the section that has to
 * carry authority: four numbers, no illustration, nothing to look at except the
 * scale of the problem. A photograph here would soften it, which is the
 * opposite of what the section is for.
 */
export function Reality() {
  const { t } = useMarketingLocale();

  return (
    <Band id="reality" tone="inverse">
      <Heading
        inverse
        eyebrow={{ hy: "03 · Իրողությունը", en: "03 · The reality" }}
        title={{
          hy: "Սրտանոթային հիվանդությունն աշխարհի ամենամեծ մարդասպանն է։ Դրա մեծ մասը կանխարգելելի է։",
          en: "Cardiovascular disease is the world's biggest killer. Much of it is preventable.",
        }}
      />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {REALITY.map((fact, i) => (
          <InverseCard
            key={fact.value}
            className="rise"
            style={{ "--rise": i } as React.CSSProperties}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-11 place-items-center rounded-xl",
                TONE[fact.tone],
              )}
            >
              <fact.icon className="size-5.5" />
            </span>
            <p className="font-heading text-display3 md:text-display2 mt-5 tabular-nums tracking-tight">
              {fact.value}
              {/* A citation marker rides at 0.65em of its line by default,
                  which is a readable size beside body text and a 32px numeral
                  beside a display figure. On these four it takes a third. */}
              <Ref
                n={fact.ref}
                className="text-brand-gold-light hover:text-on-inverse ml-0.5 text-[0.32em]"
              />
            </p>
            <p className="text-on-inverse-muted text-body2 mt-3 text-pretty">
              {t(fact.body)}
            </p>
          </InverseCard>
        ))}
      </div>

      <Closer inverse>
        {t({
          hy: "Խնդիրն այն չէ, որ մենք ոչինչ չգիտենք սրտանոթային ռիսկի մասին։ Հնարավորությունն այն է, որ կանխարգելումը տեղի ունենա հետևողականորեն, մինչև ռիսկը հիվանդություն դառնա։",
          en: "The problem is not that we know nothing about cardiovascular risk. The opportunity is to make prevention happen consistently, before risk becomes disease.",
        })}
      </Closer>
    </Band>
  );
}
