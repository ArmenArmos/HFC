-- A red answer on a SAMS card gets the same durable handling as a red BP answer (PR 8): the alert retry, the pending-message
-- record and the open-emergency read cover the 'sams' kind too, with the original alert and message identities. This replaces the
-- BP flow's functions and indexes in a later migration, because the BP flow migration is already applied and is never edited.
-- A BP card is unchanged: only a SAMS answer with zone red counts.
drop index if exists public.zoe_bp_alert_retry;
create index zoe_bp_alert_retry on public.zoe_chat_cards(created_at,id)
 where kind in('red_flags','sams')and not outcome?'alert'
 and outcome @? '$.* ? (@.answer == true && @.alerted == false)'
 and(kind='red_flags'or outcome @? '$.* ? (@.answer == true && @.zone == "red")');

drop index if exists public.zoe_bp_message_retry;
create index zoe_bp_message_retry on public.zoe_chat_cards(member_id,created_at,id)
 where kind in('red_flags','sams')and not outcome?'delivery'and outcome @? '$.* ? (@.answer == true)'
 and(kind='red_flags'or outcome @? '$.* ? (@.answer == true && @.zone == "red")');

drop index if exists public.zoe_bp_emergencies;
create index zoe_bp_emergencies on public.zoe_chat_cards(member_id,created_at,id)
 where kind in('red_flags','sams')and outcome @? '$.* ? (@.answer == true)'
 and(kind='red_flags'or outcome @? '$.* ? (@.answer == true && @.zone == "red")');

create or replace function public.care_alert_bp_flags_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;a record;r jsonb;n integer:=0;f integer:=0;flag text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for k in select * from public.zoe_chat_cards
  where kind in('red_flags','sams')and not outcome?'alert'and outcome @? '$.* ? (@.answer == true && @.alerted == false)'
   and(kind='red_flags'or outcome @? '$.* ? (@.answer == true && @.zone == "red")')
  order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50))for update skip locked loop
  select key,value into a from jsonb_each(k.outcome)where key like 'a:%'and value->>'answer'='true'and(k.kind='red_flags'or value->>'zone'='red')limit 1;
  flag:=case a.key when 'a:chest_pain'then 'RF-01'when 'a:dyspnea'then 'RF-02'when 'a:faint'then 'RF-02'
   when 'a:neuro'then 'RF-04'when 'a:headache_dizziness'then 'RF-04'end;
  if k.kind='red_flags'and flag is null then f:=f+1;continue;end if;
  begin
   if k.kind='sams'then
    -- Match answerSams exactly. Never create a second alert under a BP/card-derived key.
    r:=public.care_alert_screen(k.member_id,'zoe','sams:'||(k.snapshot->>'episodeId'),'escalate','sams_red','{}','zoe.sams',coalesce(a.value->>'ruleVersion','zones-v1-2026-11-02'));
   else
    r:=public.care_alert_screen(k.member_id,'zoe','bp-flag:'||k.id::text,'escalate','bp_red_flag_answered',array[flag],'zoe.bp_red_flags',coalesce(a.value->>'ruleVersion','zones-v1-2026-11-02'));
   end if;
   if r->>'ok'='true'and r->>'alertId'is not null then
    update public.zoe_chat_cards set outcome=outcome||jsonb_build_object('alert',jsonb_build_object('alerted',true,'alertId',r->>'alertId','doneAt',clock_timestamp())),updated_at=clock_timestamp()where id=k.id;
    n:=n+1;
   else f:=f+1;end if;
  exception when others then f:=f+1;
  end;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f);
end$$;

create or replace function public.zoe_bp_messages_pending(p_member uuid,p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(public._zoe_chat_card_json(k)order by k.created_at,k.id)from(
  select * from public.zoe_chat_cards where member_id=p_member and kind in('red_flags','sams')and not outcome?'delivery'
   and outcome @? '$.* ? (@.answer == true)'
   and(kind='red_flags'or outcome @? '$.* ? (@.answer == true && @.zone == "red")')
  order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50)))k),'[]'::jsonb);
end$$;

create or replace function public.zoe_bp_delivery_record(p_member uuid,p_card uuid,p_request uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member and kind in('red_flags','sams')for update;
 if not found or not exists(select 1 from jsonb_each(k.outcome)a where a.key like 'a:%'and a.value->>'answer'='true'and(k.kind='red_flags'or a.value->>'zone'='red')and a.value->>'requestId'=p_request::text)
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not k.outcome?'delivery'then
  update public.zoe_chat_cards set outcome=outcome||jsonb_build_object('delivery',jsonb_build_object('requestId',p_request,'delivered',true,'doneAt',clock_timestamp())),updated_at=clock_timestamp()where id=k.id;
 end if;
 return jsonb_build_object('ok',true);
end$$;

create or replace function public.zoe_bp_open_emergencies()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();cleared timestamptz;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('cards','[]'::jsonb,'clearedAt',null);end if;
 select greatest(
  coalesce((select max(k.cleared_at)from public.zoe_urgent_clears k where k.member_id=m and k.cleared_at<=clock_timestamp()),'-infinity'::timestamptz),
  coalesce((select max(a.created_at)from public.conversation_audit a join public.conversations c on c.id=a.conversation_id
   where c.member_id=m and a.kind='zoe.member_cleared_urgent'and a.created_at<=clock_timestamp()),'-infinity'::timestamptz))into cleared;
 return jsonb_build_object('clearedAt',case when cleared='-infinity'::timestamptz then null else cleared end,'cards',coalesce((select jsonb_agg(public._zoe_chat_card_json(k)order by k.created_at,k.id)
  from public.zoe_chat_cards k where k.member_id=m and k.kind in('red_flags','sams')and k.outcome @? '$.* ? (@.answer == true)'
   and(k.kind='red_flags'or k.outcome @? '$.* ? (@.answer == true && @.zone == "red")')
   and exists(select 1 from jsonb_each(k.outcome)a where a.key like 'a:%'and a.value->>'answer'='true'and(k.kind='red_flags'or a.value->>'zone'='red')
    and coalesce((a.value->>'doneAt')::timestamptz,k.created_at)>cleared)),'[]'::jsonb));
end$$;
