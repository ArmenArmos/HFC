import {z} from 'zod';
/** The slice of a service client this step uses (narrow, so a check can stub it). */
export type ClinicCleanupClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>;
  storage: {from: (bucket: string) => {remove: (paths: string[]) => PromiseLike<{error: unknown}>}};
};
const pendingSchema = z.array(z.strictObject({
  fileId: z.uuid(),
  bucket: z.literal('clinic-originals'),
  objectKey: z.string().min(1).max(1024).refine(key => !key.startsWith('/') && !key.split('/').includes('..')),
}));
export type ClinicCleanupOutcome = {attempted: number; cleaned: number; failed: number; category: 'database' | 'storage' | null};
/**
 * WP-11 item 32: a clinic upload attempt that was retired before its PDF was stored is marked
 * cleanup 'pending'. Remove any original it left in storage, then let clinic_upload_cleanup record
 * the cleanup; the database keeps its guards (retired, no active upload, object gone).
 */
export async function cleanClinicUploads(admin: ClinicCleanupClient): Promise<ClinicCleanupOutcome> {
  const outcome: ClinicCleanupOutcome = {attempted: 0, cleaned: 0, failed: 0, category: null};
  const fail = (category: 'database' | 'storage') => {
    outcome.failed++;
    outcome.category = outcome.category && outcome.category !== category ? 'database' : category;
  };
  const listed = await admin.rpc('clinic_upload_cleanup_pending', {p_limit: 100});
  const pending = listed.error ? null : pendingSchema.safeParse(listed.data);
  if (!pending?.success) { fail('database'); return outcome; }
  for (const file of pending.data) {
    outcome.attempted++;
    const removed = await admin.storage.from(file.bucket).remove([file.objectKey]);
    if (removed.error) { fail('storage'); continue; }
    const recorded = await admin.rpc('clinic_upload_cleanup', {p_file: file.fileId});
    if (recorded.error) fail('database');
    else outcome.cleaned++;
  }
  return outcome;
}
