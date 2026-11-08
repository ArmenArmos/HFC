import { jest, test, beforeEach, afterEach, expect } from "@jest/globals";
import { Text, Button } from "react-native";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react-native";
import type { Session } from "@supabase/supabase-js";
import type { SecureDriver } from "../src/lib/session-storage";
import { createCredentialVault } from "../src/lib/auth-boundary";
import { createAuthLifetime, type AuthLease } from "../src/lib/auth-lifetime";
import { AuthProvider, useAuth } from "../src/lib/auth";
import { Login } from "../src/lib/login";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const member = {
  access_token: "fictional-token",
  user: { id: "member-one", phone_confirmed_at: "verified" },
} as Session;
let mockValues: Map<string, string>;
let mockRemove: jest.Mock<(k: string) => Promise<void>>;
let mockVault: ReturnType<typeof createCredentialVault>;
let mockGetSession: jest.Mock<
  () => Promise<{ data: { session: Session | null }; error: null }>
>;
let mockSignIn: jest.Mock<() => Promise<{ error: null }>>;
let mockVerify: jest.Mock<() => Promise<{ error: null }>>;
const mockRevoke = jest.fn(async (_session: unknown) => {});
const mockFaultListeners = new Set<() => void>();
type MockClient = {
  storage: SecureDriver;
  emit: (session: Session | null) => void;
  auth: {
    getSession: typeof mockGetSession;
    onAuthStateChange: (
      fn: (event: string, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe(): void } } };
    startAutoRefresh: () => Promise<void>;
    stopAutoRefresh: () => Promise<void>;
    signInWithOtp: typeof mockSignIn;
    verifyOtp: typeof mockVerify;
  };
};
function mockMakeClient(): AuthLease<MockClient> {
  let active = true;
  const storageLease = mockVault.lease(() =>
    mockFaultListeners.forEach((f) => f()),
  );
  const callbacks = new Set<(event: string, next: Session | null) => void>();
  const client = {
    storage: storageLease.storage,
    emit: (session: Session | null) =>
      callbacks.forEach((f) => f("SIGNED_IN", session)),
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: (
        fn: (event: string, next: Session | null) => void,
      ) => {
        callbacks.add(fn);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      startAutoRefresh: jest.fn(async () => {}),
      stopAutoRefresh: jest.fn(async () => {}),
      signInWithOtp: mockSignIn,
      verifyOtp: mockVerify,
    },
  };
  mockClients.push(client);
  return {
    client,
    active: () => active,
    retire: () => {
      active = false;
      storageLease.retire();
    },
  };
}
let mockClients: ReturnType<typeof mockMakeClient>["client"][];
let mockLifetime: ReturnType<
  typeof createAuthLifetime<ReturnType<typeof mockMakeClient>["client"]>
>;
jest.mock("../src/lib/supabase", () => ({
  get authRuntime() {
    return mockLifetime;
  },
  config: {
    captchaSiteKey: "fictional",
    captchaOrigin: "https://fictional.invalid",
  },
  revokeOldSession: (session: unknown) => mockRevoke(session),
  subscribeAuthFault: (fn: () => void) => {
    mockFaultListeners.add(fn);
    return () => mockFaultListeners.delete(fn);
  },
}));
let mockCaptchaMessage: (event: unknown) => Promise<void>;
jest.mock("@hcaptcha/react-native-hcaptcha", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: React.forwardRef(
      (props: { onMessage: typeof mockCaptchaMessage }, ref: unknown) => {
        mockCaptchaMessage = props.onMessage;
        React.useImperativeHandle(ref, () => ({ show() {}, hide() {} }));
        return null;
      },
    ),
  };
});
function Probe({ login = false }: { login?: boolean }) {
  const auth = useAuth();
  return (
    <>
      <Text>
        {auth.loading
          ? "loading"
          : auth.error
            ? "error"
            : (auth.session?.user.id ?? "public")}
      </Text>
      <Button
        title="reset"
        onPress={() => {
          void auth.signOut();
        }}
      />
      <Button
        title="work"
        onPress={() => {
          void auth
            .runAuthOperation(async () => {
              await mockVerify();
            })
            .catch(() => {});
        }}
      />
      {login && <Login locale="en" />}
    </>
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  mockClients = [];
  mockValues = new Map();
  mockFaultListeners.clear();
  mockRevoke.mockReset().mockResolvedValue(undefined);
  mockGetSession = jest.fn(async () => ({
    data: { session: null },
    error: null,
  }));
  mockSignIn = jest.fn(async () => ({ error: null }));
  mockVerify = jest.fn(async () => ({ error: null }));
  mockRemove = jest.fn(async (k: string) => {
    mockValues.delete(k);
  });
  mockVault = createCredentialVault(
    {
      getItem: async (k) => mockValues.get(k) ?? null,
      setItem: async (k, v) => {
        mockValues.set(k, v);
      },
      removeItem: (k) => mockRemove(k),
    },
    "session",
  );
  mockLifetime = createAuthLifetime(mockMakeClient, () => mockVault.clear());
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test("stalled initialization closes access and ignores late sessions until cleanup recovery", async () => {
  const initial = deferred<{
    data: { session: Session | null };
    error: null;
  }>();
  mockGetSession.mockImplementationOnce(() => initial.promise);
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(screen.getByText("loading")).toBeTruthy();
  const old = mockClients[0];
  await act(async () => {
    jest.advanceTimersByTime(15001);
  });
  expect(screen.getByText("error")).toBeTruthy();
  expect(mockLifetime.current()).toBeNull();
  await act(async () => {
    initial.resolve({ data: { session: member }, error: null });
    old.emit(member);
  });
  expect(screen.getByText("error")).toBeTruthy();
  await fireEvent.press(screen.getByText("reset"));
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockRemove).toHaveBeenCalled();
  await act(async () => old.emit(member));
  expect(screen.getByText("public")).toBeTruthy();
});

test("auth event wins over stale initial reply", async () => {
  const initial = deferred<{
    data: { session: Session | null };
    error: null;
  }>();
  mockGetSession.mockImplementationOnce(() => initial.promise);
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => mockClients[0].emit(member));
  await act(async () => {
    initial.resolve({ data: { session: null }, error: null });
    jest.advanceTimersByTime(15001);
  });
  expect(screen.getByText("member-one")).toBeTruthy();
});

test("logout clears credentials without waiting for stalled remote revocation", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => {
    mockClients[0].emit(member);
  });
  mockValues.set("session", "private");
  mockRevoke.mockImplementationOnce(() => new Promise<void>(() => {}));
  await fireEvent.press(screen.getByText("reset"));
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockValues.size).toBe(0);
  expect(mockRevoke).toHaveBeenCalledWith(
    expect.objectContaining({ access_token: "fictional-token" }),
  );
});

test("failed deletion blocks replacement and retry only opens after confirmed deletion", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  mockRemove.mockRejectedValueOnce(Error("private native error"));
  await fireEvent.press(screen.getByText("reset"));
  expect(screen.getByText("error")).toBeTruthy();
  expect(mockLifetime.current()).toBeNull();
  expect(mockClients.length).toBe(1);
  await fireEvent.press(screen.getByText("reset"));
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockClients.length).toBe(2);
});

test("hung native deletion has a visible deadline and stays closed across retry", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  const finish = deferred<void>();
  mockRemove.mockImplementationOnce(() => finish.promise);
  await fireEvent.press(screen.getByText("reset"));
  await act(async () => {
    jest.advanceTimersByTime(15001);
  });
  expect(screen.getByText("error")).toBeTruthy();
  expect(mockClients.length).toBe(1);
  await fireEvent.press(screen.getByText("reset"));
  expect(mockClients.length).toBe(1);
  await act(async () => finish.resolve());
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockClients.length).toBe(2);
});

test("timed out verification cannot persist or emit a late session after recovery", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  const old = mockClients[0],
    finish = deferred<void>();
  mockVerify.mockImplementationOnce(async () => {
    await finish.promise;
    await old.storage.setItem("session", "late");
    old.emit(member);
    return { error: null };
  });
  await fireEvent.press(screen.getByText("work"));
  await act(async () => {
    jest.advanceTimersByTime(15001);
  });
  expect(screen.getByText("error")).toBeTruthy();
  await fireEvent.press(screen.getByText("reset"));
  await act(async () => finish.resolve());
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockValues.size).toBe(0);
});

test("unmount retires the client and old events cannot affect a new provider", async () => {
  const view = await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  const old = mockClients[0];
  await view.unmount();
  expect(mockLifetime.current()).toBeNull();
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => old.emit(member));
  expect(screen.getByText("public")).toBeTruthy();
});

test("duplicate CAPTCHA messages and verify presses make only one OTP request each", async () => {
  await render(
    <AuthProvider>
      <Probe login />
    </AuthProvider>,
  );
  await fireEvent.changeText(
    screen.getByLabelText("Your phone number"),
    "+37499000000",
  );
  await fireEvent.press(screen.getByText("Send my code"));
  const sent = deferred<{ error: null }>();
  mockSignIn.mockImplementation(() => sent.promise);
  const challenge = {
    success: true,
    nativeEvent: { data: "fictional-challenge" },
    markUsed() {},
  };
  await act(async () => {
    void mockCaptchaMessage(challenge);
    void mockCaptchaMessage(challenge);
  });
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  await act(async () => {
    void mockCaptchaMessage({
      success: false,
      nativeEvent: { data: "cancel" },
    });
    sent.resolve({ error: null });
  });
  await fireEvent.changeText(
    screen.getByLabelText("Your verification code"),
    "123456",
  );
  const verified = deferred<{ error: null }>();
  mockVerify.mockImplementation(() => verified.promise);
  await fireEvent.press(screen.getByText("Verify my number"));
  await fireEvent.press(screen.getByText("Verify my number"));
  expect(mockVerify).toHaveBeenCalledTimes(1);
  await act(async () => verified.resolve({ error: null }));
});

test("repeated logout shares credential cleanup and server revocation", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => mockClients[0].emit(member));
  const finish = deferred<void>();
  mockRemove.mockImplementationOnce(() => finish.promise);
  await fireEvent.press(screen.getByText("reset"));
  await fireEvent.press(screen.getByText("reset"));
  expect(mockRevoke).toHaveBeenCalledTimes(1);
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(screen.getByText("loading")).toBeTruthy();
  await act(async () => finish.resolve());
  expect(screen.getByText("public")).toBeTruthy();
  expect(mockClients.length).toBe(2);
});

test("a current secure-storage fault closes member access and ignores subsequent events", async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  const old = mockClients[0];
  await act(async () => old.emit(member));
  await act(async () => mockFaultListeners.forEach((f) => f()));
  expect(screen.getByText("error")).toBeTruthy();
  expect(mockLifetime.current()).toBeNull();
  await act(async () => old.emit(member));
  expect(screen.getByText("error")).toBeTruthy();
});
