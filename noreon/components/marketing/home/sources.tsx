"use client";

import { ChevronDownIcon } from "lucide-react";

import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * The numbered facts the homepage stands on, and where each one comes from.
 *
 * Every figure quoted on this page is somebody else's published finding, so
 * every figure carries a marker back to here. That is not a formality: the
 * whole argument of the page is that prevention should follow evidence, and a
 * page making that argument with unattributed statistics is making it badly.
 *
 * `supports` is written out rather than left implicit because it is the part
 * that is checkable. It says which sentence on the page the source is being
 * asked to carry, so a claim that drifts away from its source is visible here
 * rather than only in the source document.
 *
 * Nothing here is an outcome claim about Noreon. The product has produced no
 * outcome data, so the page quotes none.
 */
export const REFERENCES: {
  n: number;
  source: string;
  title: LocalizedHyEn;
  href: string;
  supports: LocalizedHyEn;
}[] = [
  {
    n: 1,
    source: "WHO",
    title: {
      hy: "Սրտանոթային հիվանդություններ",
      en: "Cardiovascular diseases (CVDs)",
    },
    href: "https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)",
    supports: {
      hy: "Սրտանոթային հիվանդությունները մահվան առաջատար պատճառն են աշխարհում. 19,8 միլիոն մահ 2022 թվականին, որը համաշխարհային բոլոր մահերի մոտավորապես 32%-ն է։ Դեպքերի մեծ մասը կանխարգելելի է վարքային և միջավայրային ռիսկի գործոնների վրա ազդելով։",
      en: "Cardiovascular disease is the leading cause of death globally: 19.8 million CVD deaths in 2022, approximately 32% of all global deaths. Most CVD can be prevented by addressing behavioural and environmental risk factors.",
    },
  },
  {
    n: 2,
    source: "World Heart Federation",
    title: {
      hy: "Առողջապահական համակարգերի ամրապնդում և ոչ վարակիչ հիվանդությունների ֆինանսավորում",
      en: "Strengthening Health Systems and Financing for NCDs",
    },
    href: "https://world-heart-federation.org/news/whf-statement-on-health-systems-strengthening-and-financing-for-ncds/",
    supports: {
      hy: "Համաշխարհային սրտի ֆեդերացիայի հայտարարությունը, ըստ որի սրտանոթային հիվանդություններից մահերի 80%-ը կանխարգելելի է։",
      en: "The World Heart Federation statement that 80% of cardiovascular disease deaths are preventable.",
    },
  },
  {
    n: 3,
    source: "WHO",
    title: { hy: "Զարկերակային գերճնշում", en: "Hypertension" },
    href: "https://www.who.int/news-room/fact-sheets/detail/hypertension",
    supports: {
      hy: "30–79 տարեկան մոտավորապես 1,4 միլիարդ մեծահասակ ունի զարկերակային գերճնշում, և միայն մոտ 23%-ի մոտ է այն վերահսկվում, ինչը նշանակում է, որ մոտ 77%-ի մոտ վերահսկվում չէ։",
      en: "Approximately 1.4 billion adults aged 30 to 79 have hypertension, and only about 23% have it under control, meaning about 77% do not.",
    },
  },
  {
    n: 4,
    source: "European Journal of Preventive Cardiology",
    title: {
      hy: "Գերճնշման ուղեցույցների և իրական պրակտիկայի միջև բացը կամրջելը",
      en: "Bridging the gap between hypertension guidelines and real-life practice",
    },
    href: "https://doi.org/10.1093/eurjpc/zwaf733",
    supports: {
      hy: "Մեծ մետավերլուծության մեջ հակահիպերտենզիվ դեղորայքի չհետևելու գնահատականները կազմում են 27–40%. դեղորայքի ընդհատումը մոտենում է 50%-ի առաջին նշանակումից երկու տարի անց։",
      en: "Meta-analysis non-adherence estimates of 27 to 40%; antihypertensive medication discontinuation approaching 50% two years after the initial prescription.",
    },
  },
  {
    n: 5,
    source: "WHO",
    title: { hy: "Ֆիզիկական ակտիվություն", en: "Physical activity" },
    href: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
    supports: {
      hy: "Մեծահասակների 31%-ը, մոտավորապես 1,8 միլիարդ մարդ, չի հասնում ֆիզիկական ակտիվության խորհուրդ տրվող մակարդակին։",
      en: "31% of adults, around 1.8 billion people, do not meet recommended levels of physical activity.",
    },
  },
  {
    n: 6,
    source: "WHO",
    title: { hy: "Նատրիումի կրճատում", en: "Sodium reduction" },
    href: "https://www.who.int/news-room/fact-sheets/detail/sodium-reduction",
    supports: {
      hy: "Աղի համաշխարհային միջին սպառումը մեծահասակների մոտ կազմում է օրական մոտավորապես 11 գ, ինչը ավելի քան երկու անգամ գերազանցում է ԱՀԿ-ի՝ օրական 5 գ-ից պակասի խորհուրդը։ 2023 թվականին մոտավորապես 1,7 միլիոն մահ կապված է եղել նատրիումի ավելցուկային սպառման հետ։",
      en: "Global mean adult salt intake of approximately 11 g a day, more than double the WHO recommendation of less than 5 g a day. An estimated 1.7 million deaths in 2023 were associated with consuming too much sodium.",
    },
  },
];

/**
 * The marker that rides beside a quoted figure.
 *
 * It is a link rather than a superscript number, so the reference is one press
 * away on a phone rather than a hunt through a footer. `sr-only` text carries
 * the word, because a screen reader announcing "one" in the middle of a
 * sentence about deaths is worse than no marker at all.
 */
export function Ref({ n, className }: { n: number; className?: string }) {
  const { t } = useMarketingLocale();
  return (
    <a
      href={`#source-${n}`}
      className={cn(
        "text-muted-foreground hover:text-brand-teal align-super text-[0.65em] font-medium no-underline transition-colors",
        className,
      )}
    >
      {/* A word joiner, so the marker never wraps onto a line of its own. The
          marker and the sentence it belongs to are separate inline boxes, which
          is a break opportunity, and a lone "[2]" at the start of a line reads
          as a list item rather than as a citation. */}
      {"\u2060"}
      <span aria-hidden>[{n}]</span>
      <span className="sr-only">
        {" "}
        {t({ hy: "աղբյուր", en: "source" })} {n}
      </span>
    </a>
  );
}

/**
 * The reference list, folded away under the footer.
 *
 * It is a `<details>` rather than a navigation column on purpose. Six citations
 * set out in full is more text than everything else in the footer put together,
 * and a footer that is mostly citations tells a visitor the page is a paper.
 * Closed it is one line; opened it is the evidence, and the anchor targets work
 * either way because `<details>` scrolls open when an anchor inside it is
 * addressed.
 */
export function Sources() {
  const { t } = useMarketingLocale();

  return (
    <details className="group border-t">
      <summary className="text-muted-foreground hover:text-foreground marker:content-none flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-caption transition-colors md:px-8">
        <ChevronDownIcon
          className="size-3.5 transition-transform group-open:rotate-180"
          aria-hidden
        />
        {t({
          hy: "Աղբյուրներ. այս էջի համարակալված փաստերը",
          en: "Sources: the numbered facts on this page",
        })}
      </summary>
      <div className="max-w-noreon mx-auto w-full px-6 pb-10 md:px-8">
        <ol className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          {REFERENCES.map((ref) => (
            <li
              key={ref.n}
              id={`source-${ref.n}`}
              className="scroll-mt-24 target:bg-surface-sunken -mx-2 rounded-lg px-2 py-1.5"
            >
              <p className="text-caption">
                <span className="text-muted-foreground tabular-nums">
                  [{ref.n}]
                </span>{" "}
                <span className="text-foreground font-medium">{ref.source}</span>{" "}
                <a
                  href={ref.href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  {t(ref.title)}
                </a>
              </p>
              <p className="text-muted-foreground mt-1 text-caption text-pretty">
                {t({ hy: "Հիմնավորում՝ ", en: "Supports: " })}
                {t(ref.supports)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
