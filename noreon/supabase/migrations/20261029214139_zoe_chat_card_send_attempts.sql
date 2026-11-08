-- Zoe chat cards: one send in flight per card, retries included (Astra ZCA-POST-01, 29 Oct 2026).
-- Before: a text recorded as definitely not sent ('fail:<hash>') no longer blocked another text, and a retry of that
-- same text reused its claim without any check. So after "A was rate-limited", a retry of A and an edited B could both
-- reach the chat send at once (two side-effect reports or two messages from one card).
-- Now every send attempt takes a lease on the card under the row lock (send_attempts) before it reaches the chat
-- send, and lets go of only its own lease when it ends. While any attempt holds a lease, no other text may start; the
-- same text may (it replays the same request id, so conversation_receive stores it once). A lease left behind by a
-- crashed server expires after 15 minutes, longer than any server action may run (Vercel's limit is 800 s).

alter table public.zoe_chat_cards add column send_attempts jsonb not null default '{}'
 check(jsonb_typeof(send_attempts)='object'and octet_length(send_attempts::text)<=4000);
comment on column public.zoe_chat_cards.send_attempts is
 'Send attempts in flight on this card: attempt id -> {item, at}. Taken by zoe_chat_card_claim, removed by zoe_chat_card_release; expire after 15 minutes. Bookkeeping, not member data.';

create or replace function public.zoe_chat_card_claim(p_member uuid,p_card uuid,p_item text,p_op uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;live jsonb;attempt uuid;
begin
 if p_member is null or p_card is null or p_item is null or p_item!~'^[a-z0-9:_.+-]{1,120}$'or p_op is null or p_payload is null or jsonb_typeof(p_payload)<>'object'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if p_item not like 'sent:%'then
  if k.claims?p_item then return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',(k.claims#>>array[p_item,'op'])=p_op::text);end if;
  if k.state='done'or k.outcome?p_item then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
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
comment on function public.zoe_chat_card_claim(uuid,uuid,text,uuid,jsonb) is
 'Claims one card item before its write; the first claim wins and is replayed. A send (sent:<hash>) also takes an attempt lease: one text in flight per card, retries included (Astra ZCA-POST-01). Needs both switches.';

-- Ends one send attempt: removes only that attempt's lease, never another's. Bookkeeping for a send that already
-- passed the switches, so it runs after the switch is turned off too (as zoe_chat_card_record does).
create function public.zoe_chat_card_release(p_member uuid,p_card uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if p_member is null or p_card is null or p_attempt is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.zoe_chat_cards set send_attempts=send_attempts-p_attempt::text,updated_at=clock_timestamp()
  where id=p_card and member_id=p_member and send_attempts?p_attempt::text;
 return jsonb_build_object('ok',true);
end$$;

-- Astra post-merge note on #402: recording is bookkeeping for a write that already passed the switches (claim needs
-- both), so it is allowed after the switch is turned off. Switched off, no card claims, posts or sends anything new.
comment on function public.zoe_chat_card_record(uuid,uuid,text,jsonb,boolean) is
 'Records what the member did on one claimed card item, once. Completion bookkeeping, so intentionally allowed after zoe_chat_actions_enabled is turned off; only claims and posts are refused while off.';

revoke all on function public.zoe_chat_card_release(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.zoe_chat_card_release(uuid,uuid,uuid)to service_role;
