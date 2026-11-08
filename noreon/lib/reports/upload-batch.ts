export type UploadStatus = 'waiting' | 'processing' | 'complete' | 'failed';
/** Each file commits separately; a failure never rolls back earlier uploads. */
export async function processUploadBatch<T>(items: T[], upload: (item: T) => Promise<void>, progress: (index: number, status: UploadStatus) => void) {
  const failures: { index: number; error: string }[] = [];
  for (const [index, item] of items.entries()) {
    progress(index, 'processing');
    try { await upload(item); progress(index, 'complete'); }
    catch (error) { failures.push({ index, error: error instanceof Error ? error.message : 'unavailable' }); progress(index, 'failed'); }
  }
  return failures;
}
