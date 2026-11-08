import type { Locale } from "@/lib/clinical/types";

/**
 * The homepage's only form.
 *
 * Two audiences arrive through it and they are told apart by `intent`: an
 * organisation asking for a demonstration, and a member who was given access by
 * one. They are the same four fields and the same follow-up queue, so they are
 * one shape with a discriminator rather than two forms that drift apart.
 *
 * The shape and its validation live here rather than beside the server action
 * because both sides need them. The browser checks so the person is told what is
 * wrong without a round trip; the server checks again because the browser's
 * check is a courtesy and anything can POST to a server action.
 */

export type AccessRequestIntent = "demo" | "access";

export type AccessRequest = {
  intent: AccessRequestIntent;
  firstName: string;
  lastName: string;
  email: string;
  notes: string;
  /** Which language the page was in. Whoever answers needs to know which to
      reply in, and it cannot be recovered from the row later. */
  locale: Locale;
};

/** Which field went wrong, so the form can mark it rather than just complain. */
export type AccessRequestField = "firstName" | "lastName" | "email" | "notes";

export const LIMITS = {
  name: 100,
  email: 320,
  notes: 2000,
} as const;

/**
 * Deliberately permissive.
 *
 * An email address is only really validated by sending to it, and every regex
 * stricter than this one rejects addresses that work: plus tags, apostrophes,
 * new top-level domains, non-Latin local parts. This rules out the typo that is
 * worth catching at the keyboard, which is the missing `@` or the missing dot,
 * and lets the rest through to be confirmed by a reply.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Checks a submission and returns the fields that failed, in form order.
 *
 * Returns the offending fields rather than messages, because the messages are
 * localised and belong to the component that renders them.
 */
export function validateAccessRequest(
  input: Partial<AccessRequest>,
): AccessRequestField[] {
  const problems: AccessRequestField[] = [];
  const first = input.firstName?.trim() ?? "";
  const last = input.lastName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";

  if (first.length < 1 || first.length > LIMITS.name) problems.push("firstName");
  if (last.length < 1 || last.length > LIMITS.name) problems.push("lastName");
  if (!EMAIL.test(email) || email.length > LIMITS.email) problems.push("email");
  if (notes.length > LIMITS.notes) problems.push("notes");

  return problems;
}

/** Trims and clamps, so nothing past the documented limit reaches the sheet. */
export function normaliseAccessRequest(input: AccessRequest): AccessRequest {
  return {
    intent: input.intent,
    firstName: input.firstName.trim().slice(0, LIMITS.name),
    lastName: input.lastName.trim().slice(0, LIMITS.name),
    email: input.email.trim().slice(0, LIMITS.email),
    notes: input.notes.trim().slice(0, LIMITS.notes),
    locale: input.locale,
  };
}
