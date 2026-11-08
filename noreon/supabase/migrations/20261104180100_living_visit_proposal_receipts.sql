-- Integrator: replace this placeholder with a fresh timestamp after main's newest migration.
-- Append proposal-specific claims and receipts on a done living visit without reopening it.
-- Keep origin, old outcomes/claims and the immutable done-state trigger unchanged.
-- No changes to zoe_v3_next_step_follow or its old-app contract.
create or replace function public.zoe_chat_card_claim(p_member uuid,p_card uuid,p_item text,p_op uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;live jsonb;attempt uuid;living_accept boolean;
begin
 if p_member is null or p_card is null or p_item is null or p_item!~'^[a-z0-9:_.+-]{1,120}$'or p_op is null or p_payload is null or jsonb_typeof(p_payload)<>'object'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 -- Only the current proposal may add a new claim to a completed living visit.
 -- An existing claim can replay after sync clears the proposal, still behind the action switch.
 living_accept:=coalesce(k.kind='visit'and jsonb_typeof(k.snapshot->'living')='object'
  and k.snapshot->>'available'='true'
  and(p_payload->>'proposalId'=k.snapshot#>>'{proposal,proposalId}'
   or(k.snapshot#>>'{proposal,proposalId}'is null and k.claims?p_item
    and p_payload->>'proposalId'=k.claims#>>array[p_item,'payload','proposalId']))
  and p_item='accepted:'||(p_payload->>'proposalId'),false);
 if p_item like 'accepted:%'and not living_accept then
  return jsonb_build_object('ok',false,'code','conflict','card',public._zoe_chat_card_json(k));end if;
 if p_item not like 'sent:%'then
  if k.claims?p_item then return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',(k.claims#>>array[p_item,'op'])=p_op::text);end if;
  if(k.state='done'and not living_accept)or k.outcome?p_item then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
  begin
   update public.zoe_chat_cards set claims=claims||jsonb_build_object(p_item,jsonb_build_object('op',p_op,'payload',p_payload)),updated_at=clock_timestamp()
    where id=k.id returning * into k;
  exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
  end;
  return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',true);
 end if;

 -- A send. Already sent (or the card is done): the claim comes back with no attempt, and nothing is sent again.
 if k.claims?p_item and(k.state='done'or k.outcome?p_item)then
  return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',(k.claims#>>array[p_item,'op'])=p_op::text,'card',public._zoe_chat_card_json(k));
 end if;
 if not k.claims?p_item and(k.state='done'or k.outcome?p_item)then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
 select coalesce(jsonb_object_agg(a.key,a.value),'{}')into live from jsonb_each(k.send_attempts)a
  where(a.value->>'at')::timestamptz>clock_timestamp()-interval '15 minutes';
 -- Busy while another text is in flight (its lease), or while another claimed text may still be going: it was never
 -- recorded as definitely not sent. A failure marker exempts a text only while no attempt of it holds a lease, and
 -- this check runs for a retry of an earlier claim as well as for a new text.
 if exists(select 1 from jsonb_each(live)a where a.value->>'item'<>p_item)
  or exists(select 1 from jsonb_object_keys(k.claims)c where c like 'sent:%'and c<>p_item and not k.outcome?('fail:'||substr(c,6)))then
  return jsonb_build_object('ok',false,'code','busy','card',public._zoe_chat_card_json(k));
 end if;
 attempt:=gen_random_uuid();
 begin
  update public.zoe_chat_cards set
   claims=case when claims?p_item then claims else claims||jsonb_build_object(p_item,jsonb_build_object('op',p_op,'payload',p_payload))end,
   send_attempts=live||jsonb_build_object(attempt::text,jsonb_build_object('item',p_item,'at',clock_timestamp())),updated_at=clock_timestamp()
   where id=k.id returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',(k.claims#>>array[p_item,'op'])=p_op::text,'attempt',attempt);
end$$;

create or replace function public.zoe_chat_card_record(p_member uuid,p_card uuid,p_item text,p_value jsonb,p_close boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;living_accept boolean;
begin
 if p_member is null or p_card is null or p_item is null or p_item!~'^[a-z0-9:_.+-]{1,120}$'or p_value is null or p_close is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 -- Only the result of a claimed operation is recorded (so only a write that passed the switches and the claim).
 -- A send's definite failure ('fail:<hash>') is recorded against its claimed text ('sent:<hash>').
 if not(k.claims?p_item or(p_item like 'fail:%'and k.claims?('sent:'||substr(p_item,6))))then return jsonb_build_object('ok',false,'code','invalid');end if;
 if k.outcome?p_item then
  if(case when jsonb_typeof(k.outcome->p_item)='object'then(k.outcome->p_item)-'doneAt'else k.outcome->p_item end)=p_value then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
  return jsonb_build_object('ok',false,'code','recorded','card',public._zoe_chat_card_json(k));
 end if;
 -- Complete only the claimed proposal with its original command identity. Reconciliation may
 -- already have cleared it, so bookkeeping follows the claim, not the latest snapshot proposal.
 -- Keep the old 'accepted' claim recoverable during an app rollout too.
 living_accept:=coalesce(k.kind='visit'and jsonb_typeof(k.snapshot->'living')='object'
  and(p_item='accepted:'||(p_value->>'proposalId')or p_item='accepted')
  and p_value->>'proposalId'=k.claims#>>array[p_item,'payload','proposalId']
  and p_value->>'commandId'=k.claims#>>array[p_item,'op'],false);
 if p_item like 'accepted:%'and not living_accept then
  return jsonb_build_object('ok',false,'code','invalid','card',public._zoe_chat_card_json(k));end if;
 if k.state='done'and not living_accept then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
 begin
  update public.zoe_chat_cards set outcome=outcome||jsonb_build_object(p_item,case when jsonb_typeof(p_value)='object'then p_value||jsonb_build_object('doneAt',clock_timestamp())else p_value end),state=case when p_close then 'done'else state end,updated_at=clock_timestamp()
   where id=k.id returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;
