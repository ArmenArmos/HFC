import "react-native-url-polyfill/auto";
import { createClient, processLock, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { createPhoneVerifyProxy } from "./verify-proxy";
import { mobileConfig } from "./config";
import { createCredentialVault, createAuthTransport } from "./auth-boundary";
import { createAuthLifetime } from "./auth-lifetime";
import { abortableRequest, boundedRequest } from "./request";
import type { Database } from "../../../../lib/db/types";
export const SESSION_KEY = "noreon.member.session";
const vault = createCredentialVault(
  {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  SESSION_KEY,
);
// Expo replaces only direct EXPO_PUBLIC property access at build time.
let configured: ReturnType<typeof mobileConfig> = null;
try {
  configured = mobileConfig({
    EXPO_PUBLIC_NOREON_ENABLED: process.env.EXPO_PUBLIC_NOREON_ENABLED,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_HCAPTCHA_SITE_KEY: process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY,
  });
} catch {
  /* Render the unavailable state without logging configuration. */
}
export const config = configured;
const faultListeners = new Set<() => void>();
export function subscribeAuthFault(listener: () => void) {
  faultListeners.add(listener);
  return () => {
    faultListeners.delete(listener);
  };
}
function createManagedClient() {
  if (!config) throw Error("Mobile unavailable");
  let active = true;
  const credentials = vault.lease(() => {
    if (active) {
      faultListeners.forEach((listener) => listener());
      retire();
    }
  });
  const transport = createAuthTransport(createPhoneVerifyProxy(config.url, fetch));
  // SDK background INITIAL_SESSION work does not catch rejected storage reads.
  // A retired SDK sees empty storage; its mutations are discarded. The provider
  // independently rejects stale operation results using the active lease identity.
  async function storageCall<T>(
    work: () => Promise<T>,
    retired: T,
  ): Promise<T> {
    if (!active) return retired;
    try {
      return await work();
    } catch (error) {
      if (!active) return retired;
      throw error;
    }
  }
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: transport.fetch },
    auth: {
      storage: {
        getItem: (key) =>
          storageCall(() => credentials.storage.getItem(key), null),
        setItem: (key, value) =>
          storageCall(() => credentials.storage.setItem(key, value), undefined),
        removeItem: (key) =>
          storageCall(() => credentials.storage.removeItem(key), undefined),
      },
      storageKey: SESSION_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
  function retire() {
    if (!active) return;
    active = false;
    credentials.retire();
    transport.retire();
    const dispose = () => client.auth.dispose().catch(() => {});
    void dispose();
    // Initialization's finally block can start refresh after the first dispose.
    void client.auth.initialize().then(dispose, dispose);
  }
  return { client, active: () => active, retire };
}
export type NativeAuthClient = ReturnType<typeof createManagedClient>["client"];
export const authRuntime = config
  ? createAuthLifetime(createManagedClient, () => vault.clear())
  : null;
export const getAuthClient = () => authRuntime?.current()?.client ?? null;

/** Best effort server revocation of the old session; never wait on this for local deletion. */
export async function revokeOldSession(
  session: Pick<Session, "access_token" | "refresh_token" | "expires_at">,
) {
  if (!config || !session.access_token) return false;
  const settings = config;
  const transport = createAuthTransport(fetch);
  try {
    return await boundedRequest(async (signal) => {
      let token = session.access_token,
        refreshed = false;
      async function refresh() {
        if (!session.refresh_token || refreshed) return false;
        refreshed = true;
        const response = await transport.fetch(
          `${settings.url}/auth/v1/token?grant_type=refresh_token`,
          {
            method: "POST",
            signal,
            headers: {
              apikey: settings.key,
              Authorization: `Bearer ${settings.key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ refresh_token: session.refresh_token }),
          },
        );
        if (!response.ok) return false;
        const value: unknown = await abortableRequest(
          () => response.json(),
          signal,
        );
        if (
          !value ||
          typeof value !== "object" ||
          !("access_token" in value) ||
          typeof value.access_token !== "string" ||
          !value.access_token
        )
          return false;
        token = value.access_token;
        return true;
      }
      async function revoke() {
        return transport.fetch(`${settings.url}/auth/v1/logout?scope=local`, {
          method: "POST",
          signal,
          headers: { apikey: settings.key, Authorization: `Bearer ${token}` },
        });
      }
      if (
        (!session.expires_at ||
          session.expires_at * 1000 <= Date.now() + 30000) &&
        !(await refresh())
      )
        return false;
      let response = await revoke();
      // Clock skew or early invalidation can make an apparently current token expire.
      if (response.status === 401 && !refreshed && (await refresh()))
        response = await revoke();
      return response.ok;
    });
  } catch {
    return false;
  } finally {
    transport.retire();
  }
}
