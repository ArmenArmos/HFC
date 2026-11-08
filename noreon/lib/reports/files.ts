import { createHash } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import { MAX_BYTES } from "@/lib/reports/schema";
export async function validateFile(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new Error("invalid_file");
  let pages = 1;
  if (mime === "application/pdf") {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("invalid_file");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pages = pdf.getPageCount();
    if (pdf.isEncrypted || pages < 1 || pages > 10)
      throw new Error("invalid_file");
    // Reject active and embedded content rather than offering a browser preview of it.
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      const text = object.toString();
      if (
        /\/(JavaScript|JS|Launch|EmbeddedFiles|EmbeddedFile|RichMedia|XFA|OpenAction|AA)\b/.test(
          text,
        )
      )
        throw new Error("invalid_file");
    }
    if (pdf.catalog.has(PDFName.of("OpenAction")))
      throw new Error("invalid_file");
  } else if (mime === "image/png" || mime === "image/jpeg") {
    const expected = mime === "image/png" ? "png" : "jpeg";
    const img = sharp(bytes, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const info = await img.metadata();
    if (info.format !== expected || (info.pages ?? 1) !== 1)
      throw new Error("invalid_file");
    await img.stats(); // Force a full decode; metadata alone accepts truncated images.
  } else throw new Error("invalid_file");
  return { pages, checksum: createHash("sha256").update(bytes).digest("hex") };
}
