'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { z } from 'zod';
import { requireRealAdmin } from '@/lib/staff/real-admin';

const back = (notice: string): never => redirect(`/staff/real/callbacks?notice=${notice}` as Route);

export const closeMemberCallback=loggedAction("closeMemberCallback",async function closeMemberCallback(form: FormData) {
  const p = z.object({ id: z.uuid(), outcome: z.enum(['reached', 'no_answer', 'not_needed']) }).safeParse({ id: form.get('id'), outcome: form.get('outcome') });
  if (!p.success) back('invalid');
  const { client } = await requireRealAdmin();
  let notice = 'unavailable';
  try {
    const { data, error } = await client.rpc('staff_callback_close', { p_request: p.data!.id, p_outcome: p.data!.outcome });
    if (!error) notice = (data as { ok?: boolean } | null)?.ok ? 'closed' : 'changed';
  } catch { notice = 'unavailable'; }
  revalidatePath('/staff/real/callbacks');
  back(notice);
});
