import "server-only";
import { z } from "zod";
import { buildPlanMessage, type TwilioConfig } from "./twilio";

const GSM_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM_EXTENDED = new Set(Array.from("\f^{}\\[~]|€"));
/** Conservative multipart capacities also cover US/Canada toll-free SMS. */
export function countSmsSegments(body: string): {
  encoding: "gsm7" | "unicode";
  units: number;
  segments: number;
} {
  if (!body || body.length > 1600 || /[\uD800-\uDFFF]/u.test(body))
    throw Error("invalid message body");
  const characters = Array.from(body);
  const gsm = characters.every((c) => GSM_BASIC.has(c) || GSM_EXTENDED.has(c));
  const widths = characters.map((c) =>
    gsm ? (GSM_EXTENDED.has(c) ? 2 : 1) : c.length,
  );
  const units = widths.reduce((a, b) => a + b, 0);
  if (units <= (gsm ? 160 : 70))
    return { encoding: gsm ? "gsm7" : "unicode", units, segments: 1 };
  const capacity = gsm ? 152 : 66;
  let segments = 1,
    used = 0;
  for (const width of widths) {
    // Escape sequences and surrogate pairs occupy one segment together.
    if (used + width > capacity) {
      segments++;
      used = 0;
    }
    used += width;
  }
  return { encoding: gsm ? "gsm7" : "unicode", units, segments };
}
const money = z.number().int().min(1).max(9_000_000_000_000);
export const spendPolicySchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    enabled: z.literal(true),
    currency: z.string().regex(/^[A-Z]{3}$/),
    daily_limit_micros: money,
    sms_segment_ceiling_micros: money,
    whatsapp_message_ceiling_micros: money,
    max_sms_segments: z.number().int().min(1).max(10),
    allowed_prefixes: z
      .array(z.string().regex(/^\+[1-9][0-9]{0,7}$/))
      .min(1)
      .max(50)
      .refine((v) => new Set(v).size === v.length),
    valid_until: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (p) =>
      Number.isSafeInteger(p.sms_segment_ceiling_micros * p.max_sms_segments) &&
      p.sms_segment_ceiling_micros * p.max_sms_segments <= 9_000_000_000_000,
  );
export type SpendPolicy = z.infer<typeof spendPolicySchema>;
export function parseSpendPolicy(
  value: unknown,
  now = new Date(),
): SpendPolicy {
  const policy = spendPolicySchema.parse(value);
  if (
    !Number.isFinite(now.getTime()) ||
    Date.parse(policy.valid_until) <= now.getTime()
  )
    throw Error("message policy expired");
  return policy;
}
/** No I/O: validate both supported bodies before a durable attempt can begin. */
export function assertMessagePreflight(
  config: TwilioConfig,
  policy: SpendPolicy,
): void {
  for (const locale of ["en", "hy"] as const) {
    const message = buildPlanMessage(config, {
      attemptId: "11111111-1111-4111-8111-111111111111",
      destination: "+37499000000",
      channel: "sms",
      locale,
    });
    if (
      !message.body ||
      countSmsSegments(message.body).segments > policy.max_sms_segments
    )
      throw Error("message segment limit");
  }
}

/** A disable command retains configured monetary history; it cannot rewrite rates. */
export function parseSpendConfiguration(
  value: unknown,
  now = new Date(),
): Omit<SpendPolicy, "revision"> | { enabled: false } {
  const disabled = z
    .object({ enabled: z.literal(false) })
    .strict()
    .safeParse(value);
  if (disabled.success) return disabled.data;
  const object = z.record(z.string(), z.unknown()).parse(value);
  if (Object.hasOwn(object, "revision")) throw Error("invalid");
  const policy = parseSpendPolicy({ ...object, revision: 0 }, now);
  const { revision, ...configuration } = policy;
  if (revision !== 0) throw Error("invalid");
  return configuration;
}
