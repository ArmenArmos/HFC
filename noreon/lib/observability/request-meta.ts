import type { ActorKind } from "./redact";

/**
 * Coarse request facts for the proxy line. None of them identifies a person on its own: the
 * IP is cut to its network (/24 for IPv4, /48 for IPv6) and the full address is never kept,
 * the user agent becomes a family name, and the actor kind only says which sign-in cookie
 * the browser sent (the proxy does not verify it and never logs who it belongs to).
 */

/** A client address cut to its /24 (IPv4) or /48 (IPv6) network, or nothing. */
export function ipPrefix(value: string | null | undefined): string | undefined {
  const ip = value?.split(",")[0]?.trim().replace(/^\[|\]$/g, "");
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/i, "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1, 4).map(Number);
    if (parts.some((part) => part > 255) || Number(v4[4]) > 255) return undefined;
    return `${parts.join(".")}.0/24`;
  }
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return undefined;
  const [head, tail = ""] = ip.split("::");
  if (ip.split("::").length > 2) return undefined;
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0 || (missing > 0 && !ip.includes("::"))) return undefined;
  const groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return `${groups.slice(0, 3).map((group) => group.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/48`;
}

/** The address the platform saw: Vercel's own header first, then the first forwarded hop. */
export function clientIpPrefix(headers: Pick<Headers, "get">): string | undefined {
  return ipPrefix(headers.get("x-real-ip")) ?? ipPrefix(headers.get("x-forwarded-for"));
}

/** Two-letter country from Vercel's geo header. */
export function country(headers: Pick<Headers, "get">): string | undefined {
  const value = headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  return value && /^[A-Z]{2}$/.test(value) ? value : undefined;
}

export const UA_FAMILIES = ["bot", "telegram", "edge", "samsung", "opera", "firefox", "chrome", "safari", "curl", "node", "other"] as const;
export type UaFamily = (typeof UA_FAMILIES)[number];

/** A browser family name; the user agent string itself is never logged. */
export function uaFamily(value: string | null | undefined): UaFamily | undefined {
  if (!value) return undefined;
  if (/bot|crawl|spider|slurp|preview|monitor|uptime|vercel-(screenshot|favicon)|headless/i.test(value)) return "bot";
  if (/telegram/i.test(value)) return "telegram";
  if (/edg(e|a|ios)?\//i.test(value)) return "edge";
  if (/samsungbrowser/i.test(value)) return "samsung";
  if (/opr\/|opera/i.test(value)) return "opera";
  if (/firefox|fxios/i.test(value)) return "firefox";
  if (/chrome|crios|chromium/i.test(value)) return "chrome";
  if (/safari|applewebkit/i.test(value)) return "safari";
  if (/^curl\//i.test(value)) return "curl";
  if (/node|undici|axios/i.test(value)) return "node";
  return "other";
}

/** Which sign-in cookie the request carries; not verified here. */
export function cookieActor(names: readonly string[]): ActorKind {
  if (names.some((name) => name.startsWith("noreon-real-clinic-auth"))) return "clinic";
  if (names.some((name) => name.startsWith("noreon-real-staff-auth") || name.startsWith("noreon-workspace-auth"))) return "staff";
  if (names.some((name) => /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i.test(name))) return "member";
  return "anon";
}
