-- A recipient can finish onboarding before the mail sender persists its response.
-- Delivery accounting is independent of membership state and never grants access.
create or replace function public.real_staff_record_invitation_submission(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_outcome text,p_provider_reference text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or (p_provider_reference is not null and length(p_provider_reference) not between 1 and 512) then raise invalid_parameter_value using message='Invalid submission outcome';end if;
 select * into i from public.real_staff_invitations where id=p_invitation_id for update;
 if not found then raise insufficient_privilege using message='Invitation unavailable';end if;
 if i.generation is distinct from p_generation or i.operation_id is distinct from p_operation_id then raise serialization_failure using message='Invitation operation changed';end if;
 if i.dispatch_claimed_at is null then raise insufficient_privilege using message='Dispatch claim required';end if;
 if p_outcome='accepted' and i.token_digest is null then raise insufficient_privilege using message='Prepared invitation required';end if;
 if i.send_status<>'pending' then
  if i.send_status<>p_outcome or i.provider_reference is distinct from p_provider_reference then raise serialization_failure using message='Submission outcome already recorded';end if;
  return public._real_staff_invitation_json(i);
 end if;
 update public.real_staff_invitations set send_status=p_outcome,provider_reference=p_provider_reference where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'submission_'||p_outcome);
 return public._real_staff_invitation_json(i);
end $$;
revoke all on function public.real_staff_record_invitation_submission(uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.real_staff_record_invitation_submission(uuid,bigint,uuid,text,text) to service_role;
