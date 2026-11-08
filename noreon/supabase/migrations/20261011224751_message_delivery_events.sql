-- Delivery evidence never rewrites the submission outcome. No phone/body stored.
create table public.patient_message_delivery_events (
 id bigint generated always as identity primary key,
 attempt_id uuid not null references public.patient_message_attempts(id) on delete cascade,
 status text not null check(status in ('accepted','scheduled','queued','sending','sent','delivered','read','undelivered','failed','canceled')),
 error_code text not null default '' check(error_code='' or error_code ~ '^[0-9]{1,10}$'),
 received_at timestamptz not null default clock_timestamp(),
 unique(attempt_id,status,error_code)
);
alter table public.patient_message_delivery_events enable row level security;
revoke all on public.patient_message_delivery_events from public,anon,authenticated,service_role;
revoke all on sequence public.patient_message_delivery_events_id_seq from public,anon,authenticated,service_role;
grant select on public.patient_message_delivery_events to service_role;
create function public.record_patient_message_delivery(p_attempt_id uuid,p_reference text,p_status text,p_error_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.patient_message_attempts;
begin
 if p_reference is null or p_reference !~ '^(SM|MM)[0-9a-fA-F]{32}$' or p_status is null or p_status not in ('accepted','scheduled','queued','sending','sent','delivered','read','undelivered','failed','canceled') or (p_error_code is not null and p_error_code !~ '^[0-9]{1,10}$') then raise exception 'invalid';end if;
 select * into a from public.patient_message_attempts where id=p_attempt_id for update;
 if not found or a.status='failed' or (a.provider_reference is not null and a.provider_reference<>p_reference) then return false;end if;
 -- A signed callback can precede the synchronous response or resolve a timeout.
 if a.status in ('submitting','unknown') then
  update public.patient_message_attempts set status='accepted',provider_reference=p_reference,updated_at=clock_timestamp() where id=a.id;
 end if;
 insert into public.patient_message_delivery_events(attempt_id,status,error_code) values(a.id,p_status,coalesce(p_error_code,'')) on conflict(attempt_id,status,error_code) do nothing;
 return true;
end $$;
revoke all on function public.record_patient_message_delivery(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_patient_message_delivery(uuid,text,text,text) to service_role;
-- Do not promise an immutable result across timezone database updates.
alter function public.message_is_quiet(text,text,timestamptz) stable;
