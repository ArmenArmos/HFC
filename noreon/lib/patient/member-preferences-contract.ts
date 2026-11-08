import { z } from "zod";

export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const CONTACT_CHANNELS = ["telegram", "phone"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_TIMES = ["morning", "afternoon", "evening"] as const;
export type ContactTime = (typeof CONTACT_TIMES)[number];
export const CALLBACK_FROM = ["nurse", "care_team"] as const;
export type CallbackFrom = (typeof CALLBACK_FROM)[number];

export const textSize = z.enum(TEXT_SIZES);
export const contactPreferenceInput = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  times: z.array(z.enum(CONTACT_TIMES)).max(3),
}).strict();
export const callbackFrom = z.enum(CALLBACK_FROM);

export type MemberContactStatus = {
  mode: "member";
  contactChannel: ContactChannel;
  contactTimes: ContactTime[];
  callbacksEnabled: boolean;
  openRequest: { id: string; requestedFrom: CallbackFrom; createdAt: string } | null;
};

export type PreferenceResult = { ok: true } | { ok: false; reason: "invalid" | "unauthorized" | "unavailable" };
export type CallbackResult =
  | { ok: true; result: "created" | "already_open" | "cancelled" }
  | { ok: false; reason: "invalid" | "unauthorized" | "unavailable" | "rate_limited" | "not_open" };


export function parseStatus(value: unknown): Omit<MemberContactStatus, "mode"> {
  return z.object({
    contactChannel: z.enum(CONTACT_CHANNELS),
    contactTimes: z.array(z.enum(CONTACT_TIMES)),
    callbacksEnabled: z.boolean(),
    openRequest: z.object({ id: z.string().uuid(), requestedFrom: callbackFrom, createdAt: z.string() }).nullable(),
  }).parse(value);
}
