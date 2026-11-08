import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalePreference, LANGUAGE_PREFERENCE_KEY } from "../src/lib/locale-preference.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("device preference restores EN/HY across fresh app state, ignoring unsupported values", async () => {
  let saved: string | null = null;
  const storage = {
    getItem: async (key: string) => { assert.equal(key, LANGUAGE_PREFERENCE_KEY); return saved; },
    setItem: async (key: string, value: string) => { assert.equal(key, LANGUAGE_PREFERENCE_KEY); saved = value; },
  };
  for (const locale of ["en", "hy"] as const) {
    const first = createLocalePreference(storage);
    await first.hydrate();
    await first.setLocale(locale);
    const reloaded = createLocalePreference(storage);
    await reloaded.hydrate();
    assert.equal(reloaded.getSnapshot().locale, locale);
  }
  for (const value of [null, "fr", "EN", "", "{\"locale\":\"en\"}"]) {
    saved = value;
    const fresh = createLocalePreference(storage);
    await fresh.hydrate();
    assert.equal(fresh.getSnapshot().locale, "hy");
  }
});

test("slow restore never replaces a choice made while it was loading", async () => {
  const read = deferred<string | null>();
  const state = createLocalePreference({ getItem: () => read.promise, setItem: async () => {} });
  const hydration = state.hydrate();
  await state.setLocale("en");
  read.resolve("hy");
  await hydration;
  assert.deepEqual(state.getSnapshot(), { locale: "en", storageError: null });
});

test("rapid choices stay immediate and persist in order with the final choice surviving reload", async () => {
  const firstWrite = deferred<void>();
  let saved = "hy";
  let writing = false;
  const storage = {
    getItem: async () => saved,
    setItem: async (_key: string, value: string) => {
      assert.equal(writing, false, "writes must not race each other");
      writing = true;
      if (value === "en") await firstWrite.promise;
      saved = value;
      writing = false;
    },
  };
  const state = createLocalePreference(storage);
  const en = state.setLocale("en");
  assert.equal(state.getSnapshot().locale, "en");
  const hy = state.setLocale("hy");
  assert.equal(state.getSnapshot().locale, "hy");
  await Promise.resolve();
  assert.equal(saved, "hy");
  firstWrite.resolve();
  await Promise.all([en, hy]);
  const reload = createLocalePreference(storage);
  await reload.hydrate();
  assert.equal(reload.getSnapshot().locale, "hy");
});

test("stale failed write cannot show an error for a newer choice or block its successful save", async () => {
  const firstWrite = deferred<void>();
  let saved = "en";
  const state = createLocalePreference({
    getItem: async () => saved,
    setItem: async (_key, value) => { if (value === "en") await firstWrite.promise; saved = value; },
  });
  const old = state.setLocale("en");
  const latest = state.setLocale("hy");
  firstWrite.reject(Error("device unavailable"));
  await old;
  assert.equal(state.getSnapshot().storageError, null);
  await latest;
  assert.equal(saved, "hy");
  assert.deepEqual(state.getSnapshot(), { locale: "hy", storageError: null });
});

test("read and write failures are contained while selection and retry remain usable", async () => {
  let fail = true;
  let saved: string | null = null;
  const state = createLocalePreference({
    getItem: async () => { throw Error("locked"); },
    setItem: async (_key, value) => { if (fail) throw Error("full"); saved = value; },
  });
  await state.hydrate();
  assert.equal(state.getSnapshot().storageError, "restore");
  await state.setLocale("en");
  assert.deepEqual(state.getSnapshot(), { locale: "en", storageError: "save" });
  fail = false;
  await state.setLocale("en");
  assert.equal(saved, "en");
  assert.deepEqual(state.getSnapshot(), { locale: "en", storageError: null });
});

test("late restore failure cannot reintroduce an error after a successful selection", async () => {
  const read = deferred<string | null>();
  const state = createLocalePreference({ getItem: () => read.promise, setItem: async () => {} });
  const restore = state.hydrate();
  await state.setLocale("en");
  read.reject(Error("locked"));
  await restore;
  assert.deepEqual(state.getSnapshot(), { locale: "en", storageError: null });
});
