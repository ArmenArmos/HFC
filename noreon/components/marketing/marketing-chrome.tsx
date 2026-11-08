"use client";

import { MenuIcon } from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { DotField } from "@/components/brand/dot-field";
import { Sources } from "@/components/marketing/home/sources";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COPY } from "@/lib/marketing/copy";
import { MEMBER_APP_URL } from "@/lib/marketing/links";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";

/** Informational navigation for the public website. */

/** The primary navigation, and where each subject currently lives. */
const NAV: { label: LocalizedHyEn; href: Route }[] = [
  {
    label: { hy: "Ինչպես է աշխատում", en: "How it works" },
    href: "/#how",
  },
  {
    label: { hy: "Կազմակերպություններ", en: "For organisations" },
    href: "/#organizations",
  },
  {
    label: { hy: "Կառավարություններ", en: "For governments" },
    href: "/#government",
  },
  { label: { hy: "Գիտություն", en: "Science" }, href: "/#science" },
];

const OPEN_APP: LocalizedHyEn = { hy: "Բացել հավելվածը", en: "Open the app" };

/** Footer links to informational sections, plus the way into the member app. */
const FOOTER: {
  title: LocalizedHyEn;
  links: { label: LocalizedHyEn; href: Route | typeof MEMBER_APP_URL }[];
}[] = [
    {
      title: { hy: "Ուսումնասիրել", en: "Explore" },
      links: NAV.slice(0, 3),
    },
    {
      title: { hy: "Գիտություն", en: "Science" },
      links: NAV.slice(3),
    },
    {
      title: { hy: "Ընկերություն", en: "Company" },
      links: [
        { label: OPEN_APP, href: MEMBER_APP_URL },
        // No standalone privacy policy has been approved yet, so this points at
        // the privacy section on the homepage. `/privacy` redirects there too.
        { label: { hy: "Գաղտնիություն", en: "Privacy" }, href: "/#privacy" },
        { label: { hy: "Կապ մեզ հետ", en: "Contact us" }, href: "/contact" },
        { label: { hy: "info@noreon.health", en: "info@noreon.health" }, href: "mailto:info@noreon.health" },
      ],
    },
  ];

export function MarketingChrome({ children }: { children: ReactNode }) {
  const { t } = useMarketingLocale();

  return (
    <div className="flex min-h-full flex-col">
      {/* The design system gives the web header one spec: 68px, sticky,
          translucent ivory over a 14px blur, hairline base. It and the app's
          tab bar are the only fixed chrome in the system. */}
      <header className="bg-surface-page sticky top-0 z-50 border-b backdrop-blur-[14px]">
        <nav className="max-w-noreon mx-auto flex h-17 w-full items-center justify-between gap-2 px-4 md:gap-4 md:px-8">
          <Link
            href="/"
            aria-label={t(COPY["marketing.home"])}
            className="press shrink-0"
          >
            {/* The intrinsic size is the desktop one; the class steps it down a
                notch on a phone, where the wordmark and the action are sharing
                390 pixels with the language switch. */}
            <Image
              src="/brand/logo/noreon-wordmark-navy.svg"
              alt="Noreon"
              width={120}
              height={22}
              priority
              unoptimized
              className="h-[18px] w-auto md:h-[22px]"
            />
          </Link>

          {/* Five items at body-2 come to about 560px in English and about
              845px in Armenian, so the row is the wide layout and the menu
              below is the narrow one. The breakpoint is set by the Armenian
              width, not the English one: at `lg` the bar wrapped onto a second
              line in Armenian, which breaks the one spec the design system
              gives this header. */}
          <ul className="hidden min-w-0 items-center gap-1 xl:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-2.5 py-2 text-body2 transition-colors"
                >
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              className="hidden h-11 px-4 sm:inline-flex"
              render={<a href={MEMBER_APP_URL} />}
              nativeButton={false}
            >
              {t(OPEN_APP)}
            </Button>
            <Button className="h-11 px-4" render={<Link href="/contact" />} nativeButton={false}>
              {t({ hy: "Կապ մեզ հետ", en: "Contact us" })}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="press size-11 xl:hidden"
                    aria-label={t(COPY["nav.menu"])}
                  >
                    <MenuIcon aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  className="min-h-11 px-3 py-2 font-medium sm:hidden"
                  nativeButton={false}
                  render={<a href={MEMBER_APP_URL} />}
                >
                  {t(OPEN_APP)}
                </DropdownMenuItem>
                {NAV.map((item) => (
                  <DropdownMenuItem
                    key={item.href}
                    className="min-h-11 px-3 py-2"
                    nativeButton={false}
                    render={<Link href={item.href} />}
                  >
                    {t(item.label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="relative isolate mt-auto overflow-hidden border-t">
        {/* The mark's own graphic, closing the page the way it opened it. It is
            masked back toward the outer edges: the field used to run straight
            through the disclaimer, which is the one line in the footer that has
            to stay readable. */}
        <DotField
          tone="teal"
          className="-z-10 opacity-55 [mask-image:radial-gradient(80%_120%_at_50%_50%,transparent_20%,black)]"
          sweepDelay={0}
          still
        />
        <div className="max-w-noreon mx-auto w-full px-6 py-14 md:px-8">
          <div className="grid gap-10 md:grid-cols-[1.2fr_2fr]">
            <div className="max-w-sm">
              {/* The mark stands alone. The design system deleted both tagline
                  lockups and the tagline as copy; do not reintroduce either. */}
              <Image
                src="/brand/logo/noreon-wordmark-navy.svg"
                alt="Noreon"
                width={100}
                height={18}
                unoptimized
              />
              <p className="text-muted-foreground mt-4 text-body2 text-pretty">
                {t({
                  hy: "Մեկ համակարգ։ Ռիսկի հայտնաբերումից մինչև կայուն փոփոխություն։",
                  en: "One system. From risk detection to lasting change.",
                })}
              </p>
              <p className="text-muted-foreground mt-4 text-caption text-pretty">
                {t(COPY["marketing.disclaimer"])}
              </p>
              <p className="text-muted-foreground mt-4 text-caption text-pretty">
                {t({
                  hy: "Նորեոնը գործարկում է Հայաստանում գրանցված «ՆՈՐԵՈՆ ՀԵԼԹ» ՓԲԸ-ն։",
                  en: 'Noreon is operated by “NOREON HEALTH” CJSC, registered in Armenia.',
                })}
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {FOOTER.map((column) => (
                <div key={column.title.en}>
                  <p className="text-overline text-muted-foreground">
                    {t(column.title)}
                  </p>
                  <ul className="mt-1.5">
                    {column.links.map((link) => (
                      <li key={`${column.title.en}-${link.href}`}>
                        <Link
                          href={link.href as Route}
                          className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-body2 transition-colors"
                        >
                          {t(link.label)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The numbered facts, folded away. Six citations set out in full is
            more text than the rest of the footer put together, so it is one
            line until someone wants it. */}
        <Sources />
      </footer>
    </div>
  );
}
