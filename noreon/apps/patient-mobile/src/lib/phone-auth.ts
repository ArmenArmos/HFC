import { normalizePhone } from "../../../../lib/patient/validation.ts";
type OtpClient = {
  signInWithOtp(input: {
    phone: string;
    options: { captchaToken: string; shouldCreateUser: false };
  }): Promise<{ error: unknown }>;
};
/** Native v1 is sign-in only; registration remains behind the web release gate. */
export async function requestExistingMemberCode(
  auth: OtpClient,
  phone: string,
  captchaToken: string,
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized || !captchaToken.trim() || captchaToken.length > 16384)
    return false;
  try {
    return !(
      await auth.signInWithOtp({
        phone: normalized,
        options: { captchaToken, shouldCreateUser: false },
      })
    ).error;
  } catch {
    return false;
  }
}
