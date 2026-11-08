export type MobileConfig = {
  url: string;
  key: string;
  captchaSiteKey: string;
  captchaOrigin: string;
};
/** Public configuration only. Refuse privileged keys even in a mistaken build. */
export function mobileConfig(
  env: Record<string, string | undefined>,
): MobileConfig | null {
  if (env.EXPO_PUBLIC_NOREON_ENABLED !== "true") return null;
  const url = env.EXPO_PUBLIC_SUPABASE_URL,
    key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    site = env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY;
  if (!url || !key || !site) throw Error("Mobile setup unavailable");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  )
    throw Error("Mobile setup unavailable");
  let publicKey = key.startsWith("sb_publishable_");
  if (!publicKey)
    try {
      const payload = JSON.parse(
        atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
      );
      publicKey = payload.role === "anon";
    } catch {
      publicKey = false;
    }
  if (!publicKey) throw Error("Mobile setup unavailable");
  return {
    url: parsed.origin,
    key,
    captchaSiteKey: site,
    captchaOrigin: "https://app.noreon.health",
  };
}
