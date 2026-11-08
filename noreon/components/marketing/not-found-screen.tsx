"use client";

import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { Medallion } from "@/components/brand/medallion";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/marketing/copy";
import { useMarketingLocale } from "@/components/marketing/locale";

/**
 * The 404 body.
 *
 * A client component because the copy is bilingual and the language lives in
 * the demo session, the same reason `MarketingChrome` is one. A 404 that only
 * speaks English is a 404 in the wrong language for most of this product's
 * audience.
 *
 * The reassurance line is not filler. This is a health product, and an
 * unexpected blank page is read as "something happened to my results" long
 * before it is read as "I mistyped a URL". Saying so costs one line.
 *
 * Centred, which section 5 of DESIGN.md otherwise forbids: the exemption is a
 * short empty state, and this is the same shape as `LockedScreen`. It stays a
 * single narrow column so there is no long centred paragraph to read.
 */
export function NotFoundScreen() {
  const { t } = useMarketingLocale();

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-20 text-center md:py-28">
      <Medallion tone="teal" size="lg">
        <CompassIcon aria-hidden />
      </Medallion>

      {/* `h1` because this is the page, not a section of one. The status code
          is the small print: it is what a developer needs and what everyone
          else can ignore, so it does not get to be the headline. */}
      <h1 className="text-h1 mt-6 font-extrabold tracking-tight text-balance">
        {t(COPY["notFound.title"])}
      </h1>
      <p className="text-muted-foreground mt-4 text-body1 text-pretty">
        {t(COPY["notFound.body"])}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button
          size="lg"
          className="press h-12 px-6 text-body1"
          nativeButton={false}
          render={<Link href="/" />}
        >
          {t(COPY["notFound.home"])}
        </Button>
      </div>

      <p className="text-muted-foreground mt-10 text-overline">404</p>
    </section>
  );
}
