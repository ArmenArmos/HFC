import 'server-only';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {extractionSchema} from './schema';
import {PROMPT_VERSION} from './provider';

export const EXTRACTION_PROMPT_VERSION = PROMPT_VERSION;
export const EXTRACTION_RECEIPT_TTL_MS = 30 * 60 * 1000;
const receiptSchema = z.object({
  version: z.literal(1),
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const evidenceSchema = z.object({
  caseId: z.string().min(1).max(100),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  pages: z.number().int().min(1).max(10),
  extraction: extractionSchema,
  model: z.string().min(1).max(120),
  prompt_version: z.literal(EXTRACTION_PROMPT_VERSION),
}).strict();
export type ExtractionEvidence = z.infer<typeof evidenceSchema>;
export type ExtractionReceipt = z.infer<typeof receiptSchema>;

// Parsing produces deterministic field ordering, including every nested row.
// A distinct purpose prefix prevents reuse as a bridge request signature.
function signature(secret: string, evidence: ExtractionEvidence, issuedAt: number) {
  if (secret.length < 32) throw new Error('invalid_provenance');
  return createHmac('sha256', secret)
    .update('noreon:extraction-receipt:v1\n')
    .update(JSON.stringify({issuedAt, evidence: evidenceSchema.parse(evidence)}))
    .digest('hex');
}
export function signExtractionReceipt(secret: string, evidence: ExtractionEvidence, now = Date.now()): ExtractionReceipt {
  return {version: 1, issuedAt: now, signature: signature(secret, evidence, now)};
}
export function verifyExtractionReceipt(secret: string, evidence: ExtractionEvidence, receipt: unknown, now = Date.now()): ExtractionReceipt {
  try {
    const parsed = receiptSchema.parse(receipt);
    if (parsed.issuedAt > now + 30_000 || now - parsed.issuedAt > EXTRACTION_RECEIPT_TTL_MS) throw new Error('expired');
    const expected = signature(secret, evidence, parsed.issuedAt);
    if (!timingSafeEqual(Buffer.from(parsed.signature, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('mismatch');
    return parsed;
  } catch {
    throw new Error('invalid_provenance');
  }
}
