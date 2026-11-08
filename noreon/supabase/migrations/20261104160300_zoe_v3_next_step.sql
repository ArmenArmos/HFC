-- PR 13: app-only continuation cards. Existing kinds are listed in full.
alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check check(kind in(
 'dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account','repeat','red_flags','profile','document','prep','fasting','symptom_gate','consult_questions','sams','next_step','tests_needed','review'));

-- Same member lock as card posting. Only the service adapter supplies a rule-derived snapshot.
-- Compare-and-swap rejects a poll that observed an older continuation. Stage request ids replay forever.
create function public.zoe_v3_next_step_sync(p_member uuid,p_request uuid,p_previous uuid,p_seen timestamptz,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards; prior public.zoe_chat_cards; target public.zoe_chat_cards;
 r jsonb; replayed boolean; targets jsonb:='[]'::jsonb; next_request text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_member is null or p_request is null or p_seen is null or not public._telegram_member_eligible(p_member) or not public._zoe_consent_ok(p_member)
  or p_snapshot->>'stage' is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into prior from public.zoe_chat_cards where member_id=p_member and kind='next_step' order by created_at desc,id desc limit 1;
 if prior.id is distinct from p_previous and (p_previous is not null or prior.created_at>p_seen)then
  return jsonb_build_object('ok',false,'code','stale');end if;
 select * into k from public.zoe_chat_cards where member_id=p_member and request_id=p_request;
 replayed:=found;
 if not replayed then
  r:=public.zoe_chat_card_post(p_member,p_request,'next_step','chip',null,p_snapshot);
  if not coalesce((r->>'ok')::boolean,false)then return r;end if;
  update public.zoe_chat_cards set state='done',outcome=outcome||jsonb_build_object('replaced',jsonb_build_object('doneAt',clock_timestamp())),updated_at=clock_timestamp()
   where member_id=p_member and kind='next_step' and state='open' and id<>(r#>>'{card,id}')::uuid;
  select * into k from public.zoe_chat_cards where id=(r#>>'{card,id}')::uuid;
 end if;
 -- A press only opens a target. Recover the immutable next_step -> tests_needed -> visit
 -- chain (or the direct target) by request identity, even beyond the forty-card history window.
 target:=k;
 for depth in 1..2 loop
  exit when target.kind not in('next_step','tests_needed');
  next_request:=target.outcome#>>array[target.kind,'requestId'];
  if next_request is null then
   if target.outcome?target.kind then return jsonb_build_object('ok',false,'code','unavailable');end if;
   exit;
  end if;
  select * into target from public.zoe_chat_cards where member_id=p_member and request_id=next_request::uuid;
  if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
  targets:=targets||jsonb_build_array(public._zoe_chat_card_json(target));
 end loop;
 return jsonb_build_object('ok',true,'replayed',replayed,'card',public._zoe_chat_card_json(k),'cards',targets);
end$$;

-- Opening the matching card is the member's action. Its turn and Zoe's following card commit together.
-- The adapter rechecks the current journey and builds the target snapshot using the existing own-read.
create function public.zoe_v3_next_step_follow(p_member uuid,p_card uuid,p_request uuid,p_target text,p_snapshot jsonb)returns jsonb
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
  select public._zoe_chat_card_json(x) into r from public.zoe_chat_cards x where x.member_id=p_member and x.request_id=p_request;
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
 if(k.kind='next_step'and k.snapshot->>'target' is distinct from p_target)
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

revoke all on function public.zoe_v3_next_step_sync(uuid,uuid,uuid,timestamptz,jsonb),public.zoe_v3_next_step_follow(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_next_step_sync(uuid,uuid,uuid,timestamptz,jsonb),public.zoe_v3_next_step_follow(uuid,uuid,uuid,text,jsonb)to service_role;
