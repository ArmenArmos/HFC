import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { backofficeHost } from "@/lib/staff/hosts";

/**
 * The web app manifest.
 *
 * Next picks this file up by convention and emits the `<link rel="manifest">`
 * itself, so nothing in `app/layout.tsx` names it.
 *
 * It is here for the install: an Android home screen, a pinned Chrome tab or a
 * desktop shortcut all read this rather than the `<head>`, and without it they
 * fall back to a screenshot of the favicon on a white plate. The icons it
 * points at live in `public/icons/` rather than being the `app/icon.png` route,
 * because a manifest needs a stable URL and that route's is generated.
 *
 * The `maskable` icons are the same app icon with its navy plate extended to
 * the edge and the mark scaled to 85%, so the teal dot stays inside the
 * circular safe zone Android launchers crop to. They were cut from
 * `icon-512.png` with sharp rather than redrawn; if the design team supplies a
 * proper maskable tile, replace the two files.
 *
 * `start_url` is `/patient`, which sends a signed-in member to Home and anyone
 * else to sign-in, so the installed app opens the member app rather than the
 * informational homepage. The marketing deployment has no `/patient`, so it
 * keeps `/`. The backoffice host has no `/patient` either, and `/` is its sign-in.
 *
 * `#fcfcfc` is `--noreon-stone`, the ground `app/globals.css` declares and the
 * colour the app actually paints. A manifest is JSON read by the operating
 * system, so it cannot reference a custom property; `pnpm check:tokens`
 * compares this literal against the stylesheet and fails if they drift.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const backoffice = backofficeHost((await headers()).get("host") ?? "");
  return {
    name: backoffice ? "Noreon backoffice" : "Noreon, understand your health data",
    short_name: "Noreon",
    description:
      "Noreon turns everyday health measurements into trends you can act on.",
    start_url: backoffice || process.env.NOREON_DEPLOYMENT_TARGET === "marketing" ? "/" : "/patient",
    scope: "/",
    display: "standalone",
    background_color: "#fcfcfc",
    theme_color: "#fcfcfc",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
