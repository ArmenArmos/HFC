-- Lab CTAs open the same visit card as the member menu. Existing tests cards still replay.
-- The receipt and target stay in one transaction under the existing member lock.
create or replace function public.zoe_v3_next_step_follow(p_member uuid,p_card uuid,p_request uuid,p_target text,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards; parent public.zoe_chat_cards; r jsonb; recorded jsonb; item text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_member is null or p_card is null or p_request is null or not public._telegram_member_eligible(p_member) or not public._zoe_consent_ok(p_member)
  or p_target is null or p_snapshot is null or p_target not in('tests_needed','visit','results','plan','message','review')then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found or k.kind not in('next_step','tests_needed')then return jsonb_build_object('ok',false,'code','invalid');end if;
 item:=k.kind;
 if k.outcome?item then
  select public._zoe_chat_card_json(x) into r from public.zoe_chat_cards x where x.member_id=p_member and x.request_id=(k.outcome#>>array[item,'requestId'])::uuid;
  if r is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  return jsonb_build_object('ok',true,'card',public._zoe_chat_card_json(k),'next',r);
 end if;
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed');end if;
 -- A stage can change while the adapter reads the target snapshot. Recheck the saved
 -- parent under the same lock as sync, before claiming an unfinished tests action.
 if k.kind='tests_needed'then
  select * into parent from public.zoe_chat_cards where member_id=p_member and kind='next_step' order by created_at desc,id desc limit 1;
  if not found or parent.outcome#>>'{next_step,requestId}' is distinct from k.request_id::text then
   return jsonb_build_object('ok',false,'code','stale');
  end if;
 end if;
 if(k.kind='next_step'and k.snapshot->>'target' is distinct from p_target
    and(k.snapshot->>'target' is distinct from 'tests_needed'or p_target<>'visit'))
  or(k.kind='tests_needed'and p_target<>'visit')then return jsonb_build_object('ok',false,'code','invalid');end if;
 r:=public.zoe_chat_card_claim(p_member,p_card,item,p_request,jsonb_build_object('target',p_target));
 if not coalesce((r->>'ok')::boolean,false)then return r;end if;
 recorded:=public.zoe_chat_card_record(p_member,p_card,item,jsonb_build_object('target',p_target,'requestId',p_request),true);
 if not coalesce((recorded->>'ok')::boolean,false)then return recorded;end if;
 r:=public.zoe_chat_card_post(p_member,p_request,p_target,'chip',null,p_snapshot);
 -- Raising rolls back the turn too, so a failed post remains retryable.
 if not coalesce((r->>'ok')::boolean,false)then raise exception using errcode='40001',message='Next step card unavailable';end if;
 return jsonb_build_object('ok',true,'card',recorded->'card','next',r->'card');
end$$;
