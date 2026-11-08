-- The native list write and its replay marker commit together. Queue recovery must
-- never reapply an old list over a newer edit or restoration from another card.
create table public.zoe_v3_medicine_saves(
 card_id uuid primary key references public.zoe_chat_cards(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 rows jsonb not null check(jsonb_typeof(rows)='array'),
 stops jsonb not null check(jsonb_typeof(stops)='array'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.zoe_v3_medicine_saves enable row level security;
revoke all on public.zoe_v3_medicine_saves from public,anon,authenticated,service_role;

create function public.zoe_v3_medicines_save(p_card uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();k public.zoe_chat_cards;held jsonb;added_rows jsonb;r jsonb;saved public.zoe_v3_medicine_saves;rows jsonb;stops jsonb;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('status','disabled');end if;
 if not public._telegram_member_eligible(uid)then return jsonb_build_object('status','invalid');end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=uid and kind='medicines'for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 select * into saved from public.zoe_v3_medicine_saves where card_id=k.id and member_id=uid;
 if found then return jsonb_build_object('status','saved','rows',saved.rows,'stops',saved.stops,'savedAt',saved.created_at);end if;
 held:=k.claims#>'{medicines,payload}';
 if k.state<>'open'or held->>'kind'is distinct from 'review'then return jsonb_build_object('status','invalid');end if;
 select coalesce(jsonb_agg((a-'time')||jsonb_build_object('dose',nullif(a->>'dose',''),'times',jsonb_build_array(a->>'time'))),'[]'::jsonb)into added_rows from jsonb_array_elements(held->'added')a;
 r:=public.member_medicines_review(held->'changes',added_rows);
 if r->>'status'is distinct from 'saved'then return r;end if;
 with chosen as(
  select a->>'id' id,null::text request_id,false added,o from jsonb_array_elements(held->'changes')with ordinality x(a,o)
  union all select null,a->>'requestId',true,o+1000 from jsonb_array_elements(held->'added')with ordinality x(a,o)
 ),resolved as(
  select m.*,c.added,c.o from chosen c join public.member_medicines m on m.user_id=uid
   and(m.id::text=c.id or m.request_id::text=c.request_id)
 )select coalesce(jsonb_agg(jsonb_build_object('name',name,'status',status,'stopReason',stop_reason,'added',added)order by o),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'episode','stop:'||id::text||':'||md5(extract(epoch from stopped_at)::text)))filter(where status='course_stopped'and stopped_at is not null),'[]'::jsonb)
  into rows,stops from resolved;
 insert into public.zoe_v3_medicine_saves(card_id,member_id,rows,stops)values(k.id,uid,rows,stops)returning * into saved;
 return jsonb_build_object('status','saved','rows',rows,'stops',stops,'savedAt',saved.created_at);
end$$;
revoke all on function public.zoe_v3_medicines_save(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_medicines_save(uuid)to authenticated;
