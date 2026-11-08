import assert from "node:assert/strict";
import { test } from "node:test";
import { historyPage, historyFilter } from "../src/lib/history.ts";
const rows = Array.from({ length: 21 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(100 - i).padStart(12, "0")}`,
  measured_at: "2026-10-12T04:00:00.123456+00:00",
}));
test("history retains timestamp precision and uses ID to page tied timestamps", () => {
  const page = historyPage(rows, "measured_at");
  assert.equal(page.rows.length, 20);
  assert.deepEqual(page.next, { id: rows[19].id, at: rows[19].measured_at });
  assert.equal(
    historyFilter("measured_at", page.next!),
    `measured_at.lt.${rows[19].measured_at},and(measured_at.eq.${rows[19].measured_at},id.lt.${rows[19].id})`,
  );
});
test("final and empty pages have no next cursor", () => {
  assert.equal(historyPage(rows.slice(0, 20), "measured_at").next, null);
  assert.deepEqual(historyPage([], "collected_at"), { rows: [], next: null });
});
test("cursor values cannot inject PostgREST filters", () => {
  assert.throws(() =>
    historyFilter("measured_at", {
      id: "bad),or(id.neq.0",
      at: rows[0].measured_at,
    }),
  );
  assert.throws(() =>
    historyFilter("collected_at", {
      id: rows[0].id,
      at: "2026-10-12),id.neq.0",
    }),
  );
});

test("real query builder keeps reviewed filters, bounded pages and tied timestamp cursor", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { readMeasurementHistory, readResultHistory } = await import(
    "../src/lib/history.ts"
  );
  const requests: URL[] = [];
  const client = createClient(
    "https://example.supabase.co",
    "fictional-anon-key",
    {
      auth: { persistSession: false },
      global: {
        fetch: async (input) => {
          const url = new URL(String(input));
          requests.push(url);
          const data = url.pathname.endsWith("patient_measurements")
            ? rows
            : rows.map(({ id, measured_at }) => ({
                id,
                collected_at: measured_at,
                marker: "Fictional",
                value: "1",
                unit: "unit",
              }));
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );
  const signal = new AbortController().signal;
  const measurements = await readMeasurementHistory(client, signal);
  await readMeasurementHistory(client, signal, measurements.next);
  const results = await readResultHistory(client, signal);
  await readResultHistory(client, signal, results.next);
  for (const request of requests) {
    assert.equal(request.searchParams.get("limit"), "21");
    assert.equal(request.searchParams.has("user_id"), false);
  }
  assert.equal(
    requests[1].searchParams.get("or"),
    `(${historyFilter("measured_at", measurements.next!)})`,
  );
  for (const request of requests.slice(2)) {
    assert.equal(request.searchParams.get("reviewed_at"), "not.is.null");
    assert.equal(request.searchParams.get("reviewed_by"), "not.is.null");
    assert.equal(
      request.searchParams.get("order"),
      "collected_at.desc,id.desc",
    );
  }
});

test("aborting history ends a stalled identity or database request", async () => {
  const { abortableHistory } = await import("../src/lib/history.ts");
  const controller = new AbortController();
  const pending = abortableHistory(
    () => new Promise<never>(() => {}),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
  let called = false;
  await assert.rejects(
    abortableHistory(async () => {
      called = true;
      return 1;
    }, controller.signal),
  );
  assert.equal(called, false);
});
