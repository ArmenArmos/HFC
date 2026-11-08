"use client";

import {
  ArrowUpRightIcon,
  DownloadIcon,
  EyeIcon,
  LockIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from "lucide-react";
import Image from "next/image";

import {
  Band,
  Closer,
  Heading,
  InverseCard,
  Shell,
} from "@/components/marketing/home/primitives";
import { REFERENCES } from "@/components/marketing/home/sources";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";

/**
 * Sections 09 to 11 and the close: the research fund, the editorial window,
 * the privacy commitment, and the two ways in.
 *
 * The last three sections are the ones a sceptical reader reaches after the
 * product has been shown, which is exactly when the questions are "who says
 * so", "what happens to my data" and "what do I do now". They are in that
 * order for that reason.
 */

// ---------------------------------------------------------------------------
// 09 — Science
// ---------------------------------------------------------------------------

const PRIORITIES: LocalizedHyEn[] = [
  { hy: "Սրտանոթային կանխարգելում", en: "Cardiovascular prevention" },
  {
    hy: "Դեղորայքին և չափումներին հետևողականություն",
    en: "Medication and measurement adherence",
  },
  { hy: "Վարքի փոփոխություն և սովորույթի ձևավորում", en: "Behaviour change and habit formation" },
  { hy: "Ժամանակին հարմարվող միջամտություններ", en: "Just-in-time adaptive interventions" },
  { hy: "Կրելի և միացված բժշկական սարքեր", en: "Wearables and connected medical devices" },
  { hy: "Երկարաժամկետ ռիսկի ազդանշաններ", en: "Longitudinal risk signals" },
  { hy: "Ներգրավվածությունը կանխարգելիչ խնամքում", en: "Preventive-care engagement" },
  { hy: "Իրական աշխարհի ապացույցներ", en: "Real-world evidence" },
];

export function Science() {
  const { t } = useMarketingLocale();

  return (
    <Band id="science" tone="card">
      <div className="grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
        <div className="min-w-0">
          <Heading
            eyebrow={{ hy: "09 · Գիտություն", en: "09 · Science" }}
            title={{
              hy: "Ֆինանսավորել ավելի լավ կանխարգելման գիտությունը։",
              en: "Funding the science of better prevention.",
            }}
            lead={{
              hy: "Կանխարգելիչ բժշկությունը դեռ ունի մեծ անպատասխան հարցեր, հատկապես հետևողականության, վարքի կայուն փոփոխության, երկարաժամկետ ռիսկի և այն բանի շուրջ, թե ինչպես պետք է թվային միջամտություններն աշխատեն իրական կյանքում։",
              en: "Preventive medicine still has major unanswered questions, especially around adherence, sustained behaviour change, longitudinal risk, and how digital interventions should work in real life.",
            }}
          />
          <p className="text-muted-foreground text-body1 mt-5 max-w-3xl text-pretty">
            {t({
              hy: "Գիտական հիմնադրամը ստեղծվել է կանխարգելիչ բժշկության և վարքի փոփոխության ապացույցները արագացնելու համար։ Այն վեր է հանում բարձր արժեք ունեցող հետազոտական հարցեր, միավորում հետազոտական թիմեր, ֆինանսավորում ուսումնասիրություններ և համակարգում համագործակցությունը այն ոլորտներում, որտեղ ավելի լավ ապացույցները կարող են բարելավել կանխարգելումը։",
              en: "The Science Fund is created to accelerate evidence in preventive medicine and behaviour change. It identifies high-value research questions, brings together research teams, funds studies, and helps orchestrate collaboration around areas where better evidence can improve prevention.",
            })}
          </p>
          <Closer>
            {t({
              hy: "Նպատակը պարզ է. ավելի լավ ապացույցներ ստեղծել այն մասին, թե ինչպես է կանխարգելումն իրականում աշխատում կլինիկայից դուրս։",
              en: "The purpose is simple: generate better evidence for how prevention actually works outside the clinic.",
            })}
          </Closer>
        </div>

        {/* A ruled list rather than eight cards. Eight boxes would read as eight
            programmes that exist; a list reads as the agenda it actually is. */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 border-b pb-3">
            <p className="text-overline text-muted-foreground">
              {t({ hy: "Առաջնահերթ ուղղություններ", en: "Priority areas" })}
            </p>
            <p className="font-heading text-muted-foreground text-caption font-bold tabular-nums">
              08
            </p>
          </div>
          <ol className="grid sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-1">
            {PRIORITIES.map((area, i) => (
              <li
                key={area.en}
                className="text-body1 flex items-baseline gap-3 border-b py-4 transition-[padding,color] hover:pl-1.5 hover:text-[var(--noreon-teal-800)]"
              >
                <span className="font-heading text-brand-gold-deep text-caption shrink-0 font-bold tracking-wider tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {t(area)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 10 — Insights
// ---------------------------------------------------------------------------

/**
 * The three insights shown on the homepage.
 *
 * Three, not a feed. The brief is explicit that the homepage keeps a window on
 * this rather than becoming a news site, and the discipline is useful: three
 * slots means each one has to earn its place.
 *
 * Each card is built on a source already cited on this page, and each one is
 * written to the same shape the editorial destination uses: what happened, how
 * strong the finding is, and a link to the original. No headline here says more
 * than its source does, which is the whole point of the section.
 *
 * The photograph is the subject of the finding, not a stock picture of health.
 * `alt` describes the photograph; the headline beside it carries the meaning,
 * so repeating the headline in the alt text would read it twice.
 */
const INSIGHTS: {
  image: string;
  alt: LocalizedHyEn;
  topic: LocalizedHyEn;
  strength: LocalizedHyEn;
  headline: LocalizedHyEn;
  takeaway: LocalizedHyEn;
  when: LocalizedHyEn;
  ref: number;
}[] = [
  {
    image: "/marketing/insights/insight-adherence.webp",
    alt: {
      hy: "Մարդը տանը դեղորայք է դնում շաբաթական դեղատուփի մեջ",
      en: "A man filling a weekly pill box at home",
    },
    topic: { hy: "Վարքի փոփոխություն", en: "Behaviour change" },
    strength: {
      hy: "Գրախոսված ակնարկ, որը ամփոփում է մետավերլուծության տվյալները",
      en: "Peer-reviewed review summarising meta-analysis data",
    },
    headline: {
      hy: "Ճնշման դեղորայք սկսողների գրեթե կեսը դադարում է երկու տարվա ընթացքում",
      en: "Almost half of people starting a blood-pressure medicine stop within two years",
    },
    takeaway: {
      hy: "Դեղորայքի ընդհատումը մոտենում է 50%-ի առաջին հակահիպերտենզիվ նշանակումից երկու տարի անց, իսկ չհետևելու գնահատականները տատանվում են 27–40% սահմաններում։",
      en: "Discontinuation approaches 50% two years after a first antihypertensive prescription, and non-adherence estimates range from 27 to 40%.",
    },
    when: {
      hy: "European Journal of Preventive Cardiology, 2025",
      en: "European Journal of Preventive Cardiology, 2025",
    },
    ref: 4,
  },
  {
    image: "/marketing/insights/insight-wearable.webp",
    alt: {
      hy: "Կին, որը քնած է կրելի սարքով, կողքին՝ քնի տվյալների էկրան",
      en: "A woman asleep wearing a tracker, with a sleep-data screen beside her",
    },
    topic: { hy: "Ֆիզիկական ակտիվություն", en: "Physical activity" },
    strength: {
      hy: "ԱՀԿ-ի տեղեկատվական թերթիկ, համաշխարհային հսկողության տվյալներ",
      en: "WHO fact sheet, global surveillance data",
    },
    headline: {
      hy: "Մեծահասակների գրեթե մեկ երրորդը բավարար չի շարժվում",
      en: "Nearly a third of adults do not move enough",
    },
    takeaway: {
      hy: "Մոտավորապես 1,8 միլիարդ մեծահասակ չի հասնում ֆիզիկական ակտիվության խորհուրդ տրվող մակարդակին։ Ակտիվությունը այն քիչ գործոններից է, որը միաժամանակ ազդում է ճնշման, քաշի, գլյուկոզայի և քնի վրա։",
      en: "Around 1.8 billion adults do not reach recommended levels of physical activity. Activity is one of the few factors that moves blood pressure, weight, glucose and sleep at the same time.",
    },
    when: { hy: "ԱՀԿ, պարբերաբար թարմացվող", en: "WHO, updated periodically" },
    ref: 5,
  },
  {
    image: "/marketing/insights/insight-bp.webp",
    alt: {
      hy: "Կին, որը տանը չափում է իր զարկերակային ճնշումը",
      en: "A woman taking her own blood pressure at home",
    },
    topic: { hy: "Սննդակարգ", en: "Nutrition" },
    strength: {
      hy: "ԱՀԿ-ի տեղեկատվական թերթիկ, մոդելավորված համաշխարհային գնահատական",
      en: "WHO fact sheet, modelled global estimate",
    },
    headline: {
      hy: "Աղի սպառումը երկու անգամ գերազանցում է խորհուրդ տրվածը",
      en: "Salt intake is running at more than double the recommendation",
    },
    takeaway: {
      hy: "Համաշխարհային միջին սպառումը կազմում է օրական մոտ 11 գ՝ ԱՀԿ-ի 5 գ-ից պակաս խորհրդի դիմաց, և 2023 թվականին մոտ 1,7 միլիոն մահ կապված է եղել նատրիումի ավելցուկի հետ։",
      en: "Global mean intake is about 11 g a day against a WHO recommendation of less than 5 g, and an estimated 1.7 million deaths in 2023 were associated with excess sodium.",
    },
    when: { hy: "ԱՀԿ, պարբերաբար թարմացվող", en: "WHO, updated periodically" },
    ref: 6,
  },
];

export function Insights() {
  const { t } = useMarketingLocale();

  return (
    <Band id="insights" tone="inverse">
      <Heading
        inverse
        eyebrow={{ hy: "10 · Վերլուծություններ", en: "10 · Insights" }}
        title={{
          hy: "Գիտությունը, որն արժե իմանալ։ Առանց աղմուկի։",
          en: "The science worth knowing. Without the noise.",
        }}
        lead={{
          hy: "Ամեն օր նոր վերնագրեր են հայտնվում կանխարգելման, երկարակեցության, հավելումների, դիետաների, սարքերի և հետազոտությունների մասին։ Մարդկանց մեծ մասը, և որոշում կայացնողներից շատերը, ժամանակ չունեն օգտակար ապացույցը գովազդից տարանջատելու։",
          en: "Every day brings new headlines about prevention, longevity, supplements, diets, devices and medical research. Most people, and many decision makers, do not have time to separate useful evidence from hype.",
        }}
      />

      <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INSIGHTS.map((insight, i) => {
          const source = REFERENCES.find((r) => r.n === insight.ref);
          return (
            <li key={insight.headline.en}>
              <article
                className="rise bg-on-inverse/5 ring-on-inverse/14 hover:ring-brand-mint/50 hover:bg-on-inverse/9 flex h-full flex-col overflow-hidden rounded-2xl ring-1 transition-colors"
                style={{ "--rise": i } as React.CSSProperties}
              >
                <div className="bg-surface-inverse-deep border-on-inverse/12 relative aspect-video border-b">
                  <Image
                    src={insight.image}
                    alt={t(insight.alt)}
                    fill
                    sizes="(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <p className="text-overline flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-brand-mint">{t(insight.topic)}</span>
                    <span className="text-brand-gold-light">{t(insight.strength)}</span>
                  </p>
                  <h3 className="text-h3 mt-3 text-balance">{t(insight.headline)}</h3>
                  <p className="text-on-inverse-muted text-body2 mt-2 flex-1 text-pretty">
                    {t(insight.takeaway)}
                  </p>
                  <div className="border-on-inverse/12 mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <p className="text-on-inverse-muted text-caption">
                      {t(insight.when)}
                    </p>
                    {source && (
                      <a
                        href={source.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-mint hover:text-on-inverse text-caption inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                      >
                        {t({ hy: "Սկզբնաղբյուրը", en: "Original source" })}
                        <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <p className="text-on-inverse-muted mt-8 max-w-4xl text-body2 text-pretty">
        {t({
          hy: "Ոչ մի հրաշք պնդում։ Ոչ մի երկարակեցության գովազդ։ Սկզբնական ապացույցը կցվում է, երբ այն հասանելի է։ Ամեն հրապարակում պատասխանում է նույն հարցերին. ինչ տեղի ունեցավ, ինչ է ասում ապացույցը, որքան ամուր է այն, ինչն է դեռ անորոշ, և արդյոք դա փոխում է որևէ բան, որ մարդիկ պետք է անեն այսօր։",
          en: "No miracle claims. No longevity hype. The original evidence is linked whenever it is available. Every entry answers the same questions: what happened, what the evidence actually says, how strong the finding is, what is still uncertain, and whether it changes anything people should do today.",
        })}
      </p>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 11 — Privacy and trust
// ---------------------------------------------------------------------------

const PRIVACY: { icon: typeof LockIcon; title: LocalizedHyEn; body: LocalizedHyEn }[] = [
  {
    icon: ShieldIcon,
    title: { hy: "Վերահսկվող հասանելիություն", en: "Controlled access" },
    body: {
      hy: "Դերի վրա հիմնված հասանելիություն կլինիկական տվյալներին",
      en: "Role-based access to clinical data",
    },
  },
  {
    icon: LockIcon,
    title: { hy: "Անվտանգ մշակում", en: "Secure handling" },
    body: {
      hy: "Գաղտնագրում փոխանցման և պահման ժամանակ",
      en: "Encryption in transit and at rest",
    },
  },
  {
    icon: EyeIcon,
    title: { hy: "Հստակ համաձայնություն", en: "Clear consent" },
    body: {
      hy: "Բացահայտ և հետկանչելի կիսման ընտրություններ",
      en: "Explicit, revocable sharing choices",
    },
  },
  {
    icon: DownloadIcon,
    title: { hy: "Տվյալների տեղափոխելիություն", en: "Data portability" },
    body: { hy: "Դուք պահում եք ձեր սեփական գրառումը", en: "You keep your own record" },
  },
];

export function Privacy() {
  const { t } = useMarketingLocale();

  return (
    <Band id="privacy" tone="card">
      <Heading
        eyebrow={{ hy: "10 · Գաղտնիություն և վստահություն", en: "10 · Privacy and trust" }}
        title={{
          hy: "Ձեր առողջական տվյալները ձերն են։",
          en: "Your health data belongs to you.",
        }}
        lead={{
          hy: "Առողջական տեղեկությունը խորապես անձնական է։ Հարթակը կառուցված է բժշկական տեղեկության անվտանգ մշակման, հասանելիության վերահսկման և հստակ համաձայնության շուրջ, որպեսզի դուք հասկանաք, թե երբ է տեղեկությունը կիսվում, ինչու և ով կարող է այն տեսնել։",
          en: "Health information is deeply personal. The platform is designed around secure handling of medical information, controlled access and clear consent, so you understand when information is shared, why, and who can access it.",
        }}
      />

      <p className="font-heading text-h3 md:text-h2 text-[var(--text-strong)] mt-6 max-w-3xl font-bold tracking-tight text-pretty">
        {t({
          hy: "Նորեոն Հելթը երբեք չի կառուցի իր բիզնեսը անդամների առողջական տվյալները վաճառելու վրա։",
          en: "Noreon will never build its business around selling members' health information.",
        })}
      </p>

      {/* One bordered block subdivided by hairlines rather than four cards.
          These are four faces of a single commitment, and four separate cards
          would say they are four separate features. */}
      <ul className="bg-[var(--border-subtle)] mt-12 grid gap-px overflow-hidden rounded-2xl ring-1 ring-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
        {PRIVACY.map((item) => (
          <li key={item.title.en} className="bg-card p-6">
            <item.icon
              className="text-[var(--noreon-teal-800)] size-5.5 shrink-0"
              aria-hidden
            />
            <p className="font-heading text-[var(--text-strong)] text-body1 mt-3.5 font-bold">
              {t(item.title)}
            </p>
            <p className="text-muted-foreground text-body2 mt-1.5 text-pretty">
              {t(item.body)}
            </p>
          </li>
        ))}
      </ul>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// The close
// ---------------------------------------------------------------------------

export function FinalCta() {
  const { t } = useMarketingLocale();

  return (
    <section
      id="overview"
      className="bg-surface-inverse-deep text-on-inverse relative isolate scroll-mt-20 overflow-hidden py-20 md:py-28 lg:py-32"
    >
      <span
        aria-hidden
        className="breathe pointer-events-none absolute -top-1/4 right-0 -z-10 aspect-square w-3/4"
        style={{ backgroundImage: "var(--panel-glow)" }}
      />
      <Shell>
        <h2 className="text-display3 md:text-display2 lg:text-display1 max-w-2xl font-extrabold tracking-tight text-balance break-words">
          {t({
            hy: "Անցեք ռիսկի հայտնաբերումից կայուն փոփոխության։",
            en: "Move from risk detection to lasting change.",
          })}
        </h2>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <InverseCard className="rounded-3xl">
            <p className="text-overline text-brand-mint">
              {t({ hy: "Կազմակերպությունների համար", en: "For organisations" })}
            </p>
            <p className="text-on-inverse-muted text-body1 mt-4 text-pretty">
              {t({
                hy: "Կառուցեք կանխարգելիչ առողջության ծրագիր, որը դուրս է գալիս սքրինինգի սահմաններից և ամեն օր օգնում է անդամներին գործել իրենց ռիսկերի շուրջ։",
                en: "Build a preventive-health programme that goes beyond screening and helps members act on their risks every day.",
              })}
            </p>
          </InverseCard>

          <InverseCard id="members" className="scroll-mt-20 rounded-3xl">
            <p className="text-overline text-brand-gold-light">
              {t({ hy: "Անդամների համար", en: "For members" })}
            </p>
            <p className="text-on-inverse-muted text-body1 mt-4 text-pretty">
              {t({
                hy: "Անդամի փորձառությունը միավորում է առողջական պատկերը, անհատական խնամքի ծրագիրը և առաջընթացը մեկ շարունակական կանխարգելիչ ծրագրում։",
                en: "The member experience connects a health profile, a personalised care plan and progress over time within one continuous prevention programme.",
              })}
            </p>
          </InverseCard>
        </div>

        <div className="mt-10">
          <p className="text-on-inverse-muted text-body1">
            {t({ hy: "Հարցերի և համագործակցության համար կապվեք մեզ հետ։", en: "For questions or collaboration, contact us." })}
          </p>
          <a href="/contact" className="bg-brand-mint text-surface-inverse-deep mt-5 mr-5 inline-block rounded-md px-5 py-3 font-medium">
            {t({ hy: "Կապ մեզ հետ", en: "Contact us" })}
          </a>
          <a
            href="mailto:info@noreon.health"
            className="text-brand-mint hover:text-on-inverse mt-3 inline-block text-h3 underline underline-offset-4 transition-colors"
          >
            info@noreon.health
          </a>
        </div>

        <p className="font-heading border-on-inverse/16 text-h2 md:text-display3 mt-12 border-t pt-7 font-extrabold tracking-tight text-balance">
          {t({
            hy: "Մեկ համակարգ։ Ռիսկի հայտնաբերումից մինչև կայուն փոփոխություն։",
            en: "One system. From risk detection to lasting change.",
          })}
        </p>

        <p className="text-on-inverse-muted mt-6 flex max-w-2xl items-start gap-2 text-caption text-pretty">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t({
            hy: "Նորեոն Հելթի բժշկական տրամաբանությունը և խնամքի ուղիները մշակվում են առաջատար մասնագետների հետ և շարունակաբար հսկվում ու զարգացվում են նրանց հետ։",
            en: "Noreon's medical logic and care pathways are designed with leading specialists, and continuously monitored and developed with them.",
          })}
        </p>
      </Shell>
    </section>
  );
}
