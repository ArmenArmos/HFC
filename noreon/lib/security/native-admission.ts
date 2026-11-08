export type NativeAdmission = { allowed: boolean; retry_after: number };
/** A malformed limiter response must never grant access or invent a retry time. */
export function parseNativeAdmission(value: unknown): NativeAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("unavailable");
  const row = value as Record<string, unknown>;
  if (
    typeof row.allowed !== "boolean" ||
    typeof row.retry_after !== "number" ||
    !Number.isSafeInteger(row.retry_after) ||
    (row.allowed
      ? row.retry_after !== 0
      : row.retry_after < 1 || row.retry_after > 86400)
  )
    throw Error("unavailable");
  return { allowed: row.allowed, retry_after: row.retry_after };
}
