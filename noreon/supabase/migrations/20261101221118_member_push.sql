-- Browser permission plus this member-owned subscription is the push opt-in. Telegram
-- unlinking is a separate channel preference. No existing notice producer is changed.
create table public.member_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth text not null,
 generation bigint not null default 1 check(generation > 0),
 created_at timestamptz not null default clock_timestamp(),
 last_ok_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create index member_push_subscriptions_member on public.member_push_subscriptions(member_id);
alter table public.member_push_subscriptions enable row level security;
create policy member_push_subscriptions_own on public.member_push_subscriptions
 for select to authenticated using ((select auth.uid())=member_id);
revoke all on public.member_push_subscriptions from public,anon,authenticated,service_role;
grant select on public.member_push_subscriptions to authenticated;

create table public.member_push_deliveries (
 id uuid primary key default gen_random_uuid(),
 notice_id uuid not null references public.member_notices(id) on delete cascade,
 subscription_id uuid not null references public.member_push_subscriptions(id) on delete cascade,
 member_id uuid not null references auth.users(id) on delete cascade,
 subscription_generation bigint not null,
 state text not null default 'queued' check(state in('queued','sending','sent','failed','unknown','gone')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 attempt_id uuid,
 next_attempt_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(notice_id,subscription_id)
);
create index member_push_deliveries_pending on public.member_push_deliveries(next_attempt_at,id) where state='queued';
alter table public.member_push_deliveries enable row level security;
-- Deliberately no member policy: delivery state and provider outcomes are service-only RPC data.
revoke all on public.member_push_deliveries from public,anon,authenticated,service_role;

insert into public.system_message_templates(template_id,version,locale,body) values
 ('member_notice.push',1,'en','UNAPPROVED PLACEHOLDER. You have an update in Noreon.'),
 ('member_notice.push',1,'hy','UNAPPROVED PLACEHOLDER. Noreon-ում ձեզ համար նոր տեղեկություն կա։');

create function public._member_push_member() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if auth.role() is distinct from 'authenticated' or uid is null
  or not exists(select 1 from public.profiles where id=uid)
  or exists(select 1 from public.workspace_staff where user_id=uid)
  or exists(select 1 from public.clinic_portal_memberships where user_id=uid)
 then raise insufficient_privilege using message='Member account required';end if;
 return uid;
end$$;

create function public.member_push_subscribe(p_endpoint text,p_p256dh text,p_auth text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public._member_push_member();sid uuid;
begin
 -- The sender also calls only the real push services (lib/member-push/server.ts).
 -- Canonical unpadded base64url encodings: 65-byte uncompressed P-256 point, 16-byte secret.
 if p_endpoint is null or length(p_endpoint) not between 12 and 2048
  or p_endpoint !~ '^https://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:443)?/[^[:space:]#]*$'
  or p_p256dh is null or p_p256dh !~ '^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$'
  or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{21}[AQgw]$'
 then raise invalid_parameter_value using message='Invalid push subscription';end if;
 insert into public.member_push_subscriptions as s(member_id,endpoint,p256dh,auth)
 values(uid,p_endpoint,p_p256dh,p_auth)
 on conflict(endpoint) do update set member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth,
  generation=case when (s.member_id,s.p256dh,s.auth) is distinct from (excluded.member_id,excluded.p256dh,excluded.auth) then s.generation+1 else s.generation end,
  -- A shared phone's new owner is alerted only for what comes after they signed in.
  created_at=case when s.member_id is distinct from excluded.member_id then clock_timestamp() else s.created_at end,
  last_ok_at=case when (s.member_id,s.p256dh,s.auth) is distinct from (excluded.member_id,excluded.p256dh,excluded.auth) then null else s.last_ok_at end,
  updated_at=clock_timestamp()
 returning id into sid;
 return jsonb_build_object('ok',true,'subscriptionId',sid);
end$$;

create function public.member_push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public._member_push_member();
begin
 delete from public.member_push_subscriptions where member_id=uid and endpoint=p_endpoint;
 return jsonb_build_object('ok',true);
end$$;

-- At-most-one active attempt, with retries only after a definite provider rejection.
-- Never lease/reclaim 'sending': a lost response or process crash may already have sent.
-- Such rows intentionally stay uncertain instead of creating duplicate notifications.
create function public.member_push_claim(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.member_push_deliveries;s public.member_push_subscriptions;n public.member_notices;
 settings public.member_notice_settings;route public.notice_channels;t public.system_message_templates;
 expires timestamptz;attempt uuid;items jsonb:='[]'::jsonb;loc text;enabled boolean;g record;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='Invalid push batch';end if;
 perform set_config('lock_timeout','100ms',true);
 -- Serializes queue materialization without waiting on another cron invocation.
 if not pg_try_advisory_xact_lock(hashtextextended('member-push-claim',0)) then return jsonb_build_object('deliveries',items);end if;
 -- A 410 deletes its subscription. A briefly locked row is retried here, without blocking
 -- the rest of the batch; a later owner/generation must never be deleted by an old outcome.
 for g in select id,subscription_id,subscription_generation,member_id from public.member_push_deliveries where state='gone' order by updated_at,id limit 100 for update skip locked loop
  begin
   perform 1 from public.member_push_subscriptions where id=g.subscription_id for update nowait;
   delete from public.member_push_subscriptions where id=g.subscription_id and generation=g.subscription_generation and member_id=g.member_id;
   -- A moved subscription no longer belongs to this gone attempt.
   update public.member_push_deliveries set state='failed',updated_at=clock_timestamp() where id=g.id;
  exception when lock_not_available then
   update public.member_push_deliveries set updated_at=clock_timestamp() where id=g.id;
  end;
 end loop;
 insert into public.member_push_deliveries(notice_id,subscription_id,member_id,subscription_generation)
 select nn.id,ss.id,nn.member_id,ss.generation
 from public.member_notices nn join public.member_push_subscriptions ss on ss.member_id=nn.member_id
 where nn.app_text is not null and nn.created_at>=ss.created_at
  -- A notice Telegram held back for its throttle or hourly cap stays in the chat and doesn't buzz the phone.
  and nn.reason not in('throttled','hourly_cap')
  and nn.created_at>clock_timestamp()-case when nn.template_id like 'member.reminder\_%' then interval '30 minutes' else interval '6 hours' end
  and not exists(select 1 from public.member_push_deliveries dd where dd.notice_id=nn.id and dd.subscription_id=ss.id)
 order by nn.created_at,nn.id,ss.id limit 500
 on conflict(notice_id,subscription_id) do nothing;
 select * into settings from public.member_notice_settings where singleton;
 -- Limit examined candidates as well as sent envelopes; quiet rows defer so cannot starve
 -- subsequent claims. SKIP LOCKED avoids an outcome call holding up another delivery.
 for d in select * from public.member_push_deliveries where state='queued' and next_attempt_at<=clock_timestamp()
  order by next_attempt_at,id limit 500 for update skip locked loop
  exit when jsonb_array_length(items)>=p_limit;
  select * into s from public.member_push_subscriptions where id=d.subscription_id;
  select * into n from public.member_notices where id=d.notice_id;
  expires:=n.created_at+case when n.template_id like 'member.reminder\_%' then interval '30 minutes' else interval '6 hours' end;
  select * into route from public.notice_channels where template_id=n.template_id;
  enabled:=case n.notice_group when 'booking' then settings.booking when 'reminders' then settings.reminders when 'results' then settings.results when 'care' then settings.care end;
  if s.id is null or n.id is null or s.member_id<>d.member_id or s.generation<>d.subscription_generation or n.member_id<>d.member_id
   or n.app_text is null or expires<=clock_timestamp() or enabled is not true
   or not coalesce(route.push,true) or coalesce(route.audience,'member')<>'member'
   or exists(select 1 from public.workspace_staff where user_id=d.member_id)
   or exists(select 1 from public.clinic_portal_memberships where user_id=d.member_id)
  then update public.member_push_deliveries set state='failed',updated_at=clock_timestamp() where id=d.id;continue;end if;
  -- Same reminder quiet-time rule as Telegram: defer a fresh reminder, then test closure.
  if n.template_id like 'member.reminder\_%' and public._member_quiet_now(d.member_id,(clock_timestamp() at time zone 'Asia/Yerevan')::time) then
   update public.member_push_deliveries set next_attempt_at=least(expires,clock_timestamp()+interval '5 minutes'),updated_at=clock_timestamp() where id=d.id;continue;
  end if;
  if public._member_notice_closed(d.member_id,n.event_key,n.template_id,n.params) then
   update public.member_push_deliveries set state='failed',updated_at=clock_timestamp() where id=d.id;continue;
  end if;
  loc:=case when public._telegram_auth_locale(d.member_id)='en' then 'en' else 'hy' end;
  select * into t from public.system_message_templates where template_id='member_notice.push' and locale=loc order by version desc limit 1;
  -- Never interpolate event text or params into the lock-screen line. Newest unapproved
  -- copy holds delivery; adding an approved version may release it while still fresh.
  if t.approved is not true or t.body~'[{}\r\n]' or length(t.body)>240 then
   update public.member_push_deliveries set next_attempt_at=least(expires,clock_timestamp()+interval '5 minutes'),updated_at=clock_timestamp() where id=d.id;continue;
  end if;
  attempt:=gen_random_uuid();
  update public.member_push_deliveries set state='sending',attempts=attempts+1,attempt_id=attempt,updated_at=clock_timestamp() where id=d.id;
  items:=items||jsonb_build_array(jsonb_build_object('deliveryId',d.id,'attemptId',attempt,'noticeId',n.id,
   'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'text',t.body,
   'ttlSeconds',greatest(1,floor(extract(epoch from expires-clock_timestamp()))::integer)));
 end loop;
 return jsonb_build_object('deliveries',items);
exception when lock_not_available then
 -- Any locks while inserting FKs also have a bounded wait. The whole claim rolls back,
 -- so no invisible claim escapes when an empty envelope is returned.
 return jsonb_build_object('deliveries','[]'::jsonb);
end$$;

create function public.member_push_outcome(p_delivery uuid,p_attempt uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.member_push_deliveries;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_outcome is null or p_outcome not in('sent','retryable','failed','unknown','gone') then raise invalid_parameter_value using message='Invalid push outcome';end if;
 perform set_config('lock_timeout','100ms',true);
 select * into d from public.member_push_deliveries where id=p_delivery for update nowait;
 if not found or d.state<>'sending' or d.attempt_id is distinct from p_attempt then return jsonb_build_object('ok',false);end if;
 update public.member_push_deliveries set state=case when p_outcome='retryable' and attempts<3 then 'queued' when p_outcome='retryable' then 'failed' else p_outcome end,
  next_attempt_at=clock_timestamp()+make_interval(secs=>60*d.attempts),updated_at=clock_timestamp() where id=d.id;
 if p_outcome='sent' then
  begin
   perform 1 from public.member_push_subscriptions where id=d.subscription_id for update nowait;
   update public.member_push_subscriptions set last_ok_at=clock_timestamp()
    where id=d.subscription_id and generation=d.subscription_generation and member_id=d.member_id;
  exception when lock_not_available then null;end;
 end if;
 if p_outcome='gone' then
  begin
   perform 1 from public.member_push_subscriptions where id=d.subscription_id for update nowait;
   delete from public.member_push_subscriptions where id=d.subscription_id and generation=d.subscription_generation and member_id=d.member_id;
  exception when lock_not_available then null;end;
 end if;
 return jsonb_build_object('ok',true);
exception when lock_not_available then return jsonb_build_object('ok',false);
end$$;

revoke all on function public._member_push_member(),public.member_push_subscribe(text,text,text),public.member_push_unsubscribe(text),
 public.member_push_claim(integer),public.member_push_outcome(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.member_push_subscribe(text,text,text),public.member_push_unsubscribe(text) to authenticated;
grant execute on function public.member_push_claim(integer),public.member_push_outcome(uuid,uuid,text) to service_role;
