-- Existing server-side clinic CRUD uses service_role. PostgreSQL checks a
-- constraint function's EXECUTE privilege even for the null/default branch.
-- This validator reads no data and performs no writes. Keep settings/receipts
-- and all admin write helpers revoked; only the existing trusted server role
-- needs this data-free validation function for its unchanged clinic CRUD.
grant execute on function public._real_scheduling_email(text) to service_role;
