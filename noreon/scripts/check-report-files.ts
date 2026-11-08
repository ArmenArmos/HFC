import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { validateFile } from "@/lib/reports/files";
await assert.rejects(() =>
  validateFile(Buffer.from("<html>bad</html>"), "application/pdf"),
);
const pdf = await PDFDocument.create();
pdf.addPage();
assert.equal(
  (await validateFile(Buffer.from(await pdf.save()), "application/pdf")).pages,
  1,
);
for (let i = 0; i < 10; i++) pdf.addPage();
await assert.rejects(async () =>
  validateFile(Buffer.from(await pdf.save()), "application/pdf"),
);
const png = await sharp({
  create: { width: 20, height: 20, channels: 3, background: "white" },
})
  .png()
  .toBuffer();
assert.equal((await validateFile(png, "image/png")).pages, 1);
await assert.rejects(() => validateFile(png, "image/jpeg"));
await assert.rejects(() =>
  validateFile(Buffer.alloc(9 * 1024 * 1024), "image/png"),
);
console.log("report file checks passed");
