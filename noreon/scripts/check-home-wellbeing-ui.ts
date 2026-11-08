import assert from "node:assert/strict";
import { createElement } from "react";
import { create, act } from "react-test-renderer";
import { BreathingSession } from "@/components/patient-care/home-wellbeing";
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
const originalInterval = globalThis.setInterval,
  originalClear = globalThis.clearInterval;
let tick: (() => void) | null = null,
  starts = 0;
globalThis.setInterval = ((fn: () => void) => {
  tick = fn;
  starts++;
  return 1;
}) as unknown as typeof setInterval;
globalThis.clearInterval = (() => {
  tick = null;
}) as typeof clearInterval;
try {
  for (const locale of ["en", "hy"] as const) {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(BreathingSession, { locale }));
    });
    assert.equal(tick, null, "never start timer automatically");
    const buttons = () => renderer.root.findAllByType("button");
    const text = () => JSON.stringify(renderer.toJSON());
    await act(async () => {
      buttons()[0].props.onClick();
    });
    assert.ok(tick);
    await act(async () => {
      tick!();
    });
    assert.ok(text().includes("0:59"));
    await act(async () => {
      buttons()[0].props.onClick();
    });
    assert.equal(tick, null, "pause clears running interval");
    await act(async () => {
      buttons()[0].props.onClick();
    });
    await act(async () => {
      tick!();
    });
    assert.ok(text().includes("0:58"), "resume preserves elapsed time");
    await act(async () => {
      buttons()[1].props.onClick();
    });
    assert.equal(tick, null);
    assert.ok(text().includes("1:00"));
    await act(async () => {
      buttons()[0].props.onClick();
    });
    for (let i = 0; i < 60; i++)
      await act(async () => {
        tick!();
      });
    assert.equal(tick, null, "completed session stops timer");
    assert.equal(buttons()[0].props.disabled, true);
    assert.ok(
      text().includes(
        locale === "en" ? "Your minute is complete" : "Ձեր րոպեն ավարտվել է",
      ),
    );
    await act(async () => {
      renderer.unmount();
    });
  }
  assert.ok(starts >= 6);
} finally {
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
}
console.log(
  "Breathing UI checks passed: no auto-start, start, pause, resume, reset, completion and cleanup in EN/HY; simulated timer.",
);
