import 'server-only';
import {headers} from 'next/headers';
import {notFound, redirect} from 'next/navigation';
import {z} from 'zod';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {validatedStaffSession} from './real-session-binding';
import {staffSessionMethodAllowed} from './staff-session-method';
import {staffHostAllowed} from './hosts';
import type {MemberSearchResult} from './member-search-schema';

/** Test accounts (Khikar, 19 Oct 22:51): an admin or a qa tester. The database checks the role,
 * the live session and the flag again on every call; this only routes the page. */
export const testAccountOperatorSchema = z.object({id: z.uuid(), role: z.enum(['admin', 'qa']), name: z.string()});
export type TestAccountOperator = z.infer<typeof testAccountOperatorSchema>;

export async function requireTestAccountOperator() {
  const client = await realStaffClient();
  const session = await validatedStaffSession(client.auth);
  if (!session) redirect('/staff/real/login');
  if (!staffSessionMethodAllowed(session.claims.amr)) redirect('/staff/real/login');
  const result = await client.rpc('test_account_operator_identity');
  if (result.error) throw Error('Test accounts are temporarily unavailable. Try again.');
  if (result.data === null) {
    // Doctors and nurses are signed in but never operate test accounts.
    const staff = await client.rpc('real_clinical_staff_identity');
    if (!staff.error && staff.data) notFound();
    redirect('/staff/real/login');
  }
  const identity = testAccountOperatorSchema.parse(result.data);
  if (!staffHostAllowed((await headers()).get('host') ?? '', 'admin')) notFound();
  return {client, identity};
}

/** For sign-in and the staff pages: a qa tester goes to the test account list. */
export async function qaOperatorHome(client: Awaited<ReturnType<typeof realStaffClient>>) {
  const result = await client.rpc('test_account_operator_identity');
  if (result.error) return null;
  const parsed = testAccountOperatorSchema.safeParse(result.data);
  return parsed.success && parsed.data.role === 'qa' ? '/staff/real/test-accounts' as const : null;
}

export const testAccountRowSchema = z.object({
  id: z.uuid(), name: z.string().nullable(), createdAt: z.string(),
  phoneEnding: z.string().nullable(), placeholder: z.boolean(), telegramLinked: z.boolean(),
  resetAt: z.string().nullable(), resetCount: z.number().int().nonnegative(), resetPending: z.boolean(),
});
export type TestAccountRow = z.infer<typeof testAccountRowSchema>;

export async function readTestAccounts(client: Awaited<ReturnType<typeof realStaffClient>>) {
  const result = await client.rpc('test_accounts_list');
  if (result.error) throw Error('Test accounts are unavailable. Reload to try again.');
  return z.array(testAccountRowSchema).parse(result.data);
}

type FlagRpc = {rpc(name: 'staff_test_account_flags', args: {p_ids: string[]}): PromiseLike<{data: unknown; error: unknown}>};
/** Which of these members are test accounts, for the TEST badge. A failed read shows no badge. */
export async function readTestAccountFlags(client: FlagRpc, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const result = await client.rpc('staff_test_account_flags', {p_ids: ids.slice(0, 500)});
    if (result.error) return new Set();
    const parsed = z.array(z.uuid()).safeParse(result.data);
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

/** Adds the TEST badge flag to a page of member search results. */
export async function withTestAccountFlags(client: FlagRpc, result: MemberSearchResult): Promise<MemberSearchResult> {
  if (!result.ok) return result;
  const flags = await readTestAccountFlags(client, result.page.rows.map(row => row.id));
  return {ok: true, page: {...result.page, rows: result.page.rows.map(row => ({...row, testAccount: flags.has(row.id)}))}};
}
