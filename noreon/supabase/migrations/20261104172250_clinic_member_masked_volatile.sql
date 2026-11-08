-- clinic_member_masked was declared stable, so PostgREST ran it in a read-only transaction and the
-- clinic membership guard's FOR SHARE lock failed (25006). The portal then showed "Not given" instead
-- of the last 4 digits and birth year (staging walk, 5 Nov). Volatile makes PostgREST run it read-write.
-- Body, guard, grants and output are unchanged.
-- Stamp 20261104172250 from the integrator (S1-11 part a hotfix).
alter function public.clinic_member_masked(uuid,uuid[]) volatile;
