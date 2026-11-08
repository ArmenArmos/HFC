import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import {
  authRuntime,
  revokeOldSession,
  subscribeAuthFault,
  type NativeAuthClient,
} from "./supabase";
import type { AuthLease } from "./auth-lifetime";
import { abortableRequest, boundedRequest } from "./request";
type AuthState = {
  session: Session | null;
  loading: boolean;
  error: boolean;
  signOut: () => Promise<void>;
  runAuthOperation: <T>(
    work: (client: NativeAuthClient) => Promise<T>,
  ) => Promise<T>;
};
const Context = createContext<AuthState>({
  session: null,
  loading: true,
  error: false,
  signOut: async () => {},
  runAuthOperation: async () => {
    throw Error("Auth unavailable");
  },
});
export function AuthProvider({ children }: PropsWithChildren) {
  const mounted = useRef(false),
    knownSession = useRef<Session | null>(null),
    generation = useRef(0),
    cleanup = useRef<Promise<void> | null>(null);
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(Boolean(authRuntime)),
    [error, setError] = useState(false),
    [version, setVersion] = useState(0);
  const fail = useCallback((lease: AuthLease<NativeAuthClient>) => {
    if (authRuntime?.current() !== lease) return;
    authRuntime.retire(lease);
    knownSession.current = null;
    if (mounted.current) {
      setSession(null);
      setError(true);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const runtime = authRuntime;
    if (!runtime)
      return () => {
        mounted.current = false;
      };
    let lease: AuthLease<NativeAuthClient>;
    try {
      lease = runtime.start();
    } catch {
      // Publish external initialization failure after effect setup, if still mounted.
      let active = true;
      void Promise.resolve().then(() => {
        if (active) {
          setLoading(false);
          setError(true);
        }
      });
      return () => {
        active = false;
        mounted.current = false;
      };
    }
    let alive = true,
      events = 0;
    const valid = () => alive && runtime.current() === lease && lease.active();
    const unsubscribeFault = subscribeAuthFault(() => {
      if (valid()) fail(lease);
    });
    let settledByEvent!: () => void;
    const firstEvent = new Promise<void>((resolve) => {
      settledByEvent = resolve;
    });
    const subscription = lease.client.auth.onAuthStateChange((_event, next) => {
      if (!valid()) return;
      events++;
      knownSession.current = next;
      setSession(next);
      setLoading(false);
      settledByEvent();
    }).data.subscription;
    const initialEvents = events;
    void boundedRequest(() =>
      Promise.race([
        lease.client.auth.getSession().then(({ data, error: initialError }) => {
          if (!valid() || events !== initialEvents) return;
          if (initialError) {
            fail(lease);
            return;
          }
          knownSession.current = data.session;
          setSession(data.session);
          setLoading(false);
        }),
        firstEvent,
      ]),
    ).catch(() => {
      if (valid()) fail(lease);
    });
    const update = (state: string) => {
      if (!valid()) return;
      const work =
        state === "active"
          ? lease.client.auth.startAutoRefresh()
          : lease.client.auth.stopAutoRefresh();
      void work
        .then(() => {
          if (!valid()) return lease.client.auth.stopAutoRefresh();
        })
        .catch(() => {
          if (valid()) fail(lease);
        });
    };
    update(AppState.currentState);
    const appState = AppState.addEventListener("change", update);
    return () => {
      alive = false;
      mounted.current = false;
      settledByEvent();
      unsubscribeFault();
      subscription.unsubscribe();
      appState.remove();
      runtime.retire(lease);
    };
  }, [version, fail]);
  function signOut(): Promise<void> {
    if (cleanup.current) return cleanup.current;
    const runtime = authRuntime;
    if (!runtime) return Promise.resolve();
    const current = ++generation.current,
      previous = knownSession.current;
    const captured = previous
      ? {
          access_token: previous.access_token,
          refresh_token: previous.refresh_token,
          expires_at: previous.expires_at,
        }
      : null;
    runtime.retire();
    knownSession.current = null;
    setSession(null);
    setLoading(true);
    setError(false);
    if (captured) void revokeOldSession(captured).catch(() => {});
    cleanup.current = boundedRequest(() => runtime.clear())
      .then(() => {
        if (mounted.current && current === generation.current)
          setVersion((v) => v + 1);
      })
      .catch(() => {
        if (mounted.current && current === generation.current) {
          setError(true);
          setLoading(false);
        }
      })
      .finally(() => {
        cleanup.current = null;
      });
    return cleanup.current;
  }
  async function runAuthOperation<T>(
    work: (client: NativeAuthClient) => Promise<T>,
  ): Promise<T> {
    const lease = authRuntime?.current();
    if (!lease || !lease.active()) throw Error("Auth unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fail(lease);
      controller.abort();
    }, 15000);
    try {
      const result = await abortableRequest(
        () => work(lease.client),
        controller.signal,
      );
      if (
        !mounted.current ||
        authRuntime?.current() !== lease ||
        !lease.active()
      )
        throw Error("Session retired");
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  return (
    <Context.Provider
      value={{ session, loading, error, signOut, runAuthOperation }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
