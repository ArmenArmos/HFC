import type { Metadata } from "next";

import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { NotFoundScreen } from "@/components/marketing/not-found-screen";
import { LocaleProvider } from "@/components/marketing/locale";

/** Public informational surface, without access-request forms. */
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <LocaleProvider>
      <MarketingChrome>
        <NotFoundScreen />
      </MarketingChrome>
    </LocaleProvider>
  );
}
