"use client";

import { useId, useState } from "react";

import {
  MemberDashboard,
  PopulationDashboard,
} from "@/components/marketing/home/dashboard-preview";
import { Band, Heading } from "@/components/marketing/home/primitives";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * Sections 06 to 08: the product itself.
 *
 * This is the half of the page the first five sections earn the right to show.
 * The order inside it is deliberate too: the dashboards come first because the
 * argument just made was about visibility, then the reason the product is
 * cardiovascular rather than general, then the part that does the carrying
 * between visits.
 *
 * Every screen in here is invented and every screen says so.
 */

// ---------------------------------------------------------------------------
// 06 — Dashboards
// ---------------------------------------------------------------------------

/**
 * The two dashboards, behind a switch.
 *
 * Both views are shown on one section rather than two, because the claim is
 * that they are the same system seen from two sides. Side by side they would
 * each be half-size and neither would be legible; stacked they would read as
 * two products.
 *
 * It is a real tab list, so the arrow keys work and a screen reader is told
 * which panel it is on.
 */
export function Dashboards() {
  const { t } = useMarketingLocale();
  const [tab, setTab] = useState<"member" | "org">("member");
  const id = useId();

  const TABS = [
    { key: "member" as const, label: { hy: "Անդամի վահանակ", en: "Member dashboard" } },
    {
      key: "org" as const,
      label: {
        hy: "Կազմակերպության և բնակչության վահանակ",
        en: "Organisation and population dashboard",
      },
    },
  ];

  return (
    <Band id="dashboards" tone="card">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Heading
          eyebrow={{ hy: "06 · Վահանակներ", en: "06 · Dashboards" }}
          title={{
            hy: "Տեսեք սրտանոթային ռիսկը, քայլերը և առաջընթացը մեկ պատկերում։",
            en: "See cardiovascular risk, actions and progress in one view.",
          }}
        />

        <div
          role="tablist"
          aria-label={t({ hy: "Վահանակի տեսքը", en: "Dashboard view" })}
          /* Not `shrink-0`. "Կազմակերպություն" is one unbreakable 16-character
             word, and a rigid pill around it is 288px wide at its minimum,
             which is wider than the content column on a 320px phone. Below
             `sm` the switch takes the full row and the two buttons share it. */
          className="bg-card rounded-pill flex w-full min-w-0 gap-1 p-1.5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--border-subtle)] sm:w-auto"
        >
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`${id}-${item.key}-tab`}
              aria-selected={tab === item.key}
              aria-controls={`${id}-${item.key}-panel`}
              onClick={() => setTab(item.key)}
              className={cn(
                "press text-body2 rounded-pill min-h-11 min-w-0 flex-1 px-4 font-medium break-words transition-colors sm:flex-none sm:px-5",
                tab === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-body1 mt-5 max-w-4xl text-pretty">
        {t({
          hy: "Վահանակները արտադրանքի հիմնական մակերեսն են, ոչ թե երկրորդային հաշվետվություն։ Դրանք տեսանելի են դարձնում կապը ռիսկի, առաջարկվող քայլերի, իրական վարքի և առողջական փոփոխությունների միջև՝ ժամանակի ընթացքում։",
          en: "Dashboards are a primary product surface, not a secondary reporting feature. They make the relationship between risk, recommended actions, actual behaviour and health changes visible over time.",
        })}
      </p>

      <div className="mt-9">
        <div
          role="tabpanel"
          id={`${id}-member-panel`}
          aria-labelledby={`${id}-member-tab`}
          hidden={tab !== "member"}
        >
          {tab === "member" && <MemberDashboard />}
        </div>
        <div
          role="tabpanel"
          id={`${id}-org-panel`}
          aria-labelledby={`${id}-org-tab`}
          hidden={tab !== "org"}
        >
          {tab === "org" && <PopulationDashboard />}
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 07 — Cardiovascular focus
// ---------------------------------------------------------------------------

/**
 * The nine factors, placed around the hub.
 *
 * The positions are percentages of the square the figure is drawn in rather
 * than computed from an angle, because the labels are different lengths in the
 * two languages and an evenly spaced ring collides with itself. They are hand
 * placed so nothing overlaps in either.
 */
const FACTORS: { label: LocalizedHyEn; left: string; top: string }[] = [
  { label: { hy: "Զարկերակային ճնշում", en: "Blood pressure" }, left: "50%", top: "8%" },
  { label: { hy: "LDL և խոլեստերին", en: "LDL and cholesterol" }, left: "81%", top: "18%" },
  { label: { hy: "Գլյուկոզա", en: "Glucose" }, left: "93%", top: "42%" },
  { label: { hy: "Քաշ", en: "Weight" }, left: "85%", top: "70%" },
  { label: { hy: "Ակտիվություն", en: "Activity" }, left: "64%", top: "90%" },
  { label: { hy: "Քուն", en: "Sleep" }, left: "36%", top: "90%" },
  { label: { hy: "Ծխելը", en: "Smoking" }, left: "15%", top: "70%" },
  { label: { hy: "Դեղորայք", en: "Medication" }, left: "7%", top: "42%" },
  { label: { hy: "Ընտանեկան պատմություն", en: "Family history" }, left: "19%", top: "18%" },
];

/** The nine spokes, as endpoints in the figure's own 100x100 units. */
const SPOKES = [
  [50, 13],
  [74, 21],
  [86, 42],
  [82, 68],
  [64, 85],
  [36, 85],
  [18, 68],
  [14, 42],
  [26, 21],
];

export function CardiovascularFocus() {
  const { t } = useMarketingLocale();

  return (
    <Band id="focus">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <Heading
            eyebrow={{ hy: "07 · Կլինիկական ֆոկուս", en: "07 · Clinical focus" }}
            title={{
              hy: "Սրտանոթային ռիսկն արտացոլում է բազմաթիվ գործոնների կուտակային ազդեցությունը։",
              en: "Cardiovascular risk reflects the cumulative impact of multiple health factors.",
            }}
            lead={{
              hy: "Սրտանոթային հիվանդությունը հազվադեպ է զարգանում մեկուսացված։ Ճնշումը, խոլեստերինը, գլյուկոզան, քաշը, ֆիզիկական ակտիվությունը, ծխելը, քունը, դեղորայքին հետևելը և այլ գործոններ տարիներ շարունակ փոխազդում են։",
              en: "Cardiovascular disease rarely develops in isolation. Blood pressure, cholesterol, glucose, weight, physical activity, smoking, sleep, medication adherence and other factors interact over years.",
            }}
          />
          <p className="text-muted-foreground text-body1 mt-4 max-w-3xl text-pretty">
            {t({
              hy: "Այս ազդանշանները հավաքվում են միասին, որպեսզի սրտանոթային ռիսկը կառավարվի իր համատեքստում և գործողությունն ուղղվի հենց այն գործոններին, որոնք այդ ռիսկը բարձրացնում են։",
              en: "These signals are brought together so cardiovascular risk is managed in context, and so action goes to the factors actually driving that risk.",
            })}
          </p>
          <p className="font-heading text-h3 md:text-h2 text-[var(--text-strong)] mt-6 font-bold tracking-tight text-pretty">
            {t({
              hy: "Սրտանոթային կանխարգելումը հարթակի առաջին կլինիկական ֆոկուսն է, ոչ թե նրա սահմանը։",
              en: "Cardiovascular prevention is the first clinical focus, not the boundary of the platform.",
            })}
          </p>
        </div>

        {/* The figure keeps its own scroller: nine pill labels around a hub have
            a minimum width that a 320px phone does not have, and below it they
            would stack on top of each other rather than shrink. */}
        <div className="min-w-0 overflow-x-auto">
          <div className="relative mx-auto aspect-square w-full max-w-130 min-w-105">
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 size-full"
              aria-hidden
            >
              <circle
                cx="50"
                cy="50"
                r="37"
                fill="none"
                stroke="var(--border-default)"
                strokeWidth=".7"
              />
              <circle
                cx="50"
                cy="50"
                r="26"
                fill="none"
                stroke="var(--border-subtle)"
                strokeWidth=".7"
              />
              <g stroke="var(--border-default)" strokeWidth=".6">
                {SPOKES.map(([x, y]) => (
                  <line key={`${x}-${y}`} x1="50" y1="50" x2={x} y2={y} />
                ))}
              </g>
            </svg>

            <div className="bg-surface-inverse text-on-inverse absolute top-1/2 left-1/2 flex aspect-square w-[37%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full p-2.5 text-center shadow-[var(--shadow-lg)]">
              <svg viewBox="0 0 26 22" className="w-7" aria-hidden>
                <path
                  d="M1 11h5l2.4-6 3.4 12 2.8-7 1.9 4H25"
                  fill="none"
                  stroke="var(--noreon-teal-300)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="font-heading text-caption mt-2 font-extrabold tracking-wide text-balance">
                {t({ hy: "Սրտանոթային ռիսկ", en: "Cardiovascular risk" })}
              </p>
              <p className="text-on-inverse-muted text-caption">
                {t({ hy: "համատեքստում", en: "in context" })}
              </p>
            </div>

            <ul>
              {FACTORS.map((factor) => (
                <li
                  key={factor.label.en}
                  style={{ left: factor.left, top: factor.top }}
                  className="bg-card text-body2 rounded-pill press absolute -translate-x-1/2 -translate-y-1/2 px-4 py-2.5 whitespace-nowrap shadow-[var(--shadow-md)] ring-1 ring-[var(--border-subtle)] transition-[box-shadow,border-color] hover:ring-[var(--noreon-teal-600)]"
                >
                  {t(factor.label)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 08 — Meet Zoe
// ---------------------------------------------------------------------------

/**
 * The exchange shown on the homepage.
 *
 * It is four turns and it ends on a plan, not on reassurance. Zoe is allowed to
 * explain a number, place it against the rest of the record and name the next
 * two things; she is not allowed to diagnose, prescribe or promise an outcome,
 * and neither is this transcript.
 */
const CONVERSATION: { from: "member" | "zoe" | "record"; text?: LocalizedHyEn }[] = [
  {
    from: "member",
    text: {
      hy: "Իմ LDL-ը վերադարձավ 4.2։ Ի՞նչ է դա իրականում նշանակում ինձ համար։",
      en: "My LDL came back at 4.2. What does that actually mean for me?",
    },
  },
  {
    from: "zoe",
    text: {
      hy: "Այն բարձր է ձեր բժշկի սահմանած թիրախից՝ 2.6 մմոլ/լ, և հենց այս ցուցանիշն է ամենաշատը կշռում ձեր 10-ամյա ռիսկի վրա հիմա։ Ձեր ճնշումն արդեն շարժվում է ճիշտ ուղղությամբ, ուստի սա այն մեկն է, որից արժե սկսել։",
      en: "It is above the target your clinician set, 2.6 mmol/L, and it is the factor weighing most on your 10-year risk right now. Your blood pressure is already moving in the right direction, so this is the one to start with.",
    },
  },
  { from: "record" },
  {
    from: "member",
    text: { hy: "Ի՞նչ անեմ այս շաբաթ։", en: "What should I do this week?" },
  },
  {
    from: "zoe",
    text: {
      hy: "Երեք բան։ Պահեք 08:00-ի դեղորայքը, ամրագրեք լիպիդային վահանակի կրկնությունը, որը 11 օրից է, և ավելացրեք մեկ 25-րոպեանոց քայլք՝ 150 րոպեին հասնելու համար։ Հինգշաբթի կստուգեմ՝ ինչպես է ընթանում։",
      en: "Three things. Keep the 08:00 medication, book the lipid panel repeat that is due in 11 days, and add one 25-minute walk to reach 150 minutes. I will check in on Thursday.",
    },
  },
];

/** The three lines Zoe's answer is standing on, quoted from the record. */
const FROM_RECORD: { label: LocalizedHyEn; value: string; flag?: boolean }[] = [
  { label: { hy: "LDL-C", en: "LDL-C" }, value: "4.2 mmol/L", flag: true },
  { label: { hy: "Տնային ՃՃ · 7 օր", en: "Home BP · 7-day" }, value: "128/81" },
  {
    label: { hy: "Ընտանեկան պատմություն", en: "Family history" },
    value: "Early CVD, father",
  },
];

export function Zoe() {
  const { t } = useMarketingLocale();

  return (
    <Band id="zoe" tone="deep">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <Heading
            inverse
            eyebrow={{ hy: "08 · Ծանոթացեք Զոյի հետ", en: "08 · Meet Zoe" }}
            title={{
              hy: "Ծանոթացեք Զոյի հետ։ Ձեր ԱԲ առողջության մարզիչը բժշկական այցերի միջև։",
              en: "Meet Zoe. Your AI health coach between medical visits.",
            }}
            lead={{
              hy: "Բժշկական առաջարկություններն օգտակար են միայն այն ժամանակ, երբ մարդիկ հասկանում են դրանք և գործում։ Զոն բարդ առողջական տեղեկությունը վերածում է ամենօրյա գործնական ուղղորդման՝ հասկանալ արդյունքը, իմանալ՝ ինչն է կարևոր այսօր, պատրաստվել խորհրդատվությանը և հետևել սննդակարգին, ակտիվությանը, քնին, չափումներին և հսկողությանը։",
              en: "Medical recommendations are useful only when people understand and act on them. Zoe turns complex health information into practical everyday guidance: understanding a result, knowing what matters today, preparing for a consultation, and following through on nutrition, activity, sleep, measurements and follow-up.",
            }}
          />

          <p className="text-on-inverse-muted text-body2 mt-5 max-w-3xl text-pretty">
            {t({
              hy: "Զոն աշխատում է հարթակի կլինիկական գիտելիքի շերտի, ընդունված ուղեցույցների, գրախոսված ապացույցների և վարքագիտության սկզբունքների սահմաններում։ Բժշկական տրամաբանությունը մշակվում է առաջատար մասնագետների հետ և շարունակաբար հսկվում ու զարգացվում է նրանց հետ։",
              en: "Zoe operates within the platform's clinical knowledge layer, established guidelines, peer-reviewed evidence and behavioural-science principles. The medical logic is designed with leading specialists and continuously monitored and developed with them.",
            })}
          </p>

          <p className="font-heading text-h3 md:text-h2 mt-6 font-bold tracking-tight text-pretty">
            {t({
              hy: "ԱԲ-ն չի փոխարինում բժշկական օգնությանը։ Այն կանխարգելումը դարձնում է ավելի հասկանալի և ավելի հեշտ հետևելի։",
              en: "AI does not replace medical care. It makes prevention easier to understand and easier to follow.",
            })}
          </p>
        </div>

        {/* The conversation sits on a white card on the navy ground, because the
            claim is that the answer is grounded in this member's actual numbers.
            A chat bubble with no record next to it is a chatbot. */}
        <div className="bg-card text-foreground min-w-0 rounded-3xl p-4 shadow-[var(--shadow-lg)] sm:p-6">
          <div className="flex items-center gap-3 border-b pb-4">
            <span
              className="font-heading bg-brand-teal text-on-inverse grid size-9 shrink-0 place-items-center rounded-full font-extrabold"
              aria-hidden
            >
              Z
            </span>
            <div>
              <p className="font-heading text-[var(--text-strong)] text-body1 font-bold">
                Zoe
              </p>
              <p className="text-caption text-[var(--status-success-fg)] font-medium">
                {t({
                  hy: "Միացված է ձեր առողջական գրառմանը",
                  en: "Connected to your health record",
                })}
              </p>
            </div>
          </div>

          <ol className="mt-4 grid gap-3">
            {CONVERSATION.map((turn, i) =>
              turn.from === "record" ? (
                <li
                  key="record"
                  className="bg-card max-w-[88%] rounded-xl p-4 ring-1 ring-[var(--border-subtle)]"
                >
                  <p className="text-overline text-muted-foreground">
                    {t({ hy: "Ձեր գրառումից", en: "From your record" })}
                  </p>
                  <dl className="text-body2 mt-2.5 grid gap-2">
                    {FROM_RECORD.map((row) => (
                      <div key={row.label.en} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t(row.label)}</dt>
                        <dd
                          className={cn(
                            "font-medium tabular-nums",
                            row.flag
                              ? "text-brand-gold-deep font-semibold"
                              : "text-[var(--text-strong)]",
                          )}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ) : (
                <li
                  key={turn.text?.en ?? i}
                  className={cn(
                    "text-body2 max-w-[88%] rounded-xl p-4 text-pretty",
                    turn.from === "member"
                      ? "bg-primary text-primary-foreground max-w-[82%] justify-self-end rounded-br-sm"
                      : "bg-surface-sunken rounded-bl-sm",
                  )}
                >
                  {t(turn.text!)}
                </li>
              ),
            )}
          </ol>

          {/* A drawing of the composer, not a composer. It is not a disabled
              input either: a disabled field in a screenshot invites a press that
              will never do anything. */}
          <p
            className="text-muted-foreground text-body2 rounded-pill mt-4 flex min-h-12 items-center px-5 ring-1 ring-[var(--border-subtle)]"
            aria-hidden
          >
            {t({
              hy: "Հարցրեք արդյունքի, դինամիկայի կամ այսօրվա ծրագրի մասին…",
              en: "Ask about a result, a trend or today's plan…",
            })}
          </p>
        </div>
      </div>
    </Band>
  );
}
