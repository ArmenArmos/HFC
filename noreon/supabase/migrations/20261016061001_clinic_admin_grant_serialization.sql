-- Forward-only CP11/SR1 repair. Applied61000 remains immutable.
create or replace function public.clinic_admin_membership_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;a uuid:=auth.uid();r uuid;cid uuid;mid uuid;m public.clinic_portal_memberships;u auth.users;c public.workspace_clinics;cmd public.clinic_admin_commands;result jsonb;want_active boolean;begin
 p:=public._clinic_portal_admin_command(p_command);r:=(p->>'submissionId')::uuid;cid:=(p->>'clinicId')::uuid;mid:=(p->>'membershipId')::uuid;
 perform public._clinic_portal_admin_lock(a,r);
 select * into m from public.clinic_portal_memberships where id=mid for update nowait;
 if m.id is not null and m.clinic_id<>cid then raise insufficient_privilege;end if;
 select * into u from auth.users where id=case when p->>'op'='grant-existing'then(p->>'userId')::uuid else m.user_id end for share nowait;
 select * into c from public.workspace_clinics where id=cid for share nowait;
 perform public._clinic_portal_admin();
 select * into cmd from public.clinic_admin_commands where actor_id=a and submission_id=r;
 if found then
 if cmd.payload<>p or cmd.state='retired'then return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);end if;return cmd.result;
 end if;
 if c.id is null then return jsonb_build_object('status','rejected','submissionId',r,'reason','clinic_unavailable','noWrite',true);end if;
 want_active:=p->>'op'='grant-existing'or(p->>'op'='update'and(p->>'active')::boolean);
 if want_active and not c.active then return jsonb_build_object('status','rejected','submissionId',r,'reason','clinic_unavailable','noWrite',true);end if;
 if want_active and(public._clinic_portal_account_reason(u)is not null or(p->>'op'='grant-existing'and lower(u.email)is distinct from p->>'email'))then return jsonb_build_object('status','rejected','submissionId',r,'reason','account_unavailable','noWrite',true);end if;
 if p->>'op'='grant-existing'then
 -- Request IDs serialize replay, but fresh requests can share a logical target.
 -- Try-lock both unique identities before checking/inserting. A busy target is a
 -- known no-write conflict, never an unbounded unique-index wait or unknown23505.
 -- Current admin/account/clinic checks and existing receipt handling ran above.
 if not pg_try_advisory_xact_lock(hashtextextended('clinic-admin-grant-target:'||u.id::text||':'||cid::text,61001))
 or not pg_try_advisory_xact_lock(hashtextextended('clinic-admin-grant-id:'||mid::text,61001))then
 return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);
 end if;
 -- Another transaction may have committed after the initial identity read.
 select * into m from public.clinic_portal_memberships where id=mid for update nowait;
 if m.id is not null or exists(select 1 from public.clinic_portal_memberships where user_id=u.id and clinic_id=cid)then return jsonb_build_object('status','rejected','submissionId',r,'reason','conflict','noWrite',true);end if;
 insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name)values(mid,u.id,cid,p->>'displayName')returning * into m;
 else
 if m.id is null then raise insufficient_privilege;end if;
 if m.revision<>(p->>'expectedRevision')::bigint then return jsonb_build_object('status','stale');end if;
 update public.clinic_portal_memberships set active=coalesce(want_active,false),display_name=case when p->>'op'='update'then p->>'displayName'else display_name end where id=mid returning * into m;
 end if;
 result:=jsonb_build_object('status','committed','submissionId',r,'membershipId',m.id,'revision',m.revision);
 insert into public.clinic_admin_commands(actor_id,submission_id,session_id,payload,state,result)values(a,r,(auth.jwt()->>'session_id')::uuid,p,'committed',result);
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values(cid,a,'membership-'||(p->>'op'),jsonb_build_object('membershipId',m.id,'userId',m.user_id,'revision',m.revision,'submissionId',r));return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','rejected','submissionId',coalesce(r,'00000000-0000-0000-0000-000000000000'::uuid),'reason','invalid','noWrite',true);
 when insufficient_privilege then return jsonb_build_object('status','access');
end$$;
