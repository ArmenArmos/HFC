-- Clinic-safe audit labels and retirement of unused activity RPCs.
-- Stamp 20261104173500 from the integrator (S1-12 follow-ups).
-- Existing membership/capability guards, volatility and grants are preserved.
-- Scope includes former clinic staff; only Noreon actors outside that scope are masked.

create or replace function public._audit_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer,p_clinic uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c_at timestamptz;c_key text;lim int:=greatest(1,least(coalesce(p_limit,100),5000));rows jsonb;n int;
begin
 if p_category is not null and p_category not in('sign_in','record_access','alert_change','outbound_message','permission_change','care_change','admin_change','export')then raise invalid_parameter_value;end if;
 if p_cursor is not null then
  if p_cursor !~ '^[0-9TZ:.+-]{10,40}\|[a-z_]{1,40}:[A-Za-z0-9-]{1,80}$' then raise invalid_parameter_value;end if;
  c_at:=split_part(p_cursor,'|',1)::timestamptz;c_key:=split_part(p_cursor,'|',2);
 end if;
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic))
 select coalesce(jsonb_agg(x order by ord),'[]'),count(*)into rows,n from(
  select row_number()over(order by r.at desc,r.key desc)ord,jsonb_build_object(
   'key',r.key,'at',to_char(r.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'category',r.category,'source',r.source,'action',case when p_clinic is not null and r.category='record_access'
    and r.source<>'clinic'and ws.role in('doctor','nurse','admin')then 'member_record'else coalesce(r.action,'unknown')end,
   'actorId',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then null else r.actor_id end,
   'actorName',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then 'Noreon'else coalesce(ws.display_name,cm.display_name,ap.display_name)end,
   'actorRole',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then 'noreon'else coalesce(ws.role,case when cm.display_name is not null then 'clinic' end,case when ap.id is not null then 'member' end)end,
   'memberId',case when r.member_visible then r.member_id end,'memberName',case when r.member_visible then mp.display_name end,
   'ref',case when not r.member_visible then null
    when p_clinic is not null and r.ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists(select 1 from public.profiles p where p.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='member'and s.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='actor'and s.id=r.ref::uuid) then null
    else r.ref end)x
  from(select f.*,(p_clinic is null or f.member_id is null or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))member_visible
    from public._audit_rows(coalesce(p_from,now()-interval '366 days'),least(coalesce(p_to,'infinity'),coalesce(c_at,'infinity')),p_actor,p_member,p_category)f
    where(p_clinic is null or(f.category<>'admin_change'and(f.category<>'sign_in'or f.member_id is null)
     and(exists(select 1 from scope s where s.kind='actor'and s.id=f.actor_id)or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))))
    and(p_to is null or f.at<p_to)and(c_at is null or(f.at,f.key)<(c_at,c_key))
    order by f.at desc,f.key desc limit lim+1)r
  left join public.workspace_staff ws on ws.user_id=r.actor_id
  left join lateral(select m.display_name from public.clinic_portal_memberships m where m.user_id=r.actor_id order by m.active desc limit 1)cm on ws.user_id is null
  left join public.profiles ap on ap.id=r.actor_id and ws.user_id is null and cm.display_name is null
  left join public.profiles mp on mp.id=r.member_id and r.member_visible)s;
 return jsonb_build_object('ok',true,'rows',(select coalesce(jsonb_agg(v),'[]')from(select v from jsonb_array_elements(rows)with ordinality e(v,i)where i<=lim)q),
  'next',case when n>lim then (rows->(lim-1)->>'at')||'|'||(rows->(lim-1)->>'key')end);
end$$;

-- A known UUID must not let a clinic isolate an actor whose identity is masked.
create or replace function public.clinic_audit_log(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_actor is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='actor'and s.id=p_actor)
  then return jsonb_build_object('status','refused');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-view',jsonb_build_object('membershipId',m.id));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
create or replace function public.clinic_audit_log_export(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_actor is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='actor'and s.id=p_actor)
  then return jsonb_build_object('status','refused');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-export',jsonb_build_object('membershipId',m.id));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,null,5000,p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- Omit Noreon staff outside the clinic actor scope from its people selector.
create or replace function public._audit_people(p_clinic uuid default null)returns jsonb
language sql stable security definer set search_path=''as $$
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic)),
 eligible as materialized(
  select id from scope where kind='actor'
  union select r.actor_id from public._audit_rows(now()-interval '366 days','infinity',null,null,null)r
   where p_clinic is not null and r.actor_id is not null and r.category not in('sign_in','admin_change')
    and exists(select 1 from scope s where s.kind='member'and s.id=r.member_id)
 ),people as(
  select s.user_id id,s.display_name name,s.role||case when s.removed_at is not null or not s.active then ', removed'else ''end role
   from public.workspace_staff s where p_clinic is null or exists(select 1 from scope c where c.kind='actor'and c.id=s.user_id)
  union all
  select m.user_id,min(m.display_name),'clinic'from public.clinic_portal_memberships m
   where not exists(select 1 from public.workspace_staff s where s.user_id=m.user_id)
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))group by m.user_id
 )select jsonb_build_object('ok',true,'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)order by name,id)from people),'[]'::jsonb))
$$;

-- Main has used admin_audit_* since #682; no application callers remain.
-- Drop entry points before their helpers, without cascading to other objects.
drop function public.admin_activity_log(uuid,uuid,text,timestamptz,timestamptz,text,integer);
drop function public.admin_activity_log_export(uuid,uuid,text,timestamptz,timestamptz);
drop function public.admin_activity_people();
drop function public._activity_page(uuid,uuid,text,timestamptz,timestamptz,text,integer);
drop function public._activity_rows(timestamptz,timestamptz,uuid,uuid,text);
