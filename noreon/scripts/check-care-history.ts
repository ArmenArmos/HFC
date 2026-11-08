import assert from "node:assert/strict";
import { readAllPages } from "@/lib/patient-care/pagination";
const rows = Array.from({ length: 1207 }, (_, id) => ({ id }));
const ranges: number[][] = [];
const data = await readAllPages(async (from, to) => {
  ranges.push([from, to]);
  return { data: rows.slice(from, to + 1), error: null };
});
assert.equal(data.length, 1207);
assert.deepEqual(ranges, [
  [0, 499],
  [500, 999],
  [1000, 1499],
]);
assert.equal(data.at(-1)?.id, 1206);
await assert.rejects(() =>
  readAllPages(async () => ({ data: null, error: { message: "unavailable" } })),
);
console.log(
  "Care history: all pages included, stable ranges and failed reads rejected.",
);
