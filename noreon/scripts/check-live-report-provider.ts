import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  callReportModel,
  EXTRACTION_INSTRUCTION,
  REPORT_MODEL,
  explanationInstruction,
} from "@/lib/reports/provider";
import { extractionSchema, explanationSchema, type Explanation, type ReportExtraction } from "@/lib/reports/schema";
import { validateFile } from "@/lib/reports/files";
if (process.env.NOREON_VALIDATE_AI === "true") {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("AI validation requires the server credential");
  for (const name of [
    "fictional-en.pdf",
    "fictional-hy.png",
    "fictional-ru.png",
  ]) {
    const bytes = await fs.readFile(`scripts/fixtures/reports/${name}`),
      mime = name.endsWith(".pdf") ? "application/pdf" : "image/png";
    await validateFile(bytes, mime);
    const data = `data:${mime};base64,${bytes.toString("base64")}`;
    const content =
      mime === "application/pdf"
        ? { type: "input_file", filename: name, file_data: data }
        : { type: "input_image", image_url: data, detail: "high" };
    const result: ReportExtraction = await callReportModel({
      key: process.env.OPENAI_API_KEY,
      model: REPORT_MODEL,
      instruction: EXTRACTION_INSTRUCTION,
      content: [content],
      schema: extractionSchema,
    });
    console.log(
      "Fictional fixture transcription:",
      name,
      JSON.stringify(
        result.rows.map((r) => ({
          name: r.name,
          literal: r.literal,
          unit: r.unit,
        })),
      ),
    );
    assert.equal(result.reportDate, "2025-09-12", `${name}: collection date`);
    assert.ok(
      result.rows.some(
        (r) => r.literal.replace(",", ".") === "3.2" && r.unit === "mmol/L",
      ),
      `${name}: literal value and unit`,
    );
    assert.ok(
      result.rows.every((r) => r.page === 1),
      `${name}: source page`,
    );
    console.log(`Live fictional extraction passed: ${name}`);
    if (name === "fictional-en.pdf") {
      const explained: Explanation = await callReportModel({
        key: process.env.OPENAI_API_KEY,
        model: REPORT_MODEL,
        instruction: explanationInstruction("en"),
        content: [{ type: "input_text", text: JSON.stringify(result) }],
        schema: explanationSchema,
      });
      assert.ok(
        explained.items.length > 0 &&
          explained.items.every((i) => i.row < result.rows.length),
      );
      console.log(
        "Live fictional explanation returned valid source-linked items",
      );
    }
  }
} else console.log("Live AI validation not requested; no provider call made.");
