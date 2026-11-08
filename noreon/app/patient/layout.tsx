import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { AccountBinding } from "@/components/patient/account-binding";
import { VERIFIED_MEMBER_HEADER } from "@/lib/patient/account-binding";
import { patientIdentity } from "@/lib/patient/auth";
import { readMemberTextSize } from '@/lib/patient/member-preferences';
import { memberHomeEnabled } from "@/lib/patient/member-home-config";
import "./member-home.css";
import "./member-chat.css";
import { MemberChatModeProvider } from "@/components/patient/member-chat-mode";
import { memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";
export const metadata: Metadata = {
  title: "Noreon · Your health",
  robots: { index: false, follow: false },
  // Next serves its manifest convention at the app root, including sign-in.
  manifest: "/manifest.webmanifest",
};
// The member app draws under the iPhone home indicator so its bottom tab bar can
// pad itself with env(safe-area-inset-*); without viewport-fit=cover those insets
// read as zero in the installed app (Khikar, 17 Oct).
export const viewport: Viewport = { viewportFit: "cover" };
export default async function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every member page is per-request; nothing under /patient is prerendered at build time.
  await connection();
  // Text size (prototype D8): read once per document; the Me control refreshes the layout.
  const textSize = await readMemberTextSize();
  // The proxy has none when auth blinked as it ran; a page that then renders must still be bound (Astra R1).
  const account = (await headers()).get(VERIFIED_MEMBER_HEADER) ?? (await patientIdentity().catch(() => null))?.userId ?? null;
  return <div className="contents" data-member-text-size={textSize} data-member-home-prototype={memberHomeEnabled() ? "" : undefined}><AccountBinding userId={account} /><MemberChatModeProvider enabled={memberChatOnlyEnabled()}>{children}</MemberChatModeProvider></div>;
}
