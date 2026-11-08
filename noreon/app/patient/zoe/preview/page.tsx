import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ZoeKitPreview } from "@/components/patient/zoe-kit/preview/preview";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { zoeChatDesignPreviewEnabled } from "@/lib/patient/zoe-chat-design-preview";
import { parseLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Zoe preview" };
export const dynamic = "force-dynamic";

/**
 * The Zoe chat design preview (NOREON_ZOE_CHAT_DESIGN_PREVIEW): nine demo journeys built from the chat kit, for
 * signed-in members only. Demo data, nothing is saved or sent, typing is off; the live chat is /patient/zoe.
 */
export default async function ZoeKitPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!zoeChatDesignPreviewEnabled()) notFound();
  const { profile } = await requireRegisteredForRender();
  // ?l=en&j=bp&size=xlarge opens one journey directly (links to send, and the renders).
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  return <ZoeKitPreview initialLocale={parseLocale(one("l"), profile.locale)} initialJourney={one("j")} initialSize={one("size")} />;
}
