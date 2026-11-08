-- GP report (NRN-GP-REP-001 v1.0): staging switch row.
-- The migration creates gp_report_capabilities with enabled=false. Production is staging
-- until go-live, so the lead runs this there after the PR merges. Before real members,
-- re-run with false (or reset the database, which restores the default off).
-- Nothing is sent to an external GP when this is on: the doctor can view, approve and download.
update public.gp_report_capabilities set enabled=true where singleton;
select enabled from public.gp_report_capabilities;
