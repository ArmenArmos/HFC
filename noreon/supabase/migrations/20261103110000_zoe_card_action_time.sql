-- The chat is a dialog (Khikar, 1 Nov): every finished card action goes at the end of the thread, by the time it was done.
-- That time is kept with the action's outcome as doneAt, stamped here with the clock the chat's messages use, so a skewed
-- app server cannot put a save before the message it answers. A replay keeps the first time; no new table.
create or replace function public.zoe_chat_card_record(p_member uuid,p_card uuid,p_item text,p_value jsonb,p_close boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
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
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
 begin
  update public.zoe_chat_cards set outcome=outcome||jsonb_build_object(p_item,case when jsonb_typeof(p_value)='object'then p_value||jsonb_build_object('doneAt',clock_timestamp())else p_value end),state=case when p_close then 'done'else state end,updated_at=clock_timestamp()
   where id=k.id returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;
