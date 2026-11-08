-- WP T: member risk tiers (append-only history), the prioritised care-team worklist, and the service read the
-- risk-tier and clinical-anomaly jobs share.
--
-- The tier is computed in code (lib/clinical/rules/risk-tier.ts, RISK_TIER_VERSION, every cut in THRESHOLD) by the job
-- app/api/internal/risk-tiers. The database stores what the job decided and decides nothing: no clinical cut point
-- lives here. member_risk_tier_record is service role only. Staff read the latest tier through staff_member_risk_tier
-- and the worklist, each read recorded in access_audit.
--
-- care_team_worklist orders the caller's members: open emergency or same-day work first, then the tier (very high
-- first), then overdue tasks, then the run of home readings above the member's own target (computed by the job), then
-- the time since the care team last made contact. A nurse sees the members assigned to her, a physician the members
-- they are physician for (_case_physician: family physician or cardiologist), a coordinator the logistics of their
-- clinic (tier, reason codes and task kinds only, never a value), an admin everyone in the same logistics shape
-- (admin is not a clinical role: no counts, no values and only admin-queue task kinds).

-- 1. History ---------------------------------------------------------------------------------------------------------
create table public.member_risk_tiers(
 id bigint generated always as identity primary key,
 member_id uuid not null references auth.users(id)on delete cascade,
 tier text not null check(tier in('very_high','high','moderate','low')),
 score numeric(6,2)not null check(score between 0 and 1000),
 -- Rule ids from lib/clinical/rules/risk-tier.ts, never values.
 reasons jsonb not null check(jsonb_typeof(reasons)='array'and jsonb_array_length(reasons)<=20),
 -- Derived counts the worklist orders by (aboveTargetStreak); numbers only.
 facts jsonb not null default '{}'::jsonb check(jsonb_typeof(facts)='object'and octet_length(facts::text)<=1024),
 version text not null check(version ~ '^[a-z0-9.-]{1,40}$'),
 computed_at timestamptz not null default clock_timestamp()
);
create index member_risk_tiers_member on public.member_risk_tiers(member_id,computed_at desc,id desc);
create trigger member_risk_tiers_append_only before update or delete on public.member_risk_tiers for each row execute function public._member_history_immutable();
alter table public.member_risk_tiers enable row level security;
revoke all on public.member_risk_tiers from public,anon,authenticated,service_role;

create function public._member_risk_tier_current(p_member uuid)returns public.member_risk_tiers
language sql stable security definer set search_path=''as $$
 select * from public.member_risk_tiers where member_id=p_member order by computed_at desc,id desc limit 1
$$;

-- Service role. Appends a row when the decision changed, or when the latest row is a day old; otherwise answers
-- {ok, changed:false}. Reasons are rule ids (lower case, dots, underscores); facts are small numbers.
create function public.member_risk_tier_record(p_member uuid,p_tier text,p_score numeric,p_reasons jsonb,p_version text,p_facts jsonb default '{}'::jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare cur public.member_risk_tiers;r jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or p_tier is null or p_tier not in('very_high','high','moderate','low')or p_score is null or p_score not between 0 and 1000
  or jsonb_typeof(p_reasons)is distinct from 'array'or jsonb_array_length(p_reasons)>20 or p_version is null or p_version!~'^[a-z0-9.-]{1,40}$'
  or jsonb_typeof(coalesce(p_facts,'{}'::jsonb))<>'object'or octet_length(coalesce(p_facts,'{}'::jsonb)::text)>1024
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 for r in select value from jsonb_array_elements(p_reasons)loop
  if jsonb_typeof(r)<>'string'or r#>>'{}'!~'^[a-z0-9_.]{1,60}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 end loop;
 if exists(select 1 from jsonb_each(coalesce(p_facts,'{}'::jsonb))f where jsonb_typeof(f.value)<>'number'or f.key!~'^[A-Za-z]{1,40}$')
  then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not exists(select 1 from auth.users where id=p_member)then return jsonb_build_object('ok',false,'code','member_not_found');end if;
 perform pg_advisory_xact_lock(hashtextextended('member_risk_tier:'||p_member::text,0));
 cur:=public._member_risk_tier_current(p_member);
 if cur.id is not null and cur.tier=p_tier and cur.score=round(p_score,2)and cur.reasons=p_reasons and cur.version=p_version
  and cur.facts=coalesce(p_facts,'{}'::jsonb)and cur.computed_at>clock_timestamp()-interval '1 day'
 then return jsonb_build_object('ok',true,'changed',false);end if;
 insert into public.member_risk_tiers(member_id,tier,score,reasons,facts,version)values(p_member,p_tier,round(p_score,2),p_reasons,coalesce(p_facts,'{}'::jsonb),p_version);
 return jsonb_build_object('ok',true,'changed',true,'previousTier',cur.tier);
exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
end$$;

-- Staff: the latest tier of one member. Care team (staff_care_access), or a coordinator of the member's clinic.
create function public.staff_member_risk_tier(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_queue_actor();t public.member_risk_tiers;
begin
 if not(public.staff_care_access(p_member,(actor->>'id')::uuid,true)or(actor->>'role'in('coordinator','admin')and public._staff_coordination_access(p_member,(actor->>'id')::uuid)))
 then raise insufficient_privilege;end if;
 t:=public._member_risk_tier_current(p_member);
 perform public._access_audit_record(p_member,'risk_tier',null);
 return jsonb_build_object('version','risk-tier-read-v1','tier',case when t.id is null then null else jsonb_build_object('tier',t.tier,'score',t.score,
  'reasons',t.reasons,'version',t.version,'computedAt',t.computed_at)end);
end$$;

-- 2. Service read for the risk-tier and clinical-anomaly jobs ------------------------------------------------------
-- Members in care (an assigned doctor), in pages ordered by id after p_after. Raw facts only; lib/ code decides.
create function public.clinical_review_inputs(p_after uuid,p_limit integer,p_days integer default 30)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare now_ timestamptz:=clock_timestamp();
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_limit is null or p_limit not between 1 and 100 or p_days is null or p_days not between 7 and 120 then raise invalid_parameter_value;end if;
 return(select jsonb_build_object('version','clinical-review-inputs-v1','asOf',now_,
  'next',(select max(x.user_id::text)from(select c.user_id from public.patient_clinical_cases c join auth.users u on u.id=c.user_id
    where c.assigned_doctor_id is not null and(p_after is null or c.user_id>p_after)order by c.user_id limit p_limit)x),
  'members',coalesce(jsonb_agg(public._clinical_review_member(c.user_id,p_days,now_)order by c.user_id),'[]'::jsonb))
  from(select c.user_id from public.patient_clinical_cases c join auth.users u on u.id=c.user_id
   where c.assigned_doctor_id is not null and(p_after is null or c.user_id>p_after)order by c.user_id limit p_limit)c);
end$$;

-- The last time the care team reached the member: a staff message in the member's conversation, a completed nurse
-- visit, or an answered care-queue task.
create function public._member_last_contact(p_member uuid)returns timestamptz
language sql stable security definer set search_path=''as $$
 select max(at)from(
  select max(m.created_at)at from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
   where c.member_id=p_member and exists(select 1 from public.workspace_staff s where s.user_id=m.author_id)
  union all select max(v.completed_at)from public.nurse_visit_completions v where v.member_id=p_member
  union all select max(q.answered_at)from public.care_queue_tasks q where q.member_id=p_member)x
$$;

create function public._clinical_review_member(p_member uuid,p_days integer,p_now timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 with a as(select * from public.patient_assessments where user_id=p_member and completed_at is not null order by completed_at desc limit 1),
  g as(select * from public.ldl_goals where member_id=p_member order by version desc limit 1),
  t as(select * from public.member_bp_targets where member_id=p_member order by version desc limit 1)
 select jsonb_build_object('memberId',p_member,
  'conditions',coalesce((select case when jsonb_typeof(a.answers->'q6.conditions'->'value')='array'then a.answers->'q6.conditions'->'value'end from a),'[]'::jsonb),
  'assessmentRedFlag',(select a.urgent_rule from a),
  'events',coalesce((select jsonb_agg(e.event_type order by e.event_type)from public.ldl_index_events e where e.member_id=p_member and e.removed_at is null),'[]'::jsonb),
  'target',(select public._bp_target_json(t,'staff')-'byYou'from t),
  'readings',coalesce((select jsonb_agg(jsonb_build_object('systolic',r.systolic,'diastolic',r.diastolic,'pulse',r.pulse,'measuredAt',r.measured_at,'entrySource',r.entry_source)
    order by r.measured_at,r.id)from(select * from public.patient_measurements where user_id=p_member and measured_at>p_now-make_interval(days=>p_days)and measured_at<=p_now
     order by measured_at desc limit 400)r),'[]'::jsonb),
  'ldlGoal',(select jsonb_build_object('thresholdMmol',g.threshold_mmol,'setAt',g.set_at,'version',g.version)from g),
  'ldlObservations',public._ldl_observations(p_member,true),
  'openAlerts',(select count(*)from public.care_alerts x where x.member_id=p_member and x.state<>'resolved'),
  'openSameDayTasks',(select count(*)from public.care_queue_tasks x where x.member_id=p_member and x.status in('sent','seen')and x.zone in('orange','red')),
  'medicines',public._ldl_medicine_facts(p_member,7),
  'lastContactAt',public._member_last_contact(p_member))
$$;

-- 3. Worklist --------------------------------------------------------------------------------------------------------
create function public.care_team_worklist(p_limit integer default 50)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor jsonb:=public._care_queue_actor();a uuid:=(actor->>'id')::uuid;r text:=actor->>'role';items jsonb;
begin
 if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value;end if;
 with scope as(
  select c.user_id m from public.patient_clinical_cases c
  where not public._test_member_hidden(c.user_id,a)and(
   (r='admin')
   or(r='nurse'and c.assigned_nurse_id=a and public.staff_care_access(c.user_id,a,true))
   or(r='doctor'and(c.assigned_doctor_id=a or c.assigned_cardiologist_id=a)and public._case_physician(c.user_id,a)is not null)
   or(r='coordinator'and public._staff_coordination_access(c.user_id,a)))),
 facts as(
  select s.m,t.tier,t.score,coalesce(t.reasons,'[]'::jsonb)reasons,
   coalesce((t.facts->>'aboveTargetStreak')::int,0)streak,
   (select count(*)from public.care_alerts x where x.member_id=s.m and x.state<>'resolved')
    +(select count(*)from public.care_queue_tasks x where x.member_id=s.m and x.status in('sent','seen')and x.zone in('orange','red'))urgent,
   (select count(*)from public.care_queue_tasks x where x.member_id=s.m and x.status in('sent','seen')and x.sla_deadline<clock_timestamp())overdue,
   (select coalesce(jsonb_agg(distinct x.reason_code),'[]'::jsonb)from public.care_queue_tasks x where x.member_id=s.m and x.status in('sent','seen')
     and(r not in('coordinator','admin')or x.queue='admin'))kinds,
   public._member_last_contact(s.m)contact
  from scope s left join lateral(select * from public.member_risk_tiers z where z.member_id=s.m order by z.computed_at desc,z.id desc limit 1)t on true),
 ranked as(
  select f.*,(select p.display_name from public.profiles p where p.id=f.m)name,
   row_number()over(order by(f.urgent>0)desc,case f.tier when 'very_high'then 0 when 'high'then 1 when 'moderate'then 2 when 'low'then 3 else 4 end,
    f.overdue desc,f.streak desc,f.contact asc nulls first,f.m)n
  from facts f)
 select coalesce(jsonb_agg(case when r in('coordinator','admin')then jsonb_build_object('memberId',x.m,'name',x.name,'rank',x.n,'tier',x.tier,'reasons',x.reasons,'taskKinds',x.kinds)
   else jsonb_build_object('memberId',x.m,'name',x.name,'rank',x.n,'tier',x.tier,'score',x.score,'reasons',x.reasons,'taskKinds',x.kinds,'urgent',x.urgent,
    'overdue',x.overdue,'aboveTargetStreak',x.streak,'daysSinceContact',case when x.contact is null then null else floor(extract(epoch from clock_timestamp()-x.contact)/86400)::int end)end
   order by x.n),'[]'::jsonb)
 into items from(select * from ranked where n<=p_limit)x;
 perform public._access_audit_record((i->>'memberId')::uuid,'care_team_worklist',null)from jsonb_array_elements(items)i;
 return jsonb_build_object('ok',true,'version','care-team-worklist-v1','role',r,'asOf',clock_timestamp(),'items',items);
end$$;

-- 4. Grants ----------------------------------------------------------------------------------------------------------
revoke all on function public._member_risk_tier_current(uuid),public.member_risk_tier_record(uuid,text,numeric,jsonb,text,jsonb),public.staff_member_risk_tier(uuid),
 public.clinical_review_inputs(uuid,integer,integer),public._clinical_review_member(uuid,integer,timestamptz),public._member_last_contact(uuid),
 public.care_team_worklist(integer)
 from public,anon,authenticated,service_role;
grant execute on function public.member_risk_tier_record(uuid,text,numeric,jsonb,text,jsonb),public.clinical_review_inputs(uuid,integer,integer)to service_role;
grant execute on function public.staff_member_risk_tier(uuid),public.care_team_worklist(integer)to authenticated;
