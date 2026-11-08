import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { LocaleProvider } from "@/components/marketing/locale";

/** Public informational surface, without access-request forms. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <LocaleProvider>
      <MarketingChrome>{children}</MarketingChrome>
    </LocaleProvider>
  );
}
