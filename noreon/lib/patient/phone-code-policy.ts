type Environment = Record<string, string | undefined>;
export type PhoneCodeDelivery = "sms" | "whatsapp" | "telegram";
export type PhoneCodePolicy = {
  provider: "sms" | "twilio-whatsapp" | "meta-whatsapp-hook" | "brevo-sms-hook" | "twilio-sms-hook" | "twilio-verify-hook" | "telegram-hook";
  authChannel: "sms" | "whatsapp";
  delivery: PhoneCodeDelivery;
  allowedPrefixes: string[];
};

/** The server selects transport. A browser cannot request an alternative channel. */
export function phoneCodePolicy(env: Environment): PhoneCodePolicy | null {
  const provider = env.NOREON_PHONE_OTP_PROVIDER ?? (env.NOREON_DEPLOYMENT_TARGET === "app" ? "" : "sms");
  if (provider !== "sms" && provider !== "twilio-whatsapp" && provider !== "meta-whatsapp-hook" && provider !== "brevo-sms-hook" && provider !== "twilio-sms-hook" && provider !== "twilio-verify-hook" && provider !== "telegram-hook") return null;
  if ((provider === "meta-whatsapp-hook" || provider === "brevo-sms-hook" || provider === "twilio-sms-hook" || provider === "twilio-verify-hook" || provider === "telegram-hook") && env.NOREON_PHONE_OTP_HOOK_READY !== "true") return null;
  // Telegram codes also need the Telegram channel and the T-auth flag (both off by default).
  if (provider === "telegram-hook" && (env.NOREON_TELEGRAM_ENABLED !== "true" || env.NOREON_TELEGRAM_AUTH_ENABLED !== "true")) return null;
  const allowedPrefixes = (env.NOREON_REGISTRATION_ALLOWED_PREFIXES ?? "+374").split(",").map(value => value.trim());
  if (!allowedPrefixes.length || allowedPrefixes.length > 20 || allowedPrefixes.some(value => !/^\+[1-9]\d{0,3}$/.test(value))) return null;
  return {
    provider,
    authChannel: provider === "twilio-whatsapp" ? "whatsapp" : "sms",
    delivery: provider === "telegram-hook" ? "telegram" : provider === "sms" || provider === "brevo-sms-hook" || provider === "twilio-sms-hook" || provider === "twilio-verify-hook" ? "sms" : "whatsapp",
    allowedPrefixes: [...new Set(allowedPrefixes)],
  };
}

export function phoneCodeAllowed(phone: string, policy: PhoneCodePolicy): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return false;
  if (phone.startsWith("+374") && !/^\+374\d{8}$/.test(phone)) return false;
  return policy.allowedPrefixes.some(prefix => phone.startsWith(prefix));
}
