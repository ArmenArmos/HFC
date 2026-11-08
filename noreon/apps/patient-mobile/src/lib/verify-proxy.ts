/** Keep SDK session parsing/storage while routing only phone-code confirmation through the app. */
export function createPhoneVerifyProxy(supabaseUrl: string, fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${supabaseUrl}/auth/v1/verify` || init?.method !== 'POST') return fetcher(input, init);
    const value: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (!value || typeof value !== 'object' || !('phone' in value) || !('token' in value) || !('type' in value) || value.type !== 'sms') throw Error('Phone verification unavailable');
    return fetcher('https://app.noreon.health/api/native/verify-phone', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({phone: value.phone, token: value.token, type: 'sms'}),
      signal: init.signal,
      redirect: 'error',
      credentials: 'omit',
    });
  };
}
