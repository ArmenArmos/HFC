-- Stable RPCs that reach a FOR SHARE lock failed with 25006 under PostgREST, which runs a non-volatile
-- function in a read-only transaction. care_alert_routing_read always did (the admin guard locks the staff
-- row), and clinic_member_masked did on staging (also fixed by the hotfix with stamp 20261104172250;
-- repeating the alter is harmless). The four nurse reads take the lock only on the Telegram branch
-- (p_binding is not null), which these web entry points never use; they are made volatile as well so a
-- future guard change cannot turn the nurse queue or visit list into an empty screen.
-- Bodies, guards, grants and output are unchanged. Stamp 20261104172500 from the integrator.
alter function public.care_alert_routing_read() volatile;
alter function public.clinic_member_masked(uuid,uuid[]) volatile;
alter function public.nurse_visit_list() volatile;
alter function public.patient_coordination_access(uuid) volatile;
alter function public.patient_coordination_members(text,timestamp with time zone,uuid,integer) volatile;
alter function public.patient_coordination_queue(uuid,text,timestamp with time zone,uuid,integer) volatile;
