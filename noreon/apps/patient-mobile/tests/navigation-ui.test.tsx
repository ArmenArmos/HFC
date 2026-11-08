import { describe, test, expect, jest, beforeEach } from "@jest/globals";
import { DoseSchedule } from "../src/lib/dose-schedule";
import { nativeDoseCare } from "../src/lib/doses";
import {
  renderRouter,
  screen,
  fireEvent,
  act,
} from "expo-router/testing-library";
import { render } from "@testing-library/react-native";
import { Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { PropsWithChildren } from "react";
import type { Records } from "../src/lib/records";
import { DEFAULT_REMINDERS } from "../../../lib/patient-care/reminder-preferences";
import Layout from "../src/app/_layout";
import Entry from "../src/app";
import MemberLayout from "../src/app/member/_layout";
import Home from "../src/app/member";
import Progress from "../src/app/member/progress";
import Plan from "../src/app/member/plan";
import Me from "../src/app/member/me";
import { MemberDraftProvider } from "../src/lib/member-draft-context";
import { MeasurementForm } from "../src/lib/measurement-form";
import { ReminderSettings } from "../src/lib/reminder-settings";
import { saveNativeMeasurement, reportNativeDose, acknowledgeNativePlan } from "../src/lib/actions";
import { readRecords } from "../src/lib/records";
import { saveNativeReminders } from "../src/lib/reminder-actions";
type TestAuth = {
  session: { user: { id: string; phone_confirmed_at: string } } | null;
  loading: boolean;
  error: boolean;
  signOut: () => Promise<void>;
};
const mockListeners = new Set<() => void>();
let mockAuth: TestAuth;
const mockConfig = { enabled: true };
jest.mock("../src/lib/auth", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () =>
    require("react").useSyncExternalStore(
      (fn: () => void) => {
        mockListeners.add(fn);
        return () => mockListeners.delete(fn);
      },
      () => mockAuth,
    ),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "aabb0000-0000-4000-8000-000000000001",
}));
jest.mock("../src/lib/login", () => ({ Login: () => null }));
jest.mock("@expo-google-fonts/inter", () => ({
  useFonts: () => [true, null],
  Inter_400Regular: 0,
}));
jest.mock("@expo-google-fonts/manrope", () => ({ Manrope_700Bold: 0 }));
jest.mock("../src/lib/supabase", () => ({
  get config() {
    return mockConfig.enabled
      ? { url: "https://fictional.invalid", key: "fictional" }
      : null;
  },
  supabase: null,
}));
jest.mock("../src/lib/actions", () => ({
  clientFor: jest.fn(async () => ({})),
  saveNativeMeasurement: jest.fn(async () => "unavailable"),
  reportNativeDose: jest.fn(),
  acknowledgeNativePlan: jest.fn(),
}));
jest.mock("../src/lib/records", () => ({
  readRecords: jest.fn(async () => mockRecords),
}));
jest.mock("../src/lib/reminder-actions", () => ({
  saveNativeReminders: jest.fn(async () => ({ status: "unavailable" })),
  readNativeReminders: jest.fn(),
}));
const mockRecords: Records = {
  registered: true,
  profile: {
    display_name: "Fictional member",
    birth_date: "1980-01-01",
    biological_sex: "female",
    locale: "en",
  },
  plan: null,
  medications: [],
  care: { plan: null, tests: [], results: [], appointments: [], events: [] },
  reminders: { revision: 0, preferences: DEFAULT_REMINDERS },
  reminderOffset: 0,
  readAt: new Date().toISOString(),
  measurements: { rows: [], next: null },
  results: { rows: [], next: null },
};
const routes = {
  _layout: Layout,
  index: Entry,
  "member/_layout": MemberLayout,
  "member/index": Home,
  "member/progress": Progress,
  "member/plan": Plan,
  "member/me": Me,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue(null);
  jest.spyOn(SecureStore, "setItemAsync").mockResolvedValue(undefined);
  mockConfig.enabled = true;
  mockAuth = {
    session: { user: { id: "member-one", phone_confirmed_at: "verified" } },
    loading: false,
    error: false,
    signOut: async () => {},
  };
  jest.mocked(readRecords).mockResolvedValue(mockRecords);
});
async function setAuth(value: TestAuth) {
  await act(async () => {
    mockAuth = value;
    mockListeners.forEach((fn) => fn());
  });
}
describe("native member navigation", () => {
  test("BP draft survives real tabs and language changes", async () => {
    await renderRouter(routes, { initialUrl: "/member" });
    await screen.findByText("Fictional member");
    await fireEvent.changeText(
      screen.getByLabelText("Սիստոլիկ (մմ սնդ․ սյուն)"),
      "123",
    );
    await fireEvent.press(screen.getByLabelText("Ես"));
    await fireEvent.press(screen.getByText("EN"));
    await fireEvent.press(screen.getByLabelText("Home"));
    expect(screen.getByLabelText("Systolic (mmHg)").props.value).toBe("123");
  });
  test("conflicting BP submission opens the history tab without losing its draft", async () => {
    await renderRouter(routes, { initialUrl: "/member/me" });
    await fireEvent.press(await screen.findByText("EN"));
    await fireEvent.press(screen.getByLabelText("Home"));
    await screen.findByText("Fictional member");
    jest.mocked(saveNativeMeasurement).mockResolvedValueOnce("conflict");
    await fireEvent.changeText(screen.getByLabelText("Systolic (mmHg)"), "123");
    await fireEvent.changeText(screen.getByLabelText("Diastolic (mmHg)"), "80");
    await fireEvent.press(screen.getByText("Save reading"));
    await fireEvent.press(await screen.findByText("Check your history"));
    expect(screen.getByText("Your progress")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Home"));
    expect(screen.getByLabelText("Systolic (mmHg)").props.value).toBe("123");
  });
  test.each(["disabled", "signed-out", "loading", "unverified", "error"])(
    "%s direct route never reads member records",
    async (mode) => {
      if (mode === "disabled") mockConfig.enabled = false;
      if (mode === "signed-out") mockAuth.session = null;
      if (mode === "loading") mockAuth.loading = true;
      if (mode === "error") mockAuth.error = true;
      if (mode === "unverified")
        mockAuth.session = {
          user: { id: "member-one", phone_confirmed_at: "" },
        };
      await renderRouter(routes, { initialUrl: "/member/plan" });
      expect(screen.queryByText("Fictional member")).toBeNull();
      expect(readRecords).not.toHaveBeenCalled();
    },
  );
  test("account switch resets all member drafts and sign-out removes records", async () => {
    await renderRouter(routes, { initialUrl: "/member" });
    await screen.findByText("Fictional member");
    await fireEvent.changeText(
      screen.getByLabelText("Սիստոլիկ (մմ սնդ․ սյուն)"),
      "123",
    );
    await setAuth({
      ...mockAuth,
      session: { user: { id: "member-two", phone_confirmed_at: "verified" } },
    });
    await screen.findByText("Fictional member");
    expect(screen.getByLabelText("Սիստոլիկ (մմ սնդ․ սյուն)").props.value).toBe(
      "",
    );
    await setAuth({ ...mockAuth, session: null });
    expect(screen.queryByText("Fictional member")).toBeNull();
  });
  test("failed refresh stays visible across tabs while sign-out remains reachable", async () => {
    await renderRouter(routes, { initialUrl: "/member" });
    await screen.findByText("Fictional member");
    jest.mocked(readRecords).mockRejectedValueOnce(Error("offline"));
    await fireEvent.press(screen.getByText("Թարմացնել տվյալները"));
    await screen.findByText(
      "Չհաջողվեց թարմացնել տվյալները։ Ցուցադրված տվյալները կարող են հնացած լինել։",
    );
    await fireEvent.press(screen.getByLabelText("Ես"));
    expect(screen.getByText("Դուրս գալ")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Հիշեցումներ" }));
    expect(screen.getByText("Պահպանել հիշեցումները")).toBeTruthy();
    expect(
      screen.getByLabelText("Լուռ ժամերի սկիզբը (HH:mm)").props.editable,
    ).toBe(false);
  });
});
test("account reminder disclosure retains edits and an in-flight save while language stays on Me", async () => {
  await renderRouter(routes, { initialUrl: "/member/me" });
  await fireEvent.press(await screen.findByText("EN"));
  const row = screen.getByRole("button", { name: "Reminders" });
  expect(row.props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByLabelText("Quiet hours from (HH:mm)")).toBeNull();
  await fireEvent.press(row);
  await fireEvent.changeText(screen.getByLabelText("Quiet hours from (HH:mm)"), "22:00");
  await fireEvent.press(screen.getByRole("button", { name: "Reminders" }));
  await fireEvent.press(screen.getByText("Հայ"));
  expect(screen.getByText("Ձեր հաշիվը")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Հիշեցումներ" }));
  expect(screen.getByLabelText("Լուռ ժամերի սկիզբը (HH:mm)").props.value).toBe("22:00");
  await fireEvent.press(screen.getByText("EN"));
  let finish!: (value: { status: "unavailable" }) => void;
  jest.mocked(saveNativeReminders).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await fireEvent.press(screen.getByText("Save reminder settings"));
  const signal = jest.mocked(saveNativeReminders).mock.calls[0][3]!;
  await fireEvent.press(screen.getByRole("button", { name: "Reminders" }));
  expect(signal.aborted).toBe(false);
  await act(async () => { finish({ status: "unavailable" }); });
  await fireEvent.press(screen.getByRole("button", { name: "Reminders" }));
  expect(screen.getByText("Retry the same settings")).toBeTruthy();
  expect(screen.getByLabelText("Quiet hours from (HH:mm)").props.value).toBe("22:00");
});
test.each([null, {
  id: "fixture-plan", clinician: "Fictional clinician", instructions: "Fixture instructions",
  published_at: "2026-10-11T00:00:00Z", acknowledged_at: null,
}])("Care has one plan heading and preserves the relevant empty or published state", async (plan) => {
  jest.mocked(readRecords).mockResolvedValue({ ...mockRecords, plan });
  await renderRouter(routes, { initialUrl: "/member/me" });
  await fireEvent.press(await screen.findByText("EN"));
  await fireEvent.press(screen.getByLabelText("Care plan"));
  expect(screen.getAllByRole("header", { name: "Your care plan" })).toHaveLength(1);
  if (plan) {
    expect(screen.getByText(plan.instructions)).toBeTruthy();
    expect(screen.getByText(/Fictional clinician/)).toBeTruthy();
    expect(screen.getByText(/11\/10\/2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acknowledge your plan" })).toBeTruthy();
    jest.mocked(acknowledgeNativePlan).mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByRole("button", { name: "Acknowledge your plan" }));
    await screen.findByRole("alert", { name: "We could not complete that. Please try again." });
    jest.mocked(acknowledgeNativePlan).mockResolvedValueOnce(true);
    jest.mocked(readRecords).mockResolvedValue({
      ...mockRecords, plan: { ...plan, acknowledged_at: "2026-10-13T00:00:00Z" },
    });
    await fireEvent.press(screen.getByRole("button", { name: "Acknowledge your plan" }));
    await screen.findByText("You have acknowledged this plan.");
    expect(screen.queryByRole("button", { name: "Acknowledge your plan" })).toBeNull();
  } else {
    expect(screen.getByText("Your care plan is not available yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge your plan" })).toBeNull();
  }
});
test("disabled native entry sends the selected language to its web fallback", async () => {
  mockConfig.enabled = false;
  mockAuth.session = null;
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  try {
    await renderRouter(routes, { initialUrl: "/" });
    await fireEvent.press(screen.getByText("EN"));
    await fireEvent.press(screen.getByText("Open your web app"));
    expect(open).toHaveBeenLastCalledWith("https://app.noreon.health/patient?locale=en");
    await fireEvent.press(screen.getByText("Հայ"));
    await fireEvent.press(screen.getByText("Բացել վեբ հավելվածը"));
    expect(open).toHaveBeenLastCalledWith("https://app.noreon.health/patient?locale=hy");
  } finally { open.mockRestore(); }
});
test("forced BP screen remount retains the exact uncertain retry rather than allocating another reading", async () => {
  const form = (key: string) => (
    <MemberDraftProvider>
      <MeasurementForm
        key={key}
        userId="member-one"
        locale="en"
        onSaved={() => {}}
      />
    </MemberDraftProvider>
  );
  const view = await render(form("first"));
  await fireEvent.changeText(screen.getByLabelText("Systolic (mmHg)"), "123");
  await fireEvent.changeText(screen.getByLabelText("Diastolic (mmHg)"), "80");
  await fireEvent.press(screen.getByText("Save reading"));
  await screen.findByText("Retry the same reading");
  const first = jest.mocked(saveNativeMeasurement).mock.calls[0][1];
  await view.rerender(form("second"));
  expect(screen.getByLabelText("Systolic (mmHg)").props.editable).toBe(false);
  await fireEvent.press(screen.getByText("Retry the same reading"));
  expect(jest.mocked(saveNativeMeasurement).mock.calls[1][1]).toEqual(first);
});
test("forced settings remount retains draft revision and exact uncertain preferences", async () => {
  const form = (key: string) => (
    <MemberDraftProvider>
      <ReminderSettings
        key={key}
        userId="member-one"
        locale="en"
        saved={mockRecords.reminders}
        unavailable={false}
        onSaved={() => {}}
      />
    </MemberDraftProvider>
  );
  const view = await render(form("first"));
  await fireEvent.changeText(
    screen.getByLabelText("Quiet hours from (HH:mm)"),
    "22:00",
  );
  await fireEvent.press(screen.getByText("Save reminder settings"));
  await screen.findByText("Retry the same settings");
  const first = jest.mocked(saveNativeReminders).mock.calls[0];
  await view.rerender(form("second"));
  expect(screen.getByLabelText("Quiet hours from (HH:mm)").props.value).toBe(
    "22:00",
  );
  await fireEvent.press(screen.getByText("Retry the same settings"));
  const next = jest.mocked(saveNativeReminders).mock.calls[1];
  expect(next.slice(0, 3)).toEqual(first.slice(0, 3));
});

test("late records from a previous account cannot replace the new account snapshot", async () => {
  let finish!: (value: Records) => void;
  jest
    .mocked(readRecords)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({
      ...mockRecords,
      profile: {
        ...mockRecords.profile!,
        display_name: "Second fictional member",
      },
    });
  await renderRouter(routes, { initialUrl: "/member" });
  await setAuth({
    ...mockAuth,
    session: { user: { id: "member-two", phone_confirmed_at: "verified" } },
  });
  await screen.findByText("Second fictional member");
  await act(async () => {
    finish(mockRecords);
  });
  expect(screen.queryByText("Fictional member")).toBeNull();
  expect(screen.getByText("Second fictional member")).toBeTruthy();
});
test("dose retry survives remount and a newer server revision supersedes it", async () => {
  const now = new Date("2026-10-12T05:00:00Z");
  const plan = {
    id: "plan",
    clinician: "Fictional clinician",
    instructions: "Fixture only",
    published_at: "2026-10-11T00:00:00Z",
    acknowledged_at: null,
  };
  const meds = [
    {
      id: "medicine",
      name: "Fixture medicine",
      dose: "Fixture dose",
      instructions: "Fixture only",
      times: ["08:00"],
      start_date: "2026-10-11",
      end_date: null,
    },
  ];
  const initial = {
    ...mockRecords,
    readAt: now.toISOString(),
    plan,
    medications: meds,
    care: nativeDoseCare(plan, meds, []),
  };
  const form = (key: string, data: Records) => (
    <MemberDraftProvider>
      <DoseSchedule
        key={key}
        data={data}
        now={now}
        userId="member-one"
        locale="en"
        unavailable={false}
        onRefresh={() => {}}
      />
    </MemberDraftProvider>
  );
  jest.mocked(reportNativeDose).mockResolvedValue("unavailable");
  const view = await render(form("first", initial));
  await fireEvent.press(screen.getByText("Record as taken"));
  await screen.findByText("Retry the same report");
  const first = jest.mocked(reportNativeDose).mock.calls[0][1];
  await view.rerender(form("second", initial));
  await fireEvent.press(screen.getByText("Retry the same report"));
  expect(jest.mocked(reportNativeDose).mock.calls[1][1]).toEqual(first);
  const updated = {
    ...initial,
    care: nativeDoseCare(plan, meds, [
      {
        medication_id: "medicine",
        due_at: "2026-10-12T04:00:00Z",
        status: "taken",
        recorded_at: now.toISOString(),
        revision: 1,
      },
    ]),
  };
  await view.rerender(form("third", updated));
  expect(screen.queryByText("Retry the same report")).toBeNull();
  expect(screen.getByText("You reported taken")).toBeTruthy();
});

jest.mock("../src/lib/journey-provider", () => ({
  JourneyProvider: ({ children }: PropsWithChildren) => children,
  useJourney: () => ({ open: jest.fn() }),
}));
jest.mock("../src/lib/journey-gate", () => ({
  JourneyGate: ({ children }: PropsWithChildren) => children,
}));


test("restored device language opens the current Me route in EN", async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue("en");
  await renderRouter(routes, { initialUrl: "/member/me" });
  await screen.findByText("Your account");
  expect(readRecords).toHaveBeenCalled();
  expect(screen.queryByText("Ձեր հաշիվը")).toBeNull();
});

test("language storage failure leaves Me usable and the same choice can be saved again", async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(Error("device storage failure"));
  await renderRouter(routes, { initialUrl: "/member/me" });
  await fireEvent.press(await screen.findByText("EN"));
  await screen.findByText("Language could not be saved. Choose it again.");
  expect(screen.getByText("Your account")).toBeTruthy();
  expect(readRecords).toHaveBeenCalled();
  expect(screen.getByText("Sign out")).toBeTruthy();
  await fireEvent.press(screen.getByText("EN"));
  expect(screen.queryByText("Language could not be saved. Choose it again.")).toBeNull();
  await fireEvent.press(screen.getByText("Հայ"));
  expect(screen.getByText("Ձեր հաշիվը")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Գլխավոր"));
  expect(screen.getByText("Fictional member")).toBeTruthy();
});
