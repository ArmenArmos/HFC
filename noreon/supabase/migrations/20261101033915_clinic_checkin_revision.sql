-- Attendance is part of the booking's optimistic concurrency boundary. The existing
-- clinic_schedule_command locks the appointment and compares its rendered revision;
-- advancing it here makes a second stale submission fail instead of adding a check-in.
-- Same-submission replays still return their original receipt before that comparison.
create function public._clinic_checkin_advance_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
 update public.booking_appointments set revision = revision + 1 where id = new.appointment_id returning revision into next_revision;
 -- A no-show stays rebookable. Preserve an already-valid open proposal across
 -- this attendance-only revision; never revive a proposal that was already stale.
 if new.outcome = 'no-show' then
  update public.clinic_booking_proposals set appointment_revision = next_revision
   where appointment_id = new.appointment_id and state = 'open'
    and appointment_revision = next_revision - 1;
 end if;
 return null;
end;
$$;

create trigger clinic_booking_checkins_advance_revision
 after insert on public.clinic_booking_checkins
 for each row when (new.source = 'clinic-user')
 execute function public._clinic_checkin_advance_revision();

revoke all on function public._clinic_checkin_advance_revision() from public, anon, authenticated, service_role;
