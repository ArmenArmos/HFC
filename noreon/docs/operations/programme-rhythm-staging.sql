-- Programme rhythm (week-4 review, month 3, month 6): staging switch row.
-- The migration creates programme_settings with enabled=false and the proposed offsets (28 days,
-- 3 months, 6 months; open 3 days before), marked pending clinical sign-off (Armen C10/C12).
-- Production is staging until go-live, so the lead runs this there after the PR merges.
-- The member notices ride the existing 'care' group in member_notice_settings and stay held at
-- claim until their wording is approved. Before real members, re-run with false (or reset the
-- database, which restores the default off).
update public.programme_settings set enabled=true,updated_at=clock_timestamp() where singleton;
select enabled,week4_review_offset,month3_offset,month6_offset,opens_days_before,clinical_status from public.programme_settings;
