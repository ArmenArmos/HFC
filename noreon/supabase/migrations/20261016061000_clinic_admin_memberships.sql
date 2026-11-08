-- Narrow Noreon-admin management; no source-read bypass and no new-email invitation delivery.
create table public.clinic_admin_commands(
 actor_id uuid not null references auth.users(id),submission_id uuid not null,session_id uuid not null,payload jsonb not null,
 state text not null check(state in('committed','retired')),result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,submission_id)
);
alter table public.clinic_admin_commands enable row level security;
revoke all on public.clinic_admin_commands from public,anon,authenticated,service_role;
create function public._clinic_portal_admin()returns uuid language plpgsql security definer set search_path=''as $$declare a uuid:=auth.uid();sid uuid;expires timestamptz;begin
 if auth.role()is distinct from 'authenticated'or a is null or not public._real_staff_amr_allowed(auth.jwt()->'amr')then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;expires:=to_timestamp((auth.jwt()->>'exp')::double precision);
 if sid is null or expires is null or expires<=clock_timestamp()then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=a and(banned_until is null or banned_until<=clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=sid and user_id=a and(not_after is null or not_after>clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from public.workspace_staff where user_id=a and role='admin'and active and removed_at is null for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from public.real_staff_invitations where auth_user_id=a for share nowait;
 if public._real_staff_require_admin()is distinct from a or expires<=clock_timestamp()then raise insufficient_privilege;end if;
 return a;
exception when invalid_text_representation or numeric_value_out_of_range then raise insufficient_privilege;
end$$;
create function public._clinic_portal_account_reason(u auth.users)returns text language sql stable set search_path=''as $$select case when u.id is null then'not_found'when u.banned_until>clock_timestamp()then'disabled'when u.email_confirmed_at is null or u.email is null then'email_unconfirmed'when nullif(u.encrypted_password,'')is null then'password_setup_required'else null end$$;
create function public._clinic_portal_membership_json(m public.clinic_portal_memberships)returns jsonb language sql stable security definer set search_path=''as $$select jsonb_build_object('id',m.id,'userId',m.user_id,'displayName',m.display_name,'email',lower(u.email),'active',m.active,'revision',m.revision)from auth.users u where u.id=m.user_id$$;
create function public.clinic_admin_account_lookup(p_email text)returns jsonb language plpgsql security definer set search_path=''as $$declare u auth.users;reason text;begin
 perform public._clinic_portal_admin();
 if p_email is null or length(btrim(p_email))not between 3 and 320 or btrim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise invalid_parameter_value;end if;
 select * into u from auth.users where lower(email)=lower(btrim(p_email))for share nowait;
 reason:=public._clinic_portal_account_reason(u);
 return case when reason is null then jsonb_build_object('status','eligible','account',jsonb_build_object('userId',u.id,'email',lower(u.email)))else jsonb_build_object('status','unavailable','reason',reason)end;
end$$;
create function public.clinic_admin_memberships_page(p_clinic_id uuid,p_cursor text default null,p_limit integer default 50)returns jsonb language plpgsql security definer set search_path=''as $$declare c public.workspace_clinics;rows jsonb;nextid uuid;afterid uuid:=p_cursor::uuid;begin
 select * into c from public.workspace_clinics where id=p_clinic_id for share nowait;if not found then raise insufficient_privilege;end if;
 perform public._clinic_portal_admin();if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(public._clinic_portal_membership_json(m)order by m.id),'[]')into rows from(select * from public.clinic_portal_memberships where clinic_id=p_clinic_id and(afterid is null or id>afterid)order by id limit p_limit)m;
 if jsonb_array_length(rows)=p_limit then select id into nextid from public.clinic_portal_memberships where clinic_id=p_clinic_id and id>(rows->(p_limit-1)->>'id')::uuid limit 1;end if;
 return jsonb_build_object('version','clinic-admin-memberships-v1','clinic',jsonb_build_object('id',c.id,'name',c.name,'active',c.active),'memberships',rows,'invitations','[]'::jsonb,'invitationsHasMore',false,'nextCursor',case when nextid is not null then rows->(p_limit-1)->>'id'end,'capabilities',jsonb_build_object('grantExisting',true,'inviteNew',false));
end$$;
create function public._clinic_portal_admin_command(p jsonb)returns jsonb language plpgsql immutable set search_path=''as $$declare keys text[];k text;begin
 if jsonb_typeof(p)is distinct from 'object'or p->>'version'is distinct from 'clinic-admin-command-v1'then raise invalid_parameter_value;end if;
 if p->>'op'='grant-existing'then keys:=array['version','op','submissionId','clinicId','membershipId','userId','email','displayName'];
 elsif p->>'op'='update'then keys:=array['version','op','submissionId','clinicId','membershipId','expectedRevision','displayName','active'];
 elsif p->>'op'='revoke'then keys:=array['version','op','submissionId','clinicId','membershipId','expectedRevision'];else raise invalid_parameter_value;end if;
 if p-keys<>'{}'::jsonb or not p?&keys then raise invalid_parameter_value;end if;
 foreach k in array array['submissionId','clinicId','membershipId']loop if p->>k is null then raise invalid_parameter_value;end if;p:=jsonb_set(p,array[k],to_jsonb((p->>k)::uuid::text));end loop;
 if p->>'op'='grant-existing'then
 if p->>'userId'is null or jsonb_typeof(p->'email')is distinct from 'string'or length(btrim(p->>'email'))not between 3 and 320 or btrim(p->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise invalid_parameter_value;end if;
 p:=jsonb_set(jsonb_set(p,'{userId}',to_jsonb((p->>'userId')::uuid::text)),'{email}',to_jsonb(lower(btrim(p->>'email'))));
 else
 if jsonb_typeof(p->'expectedRevision')is distinct from 'number'or p->>'expectedRevision'!~'^[0-9]+$'or(p->>'expectedRevision')::bigint>9007199254740991 then raise invalid_parameter_value;end if;
 end if;
 if p->>'op'in('grant-existing','update')then
 if jsonb_typeof(p->'displayName')is distinct from 'string'or length(btrim(p->>'displayName'))not between 1 and 180 then raise invalid_parameter_value;end if;p:=jsonb_set(p,'{displayName}',to_jsonb(btrim(p->>'displayName')));
 end if;
 if p->>'op'='update'and jsonb_typeof(p->'active')is distinct from 'boolean'then raise invalid_parameter_value;end if;
 return p;
end$$;
-- Management receipts have a separate operation namespace; no service execution port.
create function public._clinic_portal_admin_lock(a uuid,r uuid)returns void language plpgsql set search_path=''as $$begin
 if a is null or r is null then raise insufficient_privilege;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('clinic-admin:'||a::text||':'||r::text,61000))then raise lock_not_available;end if;
end$$;
create function public.clinic_admin_membership_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;a uuid:=auth.uid();r uuid;cid uuid;mid uuid;m public.clinic_portal_memberships;u auth.users;c public.workspace_clinics;cmd public.clinic_admin_commands;result jsonb;want_active boolean;begin
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
create function public.clinic_admin_membership_refresh(p_command jsonb)returns jsonb language plpgsql security definer set search_path=''as $$declare p jsonb;a uuid:=auth.uid();r uuid;m public.clinic_portal_memberships;cmd public.clinic_admin_commands;begin
 p:=public._clinic_portal_admin_command(p_command);r:=(p->>'submissionId')::uuid;perform public._clinic_portal_admin_lock(a,r);
 select * into m from public.clinic_portal_memberships where id=(p->>'membershipId')::uuid for share nowait;
 if m.id is not null and m.clinic_id<>(p->>'clinicId')::uuid then raise insufficient_privilege;end if;
 perform public._clinic_portal_admin();
 select * into cmd from public.clinic_admin_commands where actor_id=a and submission_id=r;
 if found then if cmd.payload<>p then raise invalid_parameter_value using message='request_conflict';end if;
 else
 insert into public.clinic_admin_commands(actor_id,submission_id,session_id,payload,state,result)values(a,r,(auth.jwt()->>'session_id')::uuid,p,'retired','{}');cmd.state:='retired';
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values((p->>'clinicId')::uuid,a,'membership-command-retired',jsonb_build_object('submissionId',r));
 end if;
 return jsonb_build_object('status','loaded','receipt',case when cmd.state='committed'then cmd.result else jsonb_build_object('status','retired','submissionId',r,'serialized',true)end,'membership',case when m.id is null then null else public._clinic_portal_membership_json(m)end);
end$$;
revoke all on function public._clinic_portal_admin(),public._clinic_portal_account_reason(auth.users),public._clinic_portal_membership_json(public.clinic_portal_memberships),public._clinic_portal_admin_command(jsonb),public._clinic_portal_admin_lock(uuid,uuid),public.clinic_admin_account_lookup(text),public.clinic_admin_memberships_page(uuid,text,integer),public.clinic_admin_membership_command(jsonb),public.clinic_admin_membership_refresh(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.clinic_admin_account_lookup(text),public.clinic_admin_memberships_page(uuid,text,integer),public.clinic_admin_membership_command(jsonb),public.clinic_admin_membership_refresh(jsonb)to authenticated;
