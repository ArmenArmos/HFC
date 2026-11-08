import { createHmac, timingSafeEqual } from "node:crypto";
export const DEMO_MAX_BYTES = 2 * 1024 * 1024;
export const BRIDGE_MAX_BYTES = 3 * 1024 * 1024;
export function signDemoBody(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}
export function verifyDemoBody(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
) {
  if (
    secret.length < 32 ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 60_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(signDemoBody(secret, timestamp, body), "hex"),
  );
}
export async function boundedBody(request: Request, limit = BRIDGE_MAX_BYTES) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("invalid_file");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function demoAiEnabled() {
  return (
    process.env.NEXT_PUBLIC_PATIENT_DEMO === "true" &&
    process.env.NOREON_DEMO_AI_ENABLED === "true" &&
    (process.env.NOREON_DEMO_AI_BRIDGE_SECRET?.length ?? 0) >= 32
  );
}
