import assert from "node:assert/strict";
import { callReportModel } from "@/lib/reports/provider";
import { extractionSchema } from "@/lib/reports/schema";
const data = {
  reportDate: null,
  personName: null,
  laboratory: null,
  summary: "",
  warnings: [],
  rows: [],
};
let sent!: {
  store: boolean;
  tools?: unknown;
  text: { format: { strict: boolean } };
};
const transport: typeof fetch = async (_url, init) => {
  sent = JSON.parse(init!.body as string);
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(data) }],
      },
    ],
  });
};
await callReportModel({
  key: "fictional-test-key",
  model: "test",
  instruction: "Extract",
  content: [],
  schema: extractionSchema,
  transport,
});
assert.equal(sent.store, false);
assert.equal(sent.tools, undefined);
assert.equal(sent.text.format.strict, true);
await assert.rejects(() =>
  callReportModel({
    key: "test",
    model: "test",
    instruction: "Extract",
    content: [],
    schema: extractionSchema,
    transport: async () => Response.json({ status: "incomplete", output: [] }),
  }),
);
await assert.rejects(() =>
  callReportModel({
    key: "test",
    model: "test",
    instruction: "Extract",
    content: [],
    schema: extractionSchema,
    transport: async () =>
      Response.json({
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "No" }] },
        ],
      }),
  }),
);
console.log("report provider contract checks passed");
