/** Exact opt-in; incomplete configuration silently leaves the feature unavailable. */
export function memberPushConfig(env: Record<string, string | undefined> = process.env) {
  if (env.NOREON_MEMBER_PUSH_ENABLED !== 'true') return null;
  const publicKey = env.NOREON_VAPID_PUBLIC_KEY;
  const privateKey = env.NOREON_VAPID_PRIVATE_KEY;
  const subject = env.NOREON_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return null;
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

// The endpoint comes from the browser, so only the real push services are ever called.
const PUSH_HOST = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
export function pushEndpointAllowed(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && PUSH_HOST.test(url.hostname);
  } catch { return false; }
}
