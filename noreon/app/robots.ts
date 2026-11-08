import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * `/dashboard` used to be listed here. It was the demo's dashboard, which is
 * kept out of search by the `noindex` on the demo layout rather than from here,
 * for the reason that file explains. The product's own authenticated routes do
 * not exist yet; they belong here when they do, because a crawler cannot reach
 * them to be told anything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
