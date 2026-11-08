-- Doctor Zoe, phase 1B (Khikar 30 Oct; output/zoe-all-roles-plan-2026-10-30/FABLE_PLAN.md sections 3, 5, 6).
--
-- A read-only assistant for doctors and nurses in the staff app. Nothing here touches the member's conversation,
-- zoe_runs or any member path: a staff turn is its own conversation, its own run and its own message row.
--   1. staff_zoe_settings.staff_zoe_enabled, off by default. Off: reads say disabled and no turn starts.
--   2. staff_zoe_conversations: one staff member, one member, chosen by an explicit selection. A conversation never
--      changes member, so a question can never drift to someone else's record.
--   3. staff_zoe_messages, staff_zoe_runs: the staff member's questions, Zoe's checked answers, and for each turn the
--      model, cost, tools called, the result of the code checks and the why record.
--   4. staff_zoe_gate: called before every tool read, as the staff user. It re-checks the session, the assignment and
--      the role's tool list, and writes one access_audit row (surface zoe_staff, object = the tool). The tool then
--      calls the existing audited read with the same JWT, which applies its own guard and writes its own row.
--   5. staff_zoe_reserve, staff_zoe_finish: service only, called by the server, never by a browser. They hold the spend
--      and the verdict, so a staff member cannot skip a cap or write what "Zoe said". Neither reads a member's record.
--
-- Spend: the per-staff daily cap is staff_daily_cap_usd; staff runs also count in _ai_spend, so the tier and service
-- caps and the real-calls gate (_zoe_real_calls_permitted) apply to them as to every other AI path.
-- Retention follows the other Zoe rows: nothing is pruned, an open question for Q17/legal.

-- 1. Switch and cap ---------------------------------------------------------------------------------------------------
create table public.staff_zoe_settings(
 singleton boolean primary key default true check(singleton),
 staff_zoe_enabled boolean not null default false,
 staff_daily_cap_usd numeric(6,2) not null default 3.00 check(staff_daily_cap_usd between 0 and 10),
 model_tier text not null default 'high' check(model_tier in('low','medium','high')),
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.staff_zoe_settings(singleton)values(true);
alter table public.staff_zoe_settings enable row level security;
revoke all on public.staff_zoe_settings from public,anon,authenticated,service_role;
create trigger staff_zoe_settings_config_audit after insert or update or delete on public.staff_zoe_settings
 for each row execute function public._config_audit_row('singleton','updated_at');

-- 2. Conversations, messages, runs. No direct table access for any client role: every read and write is a function below.
create table public.staff_zoe_conversations(
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references auth.users(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 last_at timestamptz not null default clock_timestamp()
);
create index staff_zoe_conversations_staff on public.staff_zoe_conversations(staff_id,last_at desc);
create index staff_zoe_conversations_member on public.staff_zoe_conversations(member_id);

create table public.staff_zoe_runs(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.staff_zoe_conversations(id)on delete cascade,
 staff_id uuid not null references auth.users(id)on delete cascade,
 staff_role text not null check(staff_role in('doctor','nurse')),
 member_id uuid not null references auth.users(id)on delete cascade,
 submission_id uuid not null,
 state text not null default 'started' check(state in('started','answered','held','no_answer','refused')),
 reason text check(reason ~ '^[a-z0-9_.]{1,60}$'),
 spend_day date not null default((clock_timestamp()at time zone 'Asia/Yerevan')::date),
 reserved boolean not null default false,
 estimate_usd numeric(10,6),
 cost_usd numeric(10,6),
 tier text check(tier in('low','medium','high')),
 provider text check(length(provider)<=80),
 model text check(length(model)<=80),
 prompt_version text check(length(prompt_version)<=80),
 usage jsonb,
 latency_ms integer check(latency_ms>=0),
 tools_called jsonb not null default '[]'::jsonb,
 checks jsonb not null default '{}'::jsonb,
 why jsonb,
 sealed_io text,
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 unique(staff_id,submission_id)
);
create index staff_zoe_runs_spend on public.staff_zoe_runs(spend_day,tier)where reserved;
create index staff_zoe_runs_conversation on public.staff_zoe_runs(conversation_id,created_at desc);

create table public.staff_zoe_messages(
 conversation_id uuid not null references public.staff_zoe_conversations(id)on delete cascade,
 seq integer not null check(seq>0),
 role text not null check(role in('staff','zoe')),
 body text not null check(length(body)between 1 and 8000),
 content jsonb not null default '{}'::jsonb,
 run_id uuid not null references public.staff_zoe_runs(id)on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(conversation_id,seq)
);
create index staff_zoe_messages_run on public.staff_zoe_messages(run_id);

alter table public.staff_zoe_conversations enable row level security;
alter table public.staff_zoe_runs enable row level security;
alter table public.staff_zoe_messages enable row level security;
revoke all on public.staff_zoe_conversations,public.staff_zoe_runs,public.staff_zoe_messages from public,anon,authenticated,service_role;

-- 3. Who may ask --------------------------------------------------------------------------------------------------------
create function public._staff_zoe_on()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select staff_zoe_enabled from public.staff_zoe_settings where singleton),false)
$$;

-- The signed-in doctor or nurse: active, not removed, in an active clinic, in a managed session that is still live.
-- Administrators are not served: they do not read clinical summaries.
create function public._staff_zoe_staff()returns public.workspace_staff
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege using message='Active doctor or nurse session required';end if;
 select w.* into s from public.workspace_staff w join public.workspace_clinics k on k.id=w.clinic_id
  where w.user_id=auth.uid()and w.role in('doctor','nurse')and w.active and w.removed_at is null and k.active;
 if not found or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active doctor or nurse session required';end if;
 return s;
end$$;

-- The same rule for a member the staff member is assigned to. A refusal never says whether the member exists.
create function public._staff_zoe_assigned(p_member uuid)returns public.workspace_staff
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();
begin
 if p_member is null or not public.staff_care_access(p_member,s.user_id,true)then raise insufficient_privilege using message='Member access required';end if;
 return s;
end$$;

-- The tools of each role. lib/staff-zoe/tools.ts holds the same lists, so a model never sees a tool its user cannot use;
-- this copy is the enforcement. A nurse reads what the nurse's own pages show: no labs, no LDL record, no member messages.
create function public._staff_zoe_tool_allowed(p_role text,p_tool text)returns boolean language sql immutable set search_path=''as $$
 select case p_role
  when 'doctor' then p_tool in('overview','bp','labs','ldl','plan','adherence','open_items','visits','member_messages','zoe_why')
  when 'nurse' then p_tool in('overview','bp','plan','adherence','open_items','visits')
  else false end
$$;

create function public.staff_zoe_status()returns boolean language sql stable security definer set search_path=''as $$
 select public._staff_zoe_on()
$$;

-- 4. Finding a member. Only the caller's assigned members (the existing search), at most 5 and a flag that there are more,
-- with what tells two namesakes apart. Each candidate shown is recorded.
create function public.staff_zoe_candidates(p_query text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();ids uuid[];rows jsonb;
begin
 if not public._staff_zoe_on()then return jsonb_build_object('enabled',false);end if;
 begin
  select coalesce(array_agg((r->>'id')::uuid),'{}')into ids from jsonb_array_elements(public.patient_clinical_case_search(p_query)->'rows')r;
 exception when invalid_parameter_value then ids:='{}';end;
 ids:=(select coalesce(array_agg(i),'{}')from unnest(ids)i where public.staff_care_access(i,s.user_id,true));
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'birthYear',x.birth_year,'sex',x.biological_sex,'joinedOn',x.joined_on)
   order by x.display_name,x.joined_on,x.id),'[]'::jsonb)into rows
  from(select p.id,p.display_name,extract(year from p.birth_date)::integer birth_year,p.biological_sex,(c.created_at at time zone 'Asia/Yerevan')::date joined_on
   from public.profiles p join public.patient_clinical_cases c on c.user_id=p.id where p.id=any(ids)order by p.display_name,c.created_at,p.id limit 5)x;
 perform public._access_audit_record((r->>'id')::uuid,'zoe_staff','candidate')from jsonb_array_elements(rows)r;
 return jsonb_build_object('enabled',true,'rows',rows,'hasMore',cardinality(ids)>5);
end$$;

-- 5. Conversations -------------------------------------------------------------------------------------------------------
-- The only way a member enters a conversation: the staff member pressed that candidate.
create function public.staff_zoe_open(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_assigned(p_member);c uuid;
begin
 if not public._staff_zoe_on()then return jsonb_build_object('ok',false,'code','off');end if;
 insert into public.staff_zoe_conversations(staff_id,member_id)values(s.user_id,p_member)returning id into c;
 perform public._access_audit_record(p_member,'zoe_staff','open');
 return jsonb_build_object('ok',true,'conversationId',c);
end$$;

-- Own conversations only, and only while the assignment still stands: a removed assignment closes the history too.
create function public.staff_zoe_read(p_conversation uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();c public.staff_zoe_conversations;p public.profiles;
begin
 if not public._staff_zoe_on()then return jsonb_build_object('enabled',false);end if;
 select * into c from public.staff_zoe_conversations where id=p_conversation and staff_id=s.user_id;
 if not found then raise insufficient_privilege using message='Member access required';end if;
 perform public._staff_zoe_assigned(c.member_id);
 select * into p from public.profiles where id=c.member_id;
 perform public._access_audit_record(c.member_id,'zoe_staff','conversation');
 return jsonb_build_object('enabled',true,'id',c.id,
  'member',jsonb_build_object('id',c.member_id,'name',p.display_name,'birthYear',extract(year from p.birth_date)::integer,'sex',p.biological_sex),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',m.seq,'role',m.role,'body',m.body,'content',m.content,'at',m.created_at)order by m.seq)
   from(select * from public.staff_zoe_messages where conversation_id=c.id order by seq desc limit 100)m),'[]'::jsonb));
end$$;

create function public.staff_zoe_recent()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();
begin
 if not public._staff_zoe_on()then return jsonb_build_object('enabled',false);end if;
 return jsonb_build_object('enabled',true,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'memberId',x.member_id,'name',x.display_name,'birthYear',x.birth_year,'at',x.last_at)order by x.last_at desc)
  from(select c.id,c.member_id,c.last_at,p.display_name,extract(year from p.birth_date)::integer birth_year from public.staff_zoe_conversations c join public.profiles p on p.id=c.member_id
   where c.staff_id=s.user_id and public.staff_care_access(c.member_id,s.user_id,true)
    and exists(select 1 from public.staff_zoe_messages m where m.conversation_id=c.id)order by c.last_at desc limit 10)x),'[]'::jsonb));
end$$;

-- 6. A turn ---------------------------------------------------------------------------------------------------------------
-- As the staff user. Stores the question and starts the run. The member always comes from the conversation.
create function public.staff_zoe_begin(p_conversation uuid,p_submission uuid,p_text text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();c public.staff_zoe_conversations;r public.staff_zoe_runs;n integer;t text:=btrim(coalesce(p_text,''));
begin
 if not public._staff_zoe_on()then return jsonb_build_object('ok',false,'code','off');end if;
 if p_conversation is null or p_submission is null or length(t)not between 1 and 1000 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into c from public.staff_zoe_conversations where id=p_conversation and staff_id=s.user_id for update;
 if not found then raise insufficient_privilege using message='Member access required';end if;
 perform public._staff_zoe_assigned(c.member_id);
 select * into r from public.staff_zoe_runs where staff_id=s.user_id and submission_id=p_submission;
 if found then return jsonb_build_object('ok',false,'code','replayed','runId',r.id);end if;
 if exists(select 1 from public.staff_zoe_runs where conversation_id=c.id and state='started'and created_at>clock_timestamp()-interval '2 minutes')then
  return jsonb_build_object('ok',false,'code','busy');end if;
 insert into public.staff_zoe_runs(conversation_id,staff_id,staff_role,member_id,submission_id)values(c.id,s.user_id,s.role,c.member_id,p_submission)returning * into r;
 select coalesce(max(seq),0)+1 into n from public.staff_zoe_messages where conversation_id=c.id;
 insert into public.staff_zoe_messages(conversation_id,seq,role,body,run_id)values(c.id,n,'staff',t,r.id);
 update public.staff_zoe_conversations set last_at=clock_timestamp()where id=c.id;
 return jsonb_build_object('ok',true,'runId',r.id,'memberId',c.member_id,'role',s.role,
  'memberName',(select p.display_name from public.profiles p where p.id=c.member_id),
  'tier',(select a.model_tier from public.staff_zoe_settings a where a.singleton),
  'lastTools',coalesce((select x.tools_called from public.staff_zoe_runs x where x.conversation_id=c.id and x.state='answered'order by x.created_at desc limit 1),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('role',m.role,'body',m.body)order by m.seq)
   from(select * from public.staff_zoe_messages where conversation_id=c.id and seq<n order by seq desc limit 8)m),'[]'::jsonb));
end$$;

-- As the staff user, before every read: this run, this user, still assigned, a tool of this role. One audit row per read.
create function public.staff_zoe_gate(p_run uuid,p_tool text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff:=public._staff_zoe_staff();r public.staff_zoe_runs;
begin
 select * into r from public.staff_zoe_runs where id=p_run and staff_id=s.user_id and state='started';
 if not found or not public._staff_zoe_on()or not public._staff_zoe_tool_allowed(s.role,p_tool)then
  raise insufficient_privilege using message='Member access required';end if;
 perform public._staff_zoe_assigned(r.member_id);
 perform public._access_audit_record(r.member_id,'zoe_staff',p_tool);
 return jsonb_build_object('ok',true,'memberId',r.member_id);
end$$;

-- The staff side of spend. Serialised with every other Zoe spend by the same advisory lock.
create or replace function public._ai_spend(p_day date,p_tier text)returns table(total numeric,tier_total numeric)
language sql stable security definer set search_path=''as $$
 select coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.ai_plan_generations where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.staff_zoe_runs where spend_day=p_day and reserved),0),
        coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.ai_plan_generations where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.staff_zoe_runs where spend_day=p_day and reserved and tier=p_tier),0)
$$;

-- Service only. A stand-in reply (local) costs nothing and needs no permission; a real call needs every lock a member call needs.
create function public.staff_zoe_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_tier text,p_model text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_zoe_runs;z public.zoe_settings;c public.zoe_tier_config;a public.staff_zoe_settings;spent numeric;tier_spent numeric;staff_spent numeric;cap numeric;tier_cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>10 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.staff_zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 select * into a from public.staff_zoe_settings where singleton;
 select * into z from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(z.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 select coalesce(sum(coalesce(s.cost_usd,s.estimate_usd)),0)into staff_spent from public.staff_zoe_runs s where s.staff_id=r.staff_id and s.reserved and s.spend_day=r.spend_day;
 code:=case when not a.staff_zoe_enabled then 'off'
  when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when not p_local and tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when not p_local and spent+p_estimate_usd>cap then 'daily_spend_cap_reached'
  when not p_local and staff_spent+p_estimate_usd>a.staff_daily_cap_usd then 'staff_spend_cap_reached'end;
 if code is not null then return jsonb_build_object('ok',false,'code',code);end if;
 update public.staff_zoe_runs set reserved=true,tier=p_tier,estimate_usd=case when p_local then 0 else p_estimate_usd end,model=p_model where id=r.id;
 return jsonb_build_object('ok',true);
end$$;

-- Service only, once per run. The server's result: only text that passed the code checks reaches content; a held
-- answer stores the fixed line and the cards.
create function public.staff_zoe_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_zoe_runs;n integer;st text:=p_result->>'state';b text:=btrim(coalesce(p_result->>'body',''));
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if st is null or st not in('answered','held','no_answer','refused')or length(b)not between 1 and 8000 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into r from public.staff_zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if r.state<>'started'then return jsonb_build_object('ok',true,'replayed',true);end if;
 update public.staff_zoe_runs set state=st,reason=nullif(p_result->>'reason',''),finished_at=clock_timestamp(),cost_usd=nullif(p_result->>'costUsd','')::numeric,
  provider=nullif(p_result->>'provider',''),model=coalesce(nullif(p_result->>'model',''),model),prompt_version=nullif(p_result->>'promptVersion',''),usage=p_result->'usage',
  latency_ms=nullif(p_result->>'latencyMs','')::integer,tools_called=coalesce(p_result->'tools','[]'::jsonb),checks=coalesce(p_result->'checks','{}'::jsonb),
  why=p_result->'why',sealed_io=nullif(p_result->>'sealedIo','')where id=r.id;
 select coalesce(max(seq),0)+1 into n from public.staff_zoe_messages where conversation_id=r.conversation_id;
 insert into public.staff_zoe_messages(conversation_id,seq,role,body,content,run_id)values(r.conversation_id,n,'zoe',b,coalesce(p_result->'content','{}'::jsonb),r.id);
 update public.staff_zoe_conversations set last_at=clock_timestamp()where id=r.conversation_id;
 return jsonb_build_object('ok',true,'replayed',false);
end$$;

-- 7. Privileges ------------------------------------------------------------------------------------------------------------
revoke all on function public._staff_zoe_on(),public._staff_zoe_staff(),public._staff_zoe_assigned(uuid),public._staff_zoe_tool_allowed(text,text),
 public.staff_zoe_status(),public.staff_zoe_candidates(text),public.staff_zoe_open(uuid),public.staff_zoe_read(uuid),public.staff_zoe_recent(),
 public.staff_zoe_begin(uuid,uuid,text),public.staff_zoe_gate(uuid,text),public.staff_zoe_reserve(uuid,numeric,boolean,text,text),public.staff_zoe_finish(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.staff_zoe_status(),public.staff_zoe_candidates(text),public.staff_zoe_open(uuid),public.staff_zoe_read(uuid),public.staff_zoe_recent(),
 public.staff_zoe_begin(uuid,uuid,text),public.staff_zoe_gate(uuid,text)to authenticated;
grant execute on function public.staff_zoe_reserve(uuid,numeric,boolean,text,text),public.staff_zoe_finish(uuid,jsonb)to service_role;
