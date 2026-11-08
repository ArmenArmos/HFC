-- Zoe chat actions (founders 29 Oct 2026, chat-first): the member's common tasks as cards Zoe posts in the thread.
-- A card is an immutable snapshot of what the member saw when it was posted (Fable report 2.4b: never redraw history
-- from current state). What the member then did on it is recorded once per item and never rewritten. Every write the
-- card offers goes through the feature's own server action and permissions (medicines, BP, booking, the chat send);
-- this table only records the card. Dark by default: conversation_policy.zoe_chat_actions_enabled.
--
-- Safety (Khikar): Zoe's pipeline stays in front of everything and is unchanged here. A card opened from the member's
-- typed text is accepted only for their newest message, and only after Zoe's run on it finished as an ordinary chat
-- or logistics answer (_zoe_chat_message_cleared). Urgent, red-flag, careful-line, forwarded, health and injection
-- outcomes never open a card. A chip tap carries no member text, so it needs no screening.

alter table public.conversation_policy add column zoe_chat_actions_enabled boolean not null default false;
comment on column public.conversation_policy.zoe_chat_actions_enabled is
 'Zoe chat action cards (dose, BP, results, plan, visit, side effect, message) in the member app chat. Off by default; GO_LIVE_GATES.';

create table public.zoe_chat_cards (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 -- The app's idempotency key: a retried "open" returns the same card, never a second one.
 request_id uuid not null,
 -- New kinds (the LDL goal card) are added here and in lib/zoe-chat-actions/registry.ts.
 kind text not null check(kind in('dose','bp','results','plan','visit','side_effect','message')),
 source text not null check(source in('chip','typed')),
 source_seq bigint check(source_seq>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'and octet_length(snapshot::text)<=32000),
 state text not null default 'open'check(state in('open','done')),
 -- Before any write, the item is claimed once with its operation id and payload (zoe_chat_card_claim): a second tab
 -- or a retry gets the same claim back and replays the same submission, so the feature writes once (Astra ZCA-01).
 claims jsonb not null default '{}'check(jsonb_typeof(claims)='object'and octet_length(claims::text)<=16000),
 -- What the member did, keyed by card item (a dose slot, "bp", "sent", "accepted"); each key is written once.
 outcome jsonb not null default '{}'check(jsonb_typeof(outcome)='object'and octet_length(outcome::text)<=8000),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(member_id,request_id),
 check((source='typed')=(source_seq is not null))
);
create index zoe_chat_cards_member on public.zoe_chat_cards(member_id,created_at desc);
comment on table public.zoe_chat_cards is
 'Zoe chat action cards: immutable snapshots of member-visible data (doses, plan, released results, visits) and what the member did. Deleted with the account.';

alter table public.zoe_chat_cards enable row level security;
create policy zoe_chat_cards_own on public.zoe_chat_cards for select to authenticated using(member_id=(select auth.uid()));
revoke all on public.zoe_chat_cards from anon,authenticated;
grant select on public.zoe_chat_cards to authenticated;

-- The snapshot, kind and origin never change; recorded items are never rewritten or removed; a done card stays done.
create function public._zoe_chat_card_immutable()returns trigger
language plpgsql set search_path=''as $$
begin
 if new.id<>old.id or new.member_id<>old.member_id or new.request_id<>old.request_id or new.kind<>old.kind or new.source<>old.source
  or new.source_seq is distinct from old.source_seq or new.snapshot<>old.snapshot or new.created_at<>old.created_at
  or not(new.outcome@>old.outcome)or not(new.claims@>old.claims)or(old.state='done'and new.state<>'done')then
  raise exception 'zoe_chat_cards rows are immutable' using errcode='23514';
 end if;
 return new;
end$$;
create trigger zoe_chat_cards_immutable before update on public.zoe_chat_cards for each row execute function public._zoe_chat_card_immutable();

create function public._zoe_chat_actions_on()returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select p.app_chat_enabled and p.zoe_chat_actions_enabled from public.conversation_policy p where p.singleton),false)
$$;

-- Whether a card may open from this typed message: it is the member's newest message, under an hour old, and Zoe's run
-- on it finished as an ordinary chat reply or a logistics answer. Anything else (urgent route, red flag, same-day floor,
-- careful line, forward to the doctor, health answer, injection, no run yet) is not cleared.
create function public._zoe_chat_message_cleared(m uuid,p_seq bigint)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(
  select 1 from public.conversations c
  join public.conversation_messages cm on cm.conversation_id=c.id and cm.seq=p_seq
  join public.zoe_runs z on z.conversation_id=c.id and z.message_seq=p_seq
  where c.member_id=m and z.state='finished'
   and cm.seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
   and cm.created_at>clock_timestamp()-interval '1 hour'
   and((z.outcome='chatted'and coalesce(z.reason_code,'')!~'injection|urgent|crisis|red_flag|same_day')
    or(z.outcome='answered'and z.reason_code='direct_answer_passed_guards')))
$$;

create function public._zoe_chat_card_json(k public.zoe_chat_cards)returns jsonb
language sql immutable set search_path=''as $$
 select jsonb_build_object('id',k.id,'requestId',k.request_id,'kind',k.kind,'source',k.source,'sourceSeq',k.source_seq,
  'snapshot',k.snapshot,'state',k.state,'outcome',k.outcome,'claims',k.claims,'at',k.created_at)
$$;

-- The member's own cards (the newest 40, oldest first) and, when cleared, the seq a typed card may open from.
create function public.zoe_chat_cards_member()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();newest bigint;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',true,'enabled',false);end if;
 select max(cm.seq)into newest from public.conversations c join public.conversation_messages cm on cm.conversation_id=c.id where c.member_id=m;
 return jsonb_build_object('ok',true,'enabled',true,
  'cards',coalesce((select jsonb_agg(public._zoe_chat_card_json(x)order by x.created_at,x.id)
   from(select * from public.zoe_chat_cards where member_id=m order by created_at desc,id desc limit 40)x),'[]'),
  'clearedSeq',case when newest is not null and public._zoe_chat_message_cleared(m,newest)
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=m and k.source_seq=newest)then newest end);
end$$;

-- Posts a card. The server builds the snapshot from the member's own reads and calls this with the service role, so a
-- member cannot write a snapshot of their own. Idempotent on the request id; at most 40 cards an hour.
create function public.zoe_chat_card_post(p_member uuid,p_request uuid,p_kind text,p_source text,p_source_seq bigint,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if p_member is null or p_request is null or p_kind is null or p_source is null or p_snapshot is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into k from public.zoe_chat_cards where member_id=p_member and request_id=p_request;
 if found then
  if k.kind=p_kind and k.source=p_source and k.source_seq is not distinct from p_source_seq then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
  return jsonb_build_object('ok',false,'code','conflict');
 end if;
 if p_source='typed'and(p_source_seq is null or not public._zoe_chat_message_cleared(p_member,p_source_seq)
   or exists(select 1 from public.zoe_chat_cards x where x.member_id=p_member and x.source_seq=p_source_seq))then
  return jsonb_build_object('ok',false,'code','not_cleared');
 end if;
 if(select count(*)from public.zoe_chat_cards where member_id=p_member and created_at>clock_timestamp()-interval '1 hour')>=40 then
  return jsonb_build_object('ok',false,'code','rate_limited');
 end if;
 begin
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,source_seq,snapshot)
  values(p_member,p_request,p_kind,p_source,case when p_source='typed'then p_source_seq end,p_snapshot)returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;

-- Claims one item of the member's card for one operation before its write. The first claim wins and is returned to
-- every later caller (another tab, a retry after a reload), who then replays that operation id and payload, so the
-- feature's own idempotency writes once. Needs both switches (Astra ZCA-02): switched off, no card writes anything.
create function public.zoe_chat_card_claim(p_member uuid,p_card uuid,p_item text,p_op uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if p_member is null or p_card is null or p_item is null or p_item!~'^[a-z0-9:_.+-]{1,120}$'or p_op is null or p_payload is null or jsonb_typeof(p_payload)<>'object'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if k.claims?p_item then return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',(k.claims#>>array[p_item,'op'])=p_op::text);end if;
 if k.state='done'or k.outcome?p_item then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
 -- One send in flight per card (Astra review-3): a new text ('sent:<hash>') may claim only once every earlier text on
 -- the card was recorded as definitively not sent ('fail:<hash>'). Otherwise the earlier one may still be going.
 if p_item like 'sent:%'and exists(select 1 from jsonb_object_keys(k.claims)c where c like 'sent:%'and not k.outcome?('fail:'||substr(c,6)))then
  return jsonb_build_object('ok',false,'code','busy','card',public._zoe_chat_card_json(k));
 end if;
 begin
  update public.zoe_chat_cards set claims=claims||jsonb_build_object(p_item,jsonb_build_object('op',p_op,'payload',p_payload)),updated_at=clock_timestamp()
   where id=k.id returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'claim',k.claims->p_item,'won',true);
end$$;

-- Records what the member did on one item of their card, once. The same value again is a replay; a different one is
-- 'recorded'. p_close marks the card done (no more actions on it).
create function public.zoe_chat_card_record(p_member uuid,p_card uuid,p_item text,p_value jsonb,p_close boolean)returns jsonb
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
  if k.outcome->p_item=p_value then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
  return jsonb_build_object('ok',false,'code','recorded','card',public._zoe_chat_card_json(k));
 end if;
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed','card',public._zoe_chat_card_json(k));end if;
 begin
  update public.zoe_chat_cards set outcome=outcome||jsonb_build_object(p_item,p_value),state=case when p_close then 'done'else state end,updated_at=clock_timestamp()
   where id=k.id returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;

revoke all on function public._zoe_chat_card_immutable(),public._zoe_chat_actions_on(),public._zoe_chat_message_cleared(uuid,bigint),
 public._zoe_chat_card_json(public.zoe_chat_cards),public.zoe_chat_cards_member(),
 public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb),public.zoe_chat_card_claim(uuid,uuid,text,uuid,jsonb),public.zoe_chat_card_record(uuid,uuid,text,jsonb,boolean)from public,anon,authenticated;
grant execute on function public.zoe_chat_cards_member()to authenticated;
grant execute on function public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb),public.zoe_chat_card_claim(uuid,uuid,text,uuid,jsonb),public.zoe_chat_card_record(uuid,uuid,text,jsonb,boolean)to service_role;
