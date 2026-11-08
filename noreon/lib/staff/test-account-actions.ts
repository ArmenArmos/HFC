"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {messagingServiceRoleKey} from '@/lib/messaging/auth-sms-hook-runtime';
import {requireTestAccountOperator} from './test-accounts';

export type TestAccountActionState = {ok: boolean; message: string} | null;

const resetInput = z.object({memberId: z.uuid(), requestKey: z.uuid(), confirm: z.literal('reset')});
const beginSchema = z.object({ok: z.literal(true), replay: z.boolean(), resetId: z.uuid(), memberId: z.uuid(),
  placeholder: z.string().regex(/^\+9990\d{8}$/), state: z.enum(['phone_pending', 'done'])});

const claimSchema = z.union([
  z.object({ok: z.literal(true), claimToken: z.uuid(), memberId: z.uuid(), placeholder: z.string().regex(/^\+9990\d{8}$/)}),
  z.object({ok: z.literal(false), code: z.enum(['done', 'busy'])}),
]);

/** Auth admin client whose calls abort after 20 seconds: the database keeps the account a flagged
 * member account for three minutes after each claim, so no Auth change can land later. */
function authAdmin() {
  return createClient<Database>(z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL), messagingServiceRoleKey(process.env), {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    global: {fetch: (input, init) => fetch(input, {...init, signal: AbortSignal.timeout(20_000)})},
  }).auth.admin;
}

function refresh(memberId: string) {
  revalidatePath('/staff/real/test-accounts');
  revalidatePath(`/staff/real/members/${memberId}`);
}

/** Reset a test account so the tester can sign up again with the same phone and Telegram.
 * The database step (admin or qa, flagged account only) unlinks Telegram, ends sessions, keeps
 * every row and records the reset; only then does the Auth admin API move the phone to the
 * placeholder it chose. A second click or a retry finishes the same reset. */
export const resetTestAccount = loggedAction('resetTestAccount', async function resetTestAccount(_previous: TestAccountActionState, form: FormData): Promise<TestAccountActionState> {
  const {client} = await requireTestAccountOperator();
  const input = resetInput.safeParse({memberId: form.get('memberId'), requestKey: form.get('requestKey'), confirm: form.get('confirm')});
  if (!input.success) return {ok: false, message: 'Confirm the reset before continuing.'};
  const begun = await client.rpc('test_account_reset_begin', {p_member: input.data.memberId, p_request_key: input.data.requestKey});
  if (begun.error) {
    return {ok: false, message: begun.error.code === '42501' ? 'Only test accounts can be reset.' : 'The reset did not start. Reload and try again.'};
  }
  const reset = beginSchema.safeParse(begun.data);
  if (!reset.success || reset.data.memberId !== input.data.memberId) return {ok: false, message: 'The reset result is unconfirmed. Reload the list before trying again.'};
  if (reset.data.state === 'done') { refresh(input.data.memberId); return {ok: true, message: 'This account was already reset.'}; }
  // Only the request holding the claim calls Auth; a duplicate click sees the live claim and stops.
  const claimed = await client.rpc('test_account_reset_claim', {p_reset: reset.data.resetId});
  if (claimed.error) return {ok: false, message: claimed.error.code === '42501' ? 'Only test accounts can be reset.' : 'The reset did not continue. Reload and try again.'};
  const claim = claimSchema.safeParse(claimed.data);
  if (!claim.success) return {ok: false, message: 'The reset result is unconfirmed. Reload the list before trying again.'};
  if (!claim.data.ok) {
    refresh(input.data.memberId);
    return claim.data.code === 'done' ? {ok: true, message: 'This account was already reset.'} : {ok: false, message: 'This reset is already running. Reload in a minute to see the result.'};
  }
  if (claim.data.memberId !== input.data.memberId || claim.data.placeholder !== reset.data.placeholder) return {ok: false, message: 'The reset result is unconfirmed. Reload the list before trying again.'};
  let changed = false;
  try {
    const updated = await authAdmin().updateUserById(input.data.memberId, {phone: claim.data.placeholder, phone_confirm: true});
    changed = !updated.error;
  } catch { changed = false; }
  const finished = await client.rpc('test_account_reset_finish', {p_reset: reset.data.resetId, p_ok: changed, p_claim: claim.data.claimToken});
  refresh(input.data.memberId);
  const done = !finished.error && z.object({ok: z.literal(true), state: z.literal('done')}).safeParse(finished.data).success;
  if (!done) return {ok: false, message: 'Telegram is unlinked and sessions ended, but the phone change is not confirmed. Press Reset again to finish it.'};
  return {ok: true, message: 'Account reset. The tester can now sign up again with the same phone and Telegram.'};
});

const flagInput = z.object({memberId: z.uuid(), test: z.enum(['true', 'false']), reason: z.string().trim().min(3).max(300)});

/** Admin only (the database refuses qa): mark or unmark a member account as a test account. */
export const setTestAccount = loggedAction('setTestAccount', async function setTestAccount(_previous: TestAccountActionState, form: FormData): Promise<TestAccountActionState> {
  const {client, identity} = await requireTestAccountOperator();
  if (identity.role !== 'admin') return {ok: false, message: 'Only an administrator marks test accounts.'};
  const input = flagInput.safeParse({memberId: form.get('memberId'), test: form.get('test'), reason: form.get('reason')});
  if (!input.success) return {ok: false, message: 'Give a reason of 3 to 300 characters.'};
  const result = await client.rpc('admin_set_test_account', {p_member: input.data.memberId, p_test: input.data.test === 'true', p_reason: input.data.reason});
  if (result.error) return {ok: false, message: result.error.code === '42501' ? 'Staff and clinic accounts cannot be test accounts.' : result.error.code === '55006' ? 'A reset is still finishing. Press Reset test account to finish it, then remove the mark.' : 'The change was not saved. Reload and try again.'};
  refresh(input.data.memberId);
  return {ok: true, message: input.data.test === 'true' ? 'Marked as a test account.' : 'Test account mark removed.'};
});
