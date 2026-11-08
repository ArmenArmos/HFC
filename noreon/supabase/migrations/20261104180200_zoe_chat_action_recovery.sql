-- Card actions have no zoe_runs row. Reuse the pipeline's conversation trace journal,
-- with a service-only entry point restricted to the visit request's fixed codes and ids.
create or replace function public.zoe_chat_action_trace(p_member uuid,p_name text,p_outcome text,p_reason text,p_rule text,p_rule_version text,p_attributes jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare step text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or p_name is distinct from 'zoe.visit_request'or p_outcome is distinct from 'block'or p_rule is distinct from 'zoe.visit_request'
  or coalesce(p_rule_version,'')!~'^[a-z0-9_.:-]{1,80}$'
  or p_attributes is null or jsonb_typeof(p_attributes)<>'object'then return jsonb_build_object('ok',false,'code','invalid');end if;
 step:=p_attributes->>'step';
 if coalesce(step,'')not in('read','claim','task','message','record')or p_reason is distinct from step||'_unavailable'
  or not(p_attributes?&array['noreon.card_id','noreon.operation_id','step'])
  or p_attributes-array['noreon.card_id','noreon.operation_id','step']<>'{}'::jsonb
  or coalesce(p_attributes->>'noreon.card_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or coalesce(p_attributes->>'noreon.operation_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._conversation_trace(p_member,null,'zoe_decision',null,'zoe',p_name,p_outcome,p_reason,p_rule,p_rule_version,'system',null,p_attributes)then
  return jsonb_build_object('ok',false,'code','not_recorded');end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.zoe_chat_action_trace(uuid,text,text,text,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_chat_action_trace(uuid,text,text,text,text,text,jsonb)to service_role;

-- A definitely refused form write has no outcome. Allow releasing only its main form
-- claim on an open card. Other claims, recorded outcomes/receipts and done cards keep
-- the existing immutability rules, including living visit snapshot revisions.
create or replace function public._zoe_chat_card_immutable()returns trigger
language plpgsql set search_path=''as $$
begin
 if new.id<>old.id or new.member_id<>old.member_id or new.request_id<>old.request_id or new.kind<>old.kind or new.source<>old.source
  or new.source_seq is distinct from old.source_seq or new.created_at<>old.created_at
  or not(new.outcome@>old.outcome)
  or(not(new.claims@>old.claims)and not(old.kind in('medicines','profile')and old.state='open'and new.state='open'
    and old.claims?old.kind and not old.outcome?old.kind and new.claims=old.claims-old.kind
    and new.outcome=old.outcome and new.snapshot=old.snapshot and new.send_attempts=old.send_attempts))
  or(old.state='done'and new.state<>'done')
  or(new.snapshot<>old.snapshot and not(old.kind='visit'and jsonb_typeof(new.snapshot->'living')='object'
    and(new.snapshot#>>'{living,revision}')::bigint=coalesce((old.snapshot#>>'{living,revision}')::bigint,0)+1
    and(old.snapshot->'living'is null or old.snapshot#>>'{living,visitId}'=new.snapshot#>>'{living,visitId}')))then
  raise exception 'zoe_chat_cards rows are immutable' using errcode='23514';
 end if;
 return new;
end$$;
