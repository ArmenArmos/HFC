"use client";

import { ArrowRightIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { Eyebrow } from "@/components/brand/panel";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * The shared furniture of the homepage.
 *
 * The page is long and it is eleven sections, so the thing that has to stay
 * constant is the rhythm: one content column, one vertical step between
 * sections, one shape for a section head. Everything visual that repeats more
 * than twice lives here rather than being written out again in each section,
 * because a homepage drifts by a few pixels at a time and the drift is only
 * ever visible in the scroll, never in the file you are editing.
 *
 * The page alternates four grounds and the alternation is the structure: the
 * stone page ground, the white card ground that separates two stone sections, and
 * two navies. Navy is the brand's authority colour, so it is spent on exactly
 * the three moments that have to carry weight, and nowhere else.
 */

/** The content column, at the width the brand book gives the marketing page. */
export function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-noreon mx-auto w-full px-6 md:px-8", className)}>
      {children}
    </div>
  );
}

/**
 * The teal wash that keeps a navy band from reading as a printed rectangle.
 *
 * It is `--panel-glow`, the same radial the navy Panel uses, placed in the
 * corner the band's content leaves empty. One layer, no colour of its own, and
 * `-z-10` so nothing has to fight it for the cursor.
 */
function Glow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "breathe pointer-events-none absolute -top-1/4 -right-1/5 -z-10 aspect-square w-3/5",
        className,
      )}
      style={{ backgroundImage: "var(--panel-glow)" }}
    />
  );
}

/**
 * One section of the page.
 *
 * `id` is not decoration here. With no separate routes built yet, the primary
 * navigation points at these anchors, so a section without an id is a section
 * the header cannot reach.
 */
export function Band({
  children,
  className,
  id,
  tone = "page",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /**
   * `card` is the quiet alternate ground that separates two stone sections, and
   * it is a hairline apart from `page` on purpose: the border does the
   * separating, not the fill. `inverse` is navy, `deep` is the darkest navy and
   * carries the glow.
   */
  tone?: "page" | "card" | "inverse" | "deep";
}) {
  return (
    <section
      id={id}
      className={cn(
        // Anchored sections land under a 68px sticky header, so they carry
        // their own scroll offset rather than arriving with the heading hidden
        // behind the bar.
        "scroll-mt-20 py-20 md:py-28 lg:py-32",
        tone === "card" && "bg-card border-y",
        tone === "inverse" && "bg-surface-inverse text-on-inverse",
        tone === "deep" &&
          "bg-surface-inverse-deep text-on-inverse relative isolate overflow-hidden",
        className,
      )}
    >
      {tone === "deep" && <Glow />}
      <Shell>{children}</Shell>
    </section>
  );
}

/**
 * The head of a section: a numbered label, the statement, and at most one
 * paragraph.
 *
 * The number is part of the label rather than a separate element. The page is
 * an argument in eleven steps and the numbering is what says so; splitting it
 * into its own box turns a reading order into decoration.
 */
export function Heading({
  eyebrow,
  title,
  lead,
  inverse = false,
  center = false,
  className,
}: {
  eyebrow: LocalizedHyEn;
  title: LocalizedHyEn;
  lead?: LocalizedHyEn;
  inverse?: boolean;
  center?: boolean;
  className?: string;
}) {
  const { t } = useMarketingLocale();
  return (
    <div className={cn("max-w-3xl", center && "mx-auto text-center", className)}>
      <Eyebrow
        tone={inverse ? "inverse" : "gold"}
        className={center ? "justify-center" : undefined}
      >
        {t(eyebrow)}
      </Eyebrow>
      {/* Armenian compounds are long: a single 18-character word set at 34px is
          wider than a 320px phone, and a word that does not fit does not wrap,
          it hangs off the side and takes the whole document's scrollbar with
          it. So the display step drops one notch below `sm`, and `break-words`
          is the net under it for whatever word arrives next. */}
      <h2 className="text-h1 sm:text-display3 md:text-display2 mt-5 font-extrabold tracking-tight text-balance break-words">
        {t(title)}
      </h2>
      {lead && (
        <p
          className={cn(
            "text-body1 md:text-h3 mt-5 text-pretty md:font-normal",
            inverse ? "text-on-inverse-muted" : "text-muted-foreground",
          )}
        >
          {t(lead)}
        </p>
      )}
    </div>
  );
}

/** The sentence a section closes on, set apart from the grid above it. */
export function Closer({
  children,
  inverse = false,
  className,
}: {
  children: React.ReactNode;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-body1 md:text-h3 mt-12 max-w-3xl border-l-3 pl-5 text-pretty md:font-normal",
        inverse
          ? "border-brand-mint/50 text-on-inverse"
          : "border-brand-teal text-[var(--text-strong)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * A white card on the light ground.
 *
 * Every panel on the light half of the page is this shape, which is what stops
 * eleven sections reading as eleven designs. `lift` is opt-out rather than
 * opt-in because a card that does nothing under the cursor reads as a picture
 * of a card.
 */
export function Card({
  children,
  className,
  lift = true,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  lift?: boolean;
} & React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn(
        "bg-card rounded-2xl p-6 ring-1 ring-[var(--border-subtle)] md:p-8",
        lift && "lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A card on the navy ground.
 *
 * The light ground separates cards with a hairline; navy cannot, because a
 * hairline that reads on navy is brighter than the text next to it. So these
 * are a lift of the ground itself, edged in the same white at a lower alpha.
 */
export function InverseCard({
  children,
  className,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn(
        "bg-on-inverse/5 ring-on-inverse/12 rounded-2xl p-6 ring-1 md:p-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A filled scale, used everywhere a share is being reported.
 *
 * The fill takes a colour by token name rather than a variant, because the
 * things being measured here do not share one scale: a risk band is severity, a
 * funnel stage is progress, and an adherence figure is neither.
 */
export function Track({
  pct,
  fill = "var(--chart-primary)",
  className,
}: {
  pct: number;
  /** A CSS colour, which must be a token reference rather than a literal. */
  fill?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-[var(--chart-track)] rounded-pill h-1.5 overflow-hidden",
        className,
      )}
    >
      <div
        className="extend h-full rounded-pill"
        style={{ width: `${pct}%`, background: fill }}
      />
    </div>
  );
}

/** The quiet link that closes a card, with the arrow that says it goes on. */
export function ArrowLink({
  href,
  children,
  inverse = false,
  className,
}: {
  href: Route;
  children: React.ReactNode;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // 44px of height, because this is the one control on a card and on a
        // phone it is being pressed with a thumb.
        "text-body2 inline-flex min-h-11 items-center gap-2 font-medium underline-offset-4 hover:underline",
        inverse
          ? "text-brand-mint hover:text-on-inverse"
          : "text-[var(--noreon-teal-800)] hover:text-brand-teal",
        className,
      )}
    >
      {children}
      <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />
    </Link>
  );
}

/**
 * The label every figure on this page that is not a cited fact has to carry.
 *
 * The brief is explicit about it and it is the one piece of chrome that is not
 * negotiable: the product has no outcome data yet, so every chart here is a
 * drawing of what the product shows, not a result it has produced. Saying so
 * once at the top of a dashboard is what keeps the rest of the page's cited
 * numbers worth believing.
 */
export function Illustrative({ className }: { className?: string }) {
  const { t } = useMarketingLocale();
  return (
    <span
      className={cn(
        "text-overline text-muted-foreground bg-surface-sunken rounded-pill inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 ring-1 ring-[var(--border-subtle)] ring-inset",
        className,
      )}
    >
      <span className="bg-brand-gold size-1.5 rounded-full" aria-hidden />
      {t({ hy: "Պատկերավոր տվյալներ", en: "Illustrative data" })}
    </span>
  );
}
