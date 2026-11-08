import { beforeAll, describe, test, expect, jest } from "@jest/globals";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Text } from "react-native";
import { JourneyProvider } from "../src/lib/journey-provider";
import { JourneyGate } from "../src/lib/journey-gate";
import { LocaleProvider } from "../src/lib/locale-context";
import type {
  JourneySnapshot,
  JourneyTransport,
} from "../src/lib/journey-protocol";
jest.mock("../src/lib/auth", () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));
jest.mock("../src/lib/journey-api", () => ({
  nativeJourneyTransport: jest.fn(),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
}));
const blank: JourneySnapshot = {
  consentVersion: "patient-pilot-v1",
  state: { profile: null, consentAccepted: false, assessment: null },
};
function mount(transport: JourneyTransport) {
  return render(
    <LocaleProvider>
      <JourneyProvider userId="member" transport={transport}>
        <JourneyGate>
          <Text>Member tabs</Text>
        </JourneyGate>
      </JourneyProvider>
    </LocaleProvider>,
  );
}
async function english() {
  await screen.findByText("EN");
  await fireEvent.press(screen.getByText("EN"));
}
// The first render in this file loads and compiles the whole journey tree:
// about 1.3 s locally against 10-40 ms for every later test, and past jest's
// 5 s limit on a busy CI runner (#197, #221). Pay that once here, under its
// own limit, so no single test carries it.
beforeAll(async () => {
  const view = await mount({ read: async () => blank, write: async () => ({ ok: false, reason: "invalid" }) });
  await screen.findByText("EN");
  await view.unmount();
}, 30_000);
describe("native onboarding", () => {
  test("profile needs explicit consent and valid date before sending a write", async () => {
    const write = jest.fn<JourneyTransport["write"]>(async () => ({
      ok: false,
      reason: "invalid",
    }));
    await mount({ read: async () => blank, write });
    await english();
    await fireEvent.changeText(
      screen.getByLabelText("Your name"),
      "Fictional member",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Date of birth (YYYY-MM-DD)"),
      "1980-01-01",
    );
    await fireEvent.press(screen.getByText("Female"));
    await fireEvent.press(screen.getByText("Save profile"));
    expect(write).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("checkbox"));
    await fireEvent.press(screen.getByText("Save profile"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
  test("saved write followed by failed state read blocks progression and never resends on reload", async () => {
    let reads = 0;
    const read = jest.fn<JourneyTransport["read"]>(async () => {
      reads++;
      if (reads > 1) throw Error();
      return blank;
    });
    const write = jest.fn<JourneyTransport["write"]>(async () => ({
      ok: true,
      revision: 0,
    }));
    await mount({ read, write });
    await english();
    await fireEvent.changeText(
      screen.getByLabelText("Your name"),
      "Fictional member",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Date of birth (YYYY-MM-DD)"),
      "1980-01-01",
    );
    await fireEvent.press(screen.getByText("Female"));
    await fireEvent.press(screen.getByRole("checkbox"));
    await fireEvent.press(screen.getByText("Save profile"));
    await screen.findByText("Reload saved values and replace this edit");
    await fireEvent.press(
      screen.getByText("Reload saved values and replace this edit"),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Member tabs")).toBeNull();
  });
});
import { useState } from "react";
import fixture from "../../../scripts/fixtures/patient-answers.json";
import type { Answers, AssessmentField } from "../../../lib/clinical/types";
import { fieldById } from "../../../lib/clinical/seed/questions";
import {
  JourneyField,
  fieldEntries,
  type RawAnswers,
} from "../src/lib/journey-field";
function existing(answers: Answers): JourneySnapshot {
  return {
    consentVersion: "patient-pilot-v1",
    state: {
      profile: {
        userId: "member",
        name: "Fictional member",
        birthDate: "1974-05-18",
        biologicalSex: "male",
        locale: "en",
      },
      consentAccepted: true,
      assessment: {
        id: "draft",
        revision: 0,
        assessmentDate: "2026-10-12",
        answers,
        completedAt: null,
        urgentRule: null,
      },
    },
  };
}
test("invalid numeric answer cannot save or advance", async () => {
  const answers = structuredClone(fixture) as Answers;
  delete answers["q2.height"];
  const write = jest.fn<JourneyTransport["write"]>();
  await mount({ read: async () => existing(answers), write });
  await english();
  const label = fieldById("q2.height")!.label.en!;
  await fireEvent.changeText(screen.getByLabelText(label), "-1");
  await fireEvent.press(screen.getByText("Save and continue"));
  expect(write).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
});

test("unanswered first question has one continuation action and no saved-answer controls", async () => {
  const write = jest.fn<JourneyTransport["write"]>();
  await mount({ read: async () => existing({}), write });
  await english();
  expect(screen.queryByText("Clear this saved answer")).toBeNull();
  expect(screen.queryByText("Go back")).toBeNull();
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  await fireEvent.press(screen.getByLabelText("I think it is normal"));
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeEnabled();
  expect(screen.queryByText("Clear this saved answer")).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test("explicit unknown enables continuation and saves as an answer", async () => {
  const write = jest.fn<JourneyTransport["write"]>(async () => ({ ok: false, reason: "unavailable" }));
  await mount({ read: async () => existing({}), write });
  await english();
  await fireEvent.press(screen.getByLabelText("I don't know"));
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeEnabled();
  await fireEvent.press(screen.getByText("Save and continue"));
  await waitFor(() => expect(write).toHaveBeenCalledWith({
    type: "answers", expectedRevision: 0,
    entries: [{ fieldId: "q2.weight_perception", value: "unknown" }],
  }, expect.anything()));
});

test("persisted answer can be cleared using its revision even when editing", async () => {
  const data = existing(structuredClone(fixture) as Answers);
  const write = jest.fn<JourneyTransport["write"]>(async () => ({ ok: false, reason: "unavailable" }));
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.press(screen.getByLabelText("I think I am overweight"));
  await fireEvent.press(screen.getByText("Clear this saved answer"));
  await waitFor(() => expect(write).toHaveBeenCalledWith({
    type: "answers", expectedRevision: 0,
    entries: [{ fieldId: "q2.weight_perception", value: null }],
  }, expect.anything()));
});

test("later question saves its changed answer before navigating back", async () => {
  let data = existing(structuredClone(fixture) as Answers);
  delete data.state.assessment!.answers["q2.height"];
  const write = jest.fn<JourneyTransport["write"]>(async (command) => {
    if (command.type !== "answers") return { ok: false, reason: "invalid" };
    data = existing({ ...data.state.assessment!.answers, "q2.height": {
      fieldId: "q2.height", value: 175, source: "manual", answeredAt: "2026-10-12T00:00:00Z",
    } });
    data.state.assessment!.revision = 1;
    return { ok: true, revision: 1 };
  });
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.changeText(screen.getByLabelText("Your height"), "175");
  await fireEvent.press(screen.getByText("Go back"));
  await screen.findByText("How would you describe your weight?");
  expect(write).toHaveBeenCalledWith({
    type: "answers", expectedRevision: 0,
    entries: [{ fieldId: "q2.height", value: 175 }],
  }, expect.anything());
  expect(screen.queryByText("Go back")).toBeNull();
});

test("valid edit of a saved height is persisted before back and restored on revisit", async () => {
  let data = existing(structuredClone(fixture) as Answers);
  const write = jest.fn<JourneyTransport["write"]>(async (command) => {
    if (command.type !== "answers") return { ok: false, reason: "invalid" };
    data = structuredClone(data);
    for (const entry of command.entries) {
      if (entry.value !== null) data.state.assessment!.answers[entry.fieldId] = {
        fieldId: entry.fieldId, value: entry.value, source: "manual", answeredAt: "2026-10-12T00:00:00Z",
      };
    }
    data.state.assessment!.revision++;
    return { ok: true, revision: data.state.assessment!.revision };
  });
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  await fireEvent.changeText(screen.getByLabelText("Your height"), "175");
  await fireEvent.press(screen.getByText("Go back"));
  await screen.findByText("How would you describe your weight?");
  expect(data.state.assessment!.answers["q2.height"].value).toBe(175);
  expect(write).toHaveBeenLastCalledWith({ type: "answers", expectedRevision: 1,
    entries: [{ fieldId: "q2.height", value: 175 }],
  }, expect.anything());
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  expect(screen.getByLabelText("Your height").props.value).toBe("175");
});

test("blank later question goes back without a write or validation error", async () => {
  const answers = structuredClone(fixture) as Answers;
  delete answers["q2.height"];
  const write = jest.fn<JourneyTransport["write"]>();
  await mount({ read: async () => existing(answers), write });
  await english();
  await fireEvent.press(screen.getByText("Go back"));
  expect(screen.getByText("How would you describe your weight?")).toBeTruthy();
  expect(screen.queryByText("Check your answer and the displayed bounds.")).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test.each(["-1", "1.", ""])("unfinished height draft %p survives back and forward across another saved answer", async (raw) => {
  let data = existing(structuredClone(fixture) as Answers);
  delete data.state.assessment!.answers["q2.height"];
  const write = jest.fn<JourneyTransport["write"]>(async (command) => {
    if (command.type !== "answers") return { ok: false, reason: "invalid" };
    data = structuredClone(data);
    data.state.assessment!.revision++;
    return { ok: true, revision: data.state.assessment!.revision };
  });
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.changeText(screen.getByLabelText("Your height"), raw);
  await fireEvent.press(screen.getByText("Go back"));
  expect(screen.getByText("How would you describe your weight?")).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  expect(screen.getByLabelText("Your height").props.value).toBe(raw);
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
});

test("empty edit of a saved height survives navigation without clearing the clinical answer", async () => {
  let data = existing(structuredClone(fixture) as Answers);
  const savedHeight = data.state.assessment!.answers["q2.height"].value;
  const write = jest.fn<JourneyTransport["write"]>(async () => {
    data = structuredClone(data);
    data.state.assessment!.revision++;
    return { ok: true, revision: data.state.assessment!.revision };
  });
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  await fireEvent.changeText(screen.getByLabelText("Your height"), "");
  await fireEvent.press(screen.getByText("Go back"));
  expect(write).toHaveBeenCalledTimes(1);
  expect(data.state.assessment!.answers["q2.height"].value).toBe(savedHeight);
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  expect(screen.getByLabelText("Your height").props.value).toBe("");
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
});

test("failed back save keeps the changed answer on screen and blocks further navigation", async () => {
  const answers = structuredClone(fixture) as Answers;
  delete answers["q2.height"];
  const write = jest.fn<JourneyTransport["write"]>(async () => ({ ok: false, reason: "unavailable" }));
  await mount({ read: async () => existing(answers), write });
  await english();
  await fireEvent.changeText(screen.getByLabelText("Your height"), "175");
  await fireEvent.press(screen.getByText("Go back"));
  await screen.findByText("Reload saved values and replace this edit");
  expect(screen.getByLabelText("Your height").props.value).toBe("175");
  expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
  expect(write).toHaveBeenCalledTimes(1);
});

test("explicit recovery reload replaces drafts from earlier questions", async () => {
  let data = existing(structuredClone(fixture) as Answers);
  delete data.state.assessment!.answers["q2.height"];
  let fail = true;
  const write = jest.fn<JourneyTransport["write"]>(async () => {
    if (fail) return { ok: false, reason: "unavailable" };
    data = structuredClone(data);
    data.state.assessment!.revision++;
    return { ok: true, revision: data.state.assessment!.revision };
  });
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.changeText(screen.getByLabelText("Your height"), "-1");
  await fireEvent.press(screen.getByText("Go back"));
  await fireEvent.press(screen.getByText("Save and continue"));
  await fireEvent.press(await screen.findByText("Reload saved values and replace this edit"));
  await screen.findByText("Your height");
  expect(screen.getByLabelText("Your height").props.value).toBe("");
  fail = false;
  await fireEvent.press(screen.getByText("Go back"));
  await fireEvent.press(screen.getByText("Save and continue"));
  await screen.findByText("Your height");
  expect(screen.getByLabelText("Your height").props.value).toBe("");
});

test("utility disclosure exposes accessible web and sign-out actions and can collapse", async () => {
  await mount({ read: async () => existing({}), write: async () => ({ ok: false, reason: "unavailable" }) });
  await english();
  expect(screen.queryByText("Open web app")).toBeNull();
  expect(screen.queryByText("Sign out")).toBeNull();
  const disclosure = screen.getByRole("button", { name: "More options" });
  expect(disclosure.props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(disclosure);
  expect(screen.getByRole("button", { name: "More options" }).props.accessibilityState.expanded).toBe(true);
  expect(screen.getByRole("button", { name: "Open web app" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "More options" }));
  expect(screen.queryByText("Open web app")).toBeNull();
  expect(screen.queryByText("Sign out")).toBeNull();
});
test.each(["Save and continue", "Go back"])("new urgent answer retains guidance when %s fails offline", async (action) => {
  const answers = structuredClone(fixture) as Answers;
  answers["q9.present"] = {
    fieldId: "q9.present",
    value: "yes",
    source: "manual",
    answeredAt: "2026-10-12T00:00:00Z",
  };
  delete answers["q9.right_now"];
  const write = jest.fn<JourneyTransport["write"]>(async () => {
    throw Error("offline");
  });
  await mount({ read: async () => existing(answers), write });
  await english();
  const yes = fieldById("q9.right_now")!.options!.find(
    (o) => o.value === "yes",
  )!.label.en!;
  await fireEvent.press(screen.getByLabelText(yes));
  expect(screen.getByText("Urgent guidance")).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText(action));
  await screen.findByText("Reload saved values and replace this edit");
  expect(screen.getByText("Urgent guidance")).toBeTruthy();
  expect(screen.queryByText("Member tabs")).toBeNull();
});
function FieldHarness({ field }: { field: AssessmentField }) {
  const [raw, setRaw] = useState<RawAnswers>({});
  return (
    <>
      <JourneyField
        field={field}
        raw={raw}
        onChange={setRaw}
        disabled={false}
        locale="en"
      />
      <Text testID="raw">{JSON.stringify(raw)}</Text>
    </>
  );
}
test("BP and unknown controls preserve missingness; malformed numbers never coerce to zero", async () => {
  const field = fieldById("q5.last_reading")!;
  await render(<FieldHarness field={field} />);
  await fireEvent.changeText(screen.getByLabelText("Systolic"), "120");
  await fireEvent.changeText(screen.getByLabelText("Diastolic"), "80");
  expect(screen.getByTestId("raw").props.children).toContain("120");
  await fireEvent.press(screen.getByText("I don’t know"));
  const raw = JSON.parse(screen.getByTestId("raw").props.children);
  expect(
    fieldEntries(field, raw).every((e) => typeof e.value === "string"),
  ).toBe(true);
  expect(() =>
    fieldEntries(field, {
      "q5.last_reading.systolic": "",
      "q5.last_reading.diastolic": "80",
    }),
  ).toThrow();
  expect(() =>
    fieldEntries(field, {
      "q5.last_reading.systolic": "1.",
      "q5.last_reading.diastolic": "80",
    }),
  ).toThrow();
});
test("multi-choice exclusive option clears other selections", async () => {
  const field = fieldById("q7.relatives")!;
  await render(<FieldHarness field={field} />);
  const exclusive = field.options!.find(
      (o) => o.value === (field.exclusiveValue ?? "none"),
    )!,
    other = field.options!.find((o) => o.value !== exclusive.value)!;
  await fireEvent.press(screen.getByLabelText(other.label.en!));
  await fireEvent.press(screen.getByLabelText(exclusive.label.en!));
  expect(
    JSON.parse(screen.getByTestId("raw").props.children)[field.id],
  ).toEqual([exclusive.value]);
});
test("saved urgent answer cannot be hidden by stale completion metadata", async () => {
  const answers = structuredClone(fixture) as Answers;
  answers["q9.present"] = {
    fieldId: "q9.present",
    value: "yes",
    source: "manual",
    answeredAt: "2026-10-12T00:00:00Z",
  };
  answers["q9.right_now"] = {
    fieldId: "q9.right_now",
    value: "yes",
    source: "manual",
    answeredAt: "2026-10-12T00:00:00Z",
  };
  const data = existing(answers);
  data.state.assessment!.completedAt = "2026-10-12T01:00:00Z";
  await mount({
    read: async () => data,
    write: async () => ({ ok: false, reason: "invalid" }),
  });
  await english();
  expect(screen.queryByText("Member tabs")).toBeNull();
  expect(screen.getByText("Urgent guidance")).toBeTruthy();
});
import { activeFields } from "../../../lib/patient/questionnaire";
test("saved urgent guidance stays visible when back cannot confirm a correction", async () => {
  const answers = structuredClone(fixture) as Answers;
  for (const fieldId of ["q9.present", "q9.right_now"])
    answers[fieldId] = { fieldId, value: "yes", source: "manual", answeredAt: "2026-10-12T00:00:00Z" };
  const data = existing(answers);
  data.state.assessment!.urgentRule = "RF-01";
  const write = jest.fn<JourneyTransport["write"]>(async () => ({ ok: false, reason: "unavailable" }));
  await mount({ read: async () => data, write });
  await english();
  await fireEvent.press(screen.getByLabelText(fieldById("q9.right_now")!.options!.find(o => o.value === "no")!.label.en!));
  await fireEvent.press(screen.getByText("Go back"));
  await screen.findByText("Reload saved values and replace this edit");
  expect(screen.getByText("Urgent guidance")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
  expect(screen.queryByText("Member tabs")).toBeNull();
});

test("complete saved questionnaire returns to tabs only after explicit confirmation and read", async () => {
  let data = existing(structuredClone(fixture) as Answers),
    writes = 0;
  const write = jest.fn<JourneyTransport["write"]>(async (command) => {
    writes++;
    data = {
      ...data,
      state: {
        ...data.state,
        assessment: {
          ...data.state.assessment!,
          revision: writes,
          completedAt: "2026-10-12T01:00:00Z",
        },
      },
    };
    return { ok: true, revision: writes };
  });
  await mount({ read: async () => data, write });
  await english();
  const count = activeFields(data.state.assessment!.answers).filter(
    (f) => f.topic.id !== "q1",
  ).length;
  for (let i = 0; i < count; i++) {
    await fireEvent.press(screen.getByText("Save and continue"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(i + 1));
    expect(screen.queryByText("Member tabs")).toBeNull();
  }
  await fireEvent.press(await screen.findByText("Confirm questionnaire"));
  await screen.findByText("Member tabs");
  expect(write.mock.calls.at(-1)?.[0].type).toBe("complete");
});
import { useJourney } from "../src/lib/journey-provider";
function OwnerProbe() {
  const { state } = useJourney();
  return (
    <Text testID="owner">{state.data?.state.profile?.name ?? "loading"}</Text>
  );
}
test("changing member identity disposes pending old-owner reads even without a caller key", async () => {
  let resolveOld!: (s: JourneySnapshot) => void;
  const oldRead = new Promise<JourneySnapshot>((r) => (resolveOld = r));
  const oldTransport: JourneyTransport = {
    read: () => oldRead,
    write: async () => ({ ok: false, reason: "unavailable" }),
  };
  const fresh = existing(structuredClone(fixture) as Answers);
  fresh.state.profile!.userId = "second";
  fresh.state.profile!.name = "Second fictional member";
  const nextTransport: JourneyTransport = {
    read: async () => fresh,
    write: async () => ({ ok: false, reason: "unavailable" }),
  };
  const view = await render(
    <JourneyProvider userId="first" transport={oldTransport}>
      <OwnerProbe />
    </JourneyProvider>,
  );
  await view.rerender(
    <JourneyProvider userId="second" transport={nextTransport}>
      <OwnerProbe />
    </JourneyProvider>,
  );
  resolveOld(existing(structuredClone(fixture) as Answers));
  await waitFor(() =>
    expect(screen.getByTestId("owner").props.children).toBe(
      "Second fictional member",
    ),
  );
});

import { AppState } from "react-native";
import { act } from "@testing-library/react-native";
import { useEffect } from "react";
test("foreground refresh and failure preserve mounted completed member tabs; confirmed incomplete state closes them", async () => {
  const data = existing(structuredClone(fixture) as Answers);
  data.state.assessment!.completedAt = "2026-10-12T01:00:00Z";
  let foreground!: (state: import("react-native").AppStateStatus) => void;
  const priorListener = jest.isMockFunction(AppState.addEventListener)
    ? jest.mocked(AppState.addEventListener).getMockImplementation()
    : undefined;
  const listener = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_, callback) => {
      foreground = callback;
      return { remove: jest.fn() };
    });
  let mounts = 0,
    unmounts = 0,
    reads = 0;
  let rejectRead!: (error: Error) => void;
  function MountedTabs() {
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <Text>Member tabs</Text>;
  }
  const transport: JourneyTransport = {
    read: async () => {
      reads++;
      if (reads === 2)
        return new Promise((_, reject) => {
          rejectRead = reject;
        });
      if (reads > 2)
        return {
          ...data,
          state: {
            ...data.state,
            assessment: {
              ...data.state.assessment!,
              revision: 2,
              completedAt: null,
            },
          },
        };
      return data;
    },
    write: async () => ({ ok: false, reason: "unavailable" }),
  };
  try {
    await render(
      <LocaleProvider>
        <JourneyProvider userId="member" transport={transport}>
          <JourneyGate>
            <MountedTabs />
          </JourneyGate>
        </JourneyProvider>
      </LocaleProvider>,
    );
    await screen.findByText("Member tabs");
    await act(async () => foreground("active"));
    expect(screen.getByText("Member tabs")).toBeTruthy();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    await act(async () => rejectRead(Error("offline")));
    expect(screen.getByText("Member tabs")).toBeTruthy();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    await act(async () => foreground("active"));
    await waitFor(() => expect(screen.queryByText("Member tabs")).toBeNull());
    expect(unmounts).toBe(1);
  } finally {
    listener.mockRestore();
    if (priorListener)
      jest.mocked(AppState.addEventListener).mockImplementation(priorListener);
  }
});

test("profile or consent correction cannot hide an already saved emergency", async () => {
  const answers = structuredClone(fixture) as Answers;
  for (const fieldId of ["q9.present", "q9.right_now"])
    answers[fieldId] = {
      fieldId,
      value: "yes",
      source: "manual",
      answeredAt: "2026-10-12T00:00:00Z",
    };
  const data = existing(answers);
  data.state.consentAccepted = false;
  await mount({
    read: async () => data,
    write: async () => ({ ok: false, reason: "invalid" }),
  });
  await english();
  expect(screen.getByText("Your details")).toBeTruthy();
  expect(screen.getByText("Urgent guidance")).toBeTruthy();
  expect(screen.queryByText("Member tabs")).toBeNull();
});
