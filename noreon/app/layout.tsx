import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Manrope, Noto_Sans_Armenian } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

/**
 * The design system pairs Manrope for headings, titles and numbers with Inter
 * for body copy, UI and labels. Its own `tokens/fonts.css` pulls both from the
 * Google Fonts CDN; loading them here self-hosts the same two faces instead, so
 * there is no third-party request on the critical path and no shift while they
 * load. `globals.css` re-points `--font-display` and `--font-body` at these two
 * variables.
 */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/**
 * Neither Manrope nor Inter ships Armenian glyphs, and the product demo is in
 * Armenian. This carries those glyphs; `globals.css` lists it after the two
 * Latin faces in the font stack, so Latin text still renders in the brand
 * typefaces and only Armenian falls through to it.
 */
const notoArmenian = Noto_Sans_Armenian({
  variable: "--font-armenian",
  subsets: ["armenian", "latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * `metadataBase` makes every relative Open Graph and canonical URL resolve
 * correctly. Without it Next emits relative og:image URLs, which most crawlers
 * and social scrapers drop.
 *
 * The icons are not listed here. `app/favicon.ico`, `app/icon.png` and
 * `app/apple-icon.png` are the file convention, so Next measures each file and
 * writes the `rel`, `type` and `sizes` itself; a hand-written `icons` block
 * here would silently win over them and would then have to be kept in step
 * with the files by hand. All three are the brand's app icon from
 * `public/brand/logo/app-icon.png`; `scripts/make-icons.mjs` derives them.
 *
 * The manifest is likewise picked up from `app/manifest.ts`.
 *
 * No `keywords`, and no per-page `alternates` at this level. Search engines
 * have ignored the keywords tag for years, and a canonical URL set on the root
 * layout is inherited literally by every page under it, which would tell a
 * crawler that the sign-in page and the homepage are the same document. The
 * homepage declares its own.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Noreon, understand your health data",
    template: "%s | Noreon",
  },
  description:
    "Noreon turns everyday health measurements into trends you can act on.",
  applicationName: "Noreon",
  authors: [{ name: "Noreon" }],
  creator: "Noreon",
  publisher: "Noreon",
  // Health is a YMYL category, and saying so is one more signal that matches
  // the organisation's structured data on the homepage.
  category: "health",
  openGraph: {
    type: "website",
    siteName: "Noreon",
    locale: "en_US",
    // `title` and `description` are filled from the two above, per route, and
    // the card image comes from `app/opengraph-image.tsx`.
  },
  // Twitter falls back to the Open Graph image when it finds no `twitter:image`,
  // so the one generated card serves both. This only picks the large layout.
  twitter: { card: "summary_large_image" },
  // The homepage quotes measurements, percentages and reference ranges. iOS
  // reads several of those shapes as phone numbers and turns them into blue
  // links, which is a rendering the copy never asked for.
  formatDetection: { telephone: false, address: false, date: false },
  appleWebApp: { capable: true, title: "Noreon", statusBarStyle: "default" },
  robots: { index: true, follow: true },
};

/**
 * The browser paints its own chrome around the page on mobile, and this is the
 * only way to tell it what the page underneath looks like.
 *
 * `#fcfcfc` is `--noreon-stone`, the ground declared in `app/globals.css` and
 * the colour the sticky header carries. It is transcribed rather than
 * referenced because a meta tag cannot read a custom property, so
 * `pnpm check:tokens` compares the two and fails if they drift.
 *
 * `colorScheme: "light"` is a statement of fact, not a preference: the design
 * system's dark theme is vendored but deliberately not wired up, so a browser
 * that dark-tints form controls on a light page would be inventing a theme
 * this app does not have.
 */
export const viewport: Viewport = {
  themeColor: "#fcfcfc",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} ${notoArmenian.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
