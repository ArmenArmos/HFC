-- Privacy audit B3-3: a removed earlier-result file is purged durably. The server removes the bytes at once and
-- marks the row; if Storage fails, the cleanup worker retries every removed, unpurged row.
alter table public.member_reported_documents add column storage_purged_at timestamptz;
-- Documents removed before this column existed: the worker re-removes their paths once (removal of a missing object succeeds).
create index member_reported_documents_purge_pending on public.member_reported_documents(deleted_at)
 where deleted_at is not null and storage_purged_at is null;
