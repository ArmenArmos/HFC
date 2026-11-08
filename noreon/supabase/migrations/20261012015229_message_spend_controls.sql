-- Conservative estimated spending reservations. No live tariff or currency is configured.
create table public.patient_message_spend_policy (
 id smallint primary key default 1 check(id=1),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 enabled boolean not null default false,
 currency text check(currency ~ '^[A-Z]{3}$'),
 daily_limit_micros bigint not null default 0 check(daily_limit_micros between 0 and 9000000000000),
 sms_segment_ceiling_micros bigint not null default 0 check(sms_segment_ceiling_micros between 0 and 9000000000000),
 whatsapp_message_ceiling_micros bigint not null default 0 check(whatsapp_message_ceiling_micros between 0 and 9000000000000),
 max_sms_segments smallint not null default 1 check(max_sms_segments between 1 and 10),
 allowed_prefixes text[] not null default '{}',
 valid_until timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 check(not enabled or (currency is not null and daily_limit_micros>0 and sms_segment_ceiling_micros>0 and whatsapp_message_ceiling_micros>0 and cardinality(allowed_prefixes)>0 and valid_until is not null)),
 check(sms_segment_ceiling_micros*max_sms_segments<=9000000000000)
);
insert into public.patient_message_spend_policy(id) values(1);
create table public.patient_message_spend_policy_events (
 revision bigint primary key,
 operator_label text not null check(operator_label ~ '^[A-Za-z0-9@._-]{3,100}$'),
 policy jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.patient_message_spend_totals (
 budget_day date not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 reserved_micros bigint not null check(reserved_micros between 0 and 9000000000000),
 primary key(budget_day,currency)
);
create table public.patient_message_spend_reservations (
 attempt_id uuid primary key references public.patient_message_attempts(id),
 budget_day date not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 amount_micros bigint not null check(amount_micros between 1 and 9000000000000),
 policy_revision bigint not null references public.patient_message_spend_policy_events(revision),
 segment_allowance smallint not null check(segment_allowance between 1 and 10),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(budget_day,currency) references public.patient_message_spend_totals(budget_day,currency)
);
alter table public.patient_message_spend_policy enable row level security;
alter table public.patient_message_spend_policy_events enable row level security;
alter table public.patient_message_spend_totals enable row level security;
alter table public.patient_message_spend_reservations enable row level security;
revoke all on public.patient_message_spend_policy,public.patient_message_spend_policy_events,public.patient_message_spend_totals,public.patient_message_spend_reservations from public,anon,authenticated,service_role;
grant select on public.patient_message_spend_policy,public.patient_message_spend_policy_events,public.patient_message_spend_totals,public.patient_message_spend_reservations to service_role;

create function public.configure_patient_message_spend(p_expected_revision bigint,p_policy jsonb,p_operator_label text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_policy public.patient_message_spend_policy;next_policy public.patient_message_spend_policy;prefixes text[];currency_value text;daily bigint;sms bigint;wa bigint;segments integer;expires timestamptz;field text;numeric_value numeric;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9@._-]{3,100}$' then raise exception 'invalid';end if;
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into current_policy from public.patient_message_spend_policy where id=1 for update;
 if current_policy.revision<>p_expected_revision then return false;end if;
 if jsonb_typeof(p_policy) is distinct from 'object' or jsonb_typeof(p_policy->'enabled') is distinct from 'boolean' then raise exception 'invalid';end if;
 if p_policy='{"enabled":false}'::jsonb then
  update public.patient_message_spend_policy set enabled=false,revision=revision+1,updated_at=clock_timestamp() where id=1 returning * into next_policy;
 else
  if p_policy->'enabled'<>'true'::jsonb or (select count(*) from jsonb_object_keys(p_policy))<>8
  or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('enabled','currency','daily_limit_micros','sms_segment_ceiling_micros','whatsapp_message_ceiling_micros','max_sms_segments','allowed_prefixes','valid_until')) then raise exception 'invalid';end if;
  foreach field in array array['daily_limit_micros','sms_segment_ceiling_micros','whatsapp_message_ceiling_micros','max_sms_segments'] loop
   if jsonb_typeof(p_policy->field) is distinct from 'number' then raise exception 'invalid';end if;
   numeric_value:=(p_policy->>field)::numeric;
   if numeric_value<>trunc(numeric_value) or numeric_value<1 or numeric_value>9000000000000 then raise exception 'invalid';end if;
  end loop;
  if (p_policy->>'max_sms_segments')::numeric>10 then raise exception 'invalid';end if;
  daily:=(p_policy->>'daily_limit_micros')::bigint;sms:=(p_policy->>'sms_segment_ceiling_micros')::bigint;wa:=(p_policy->>'whatsapp_message_ceiling_micros')::bigint;segments:=(p_policy->>'max_sms_segments')::integer;
  if sms*segments>9000000000000 then raise exception 'invalid';end if;
  if jsonb_typeof(p_policy->'currency') is distinct from 'string' or (p_policy->>'currency') !~ '^[A-Z]{3}$' then raise exception 'invalid';end if;
  currency_value:=p_policy->>'currency';
  if jsonb_typeof(p_policy->'allowed_prefixes') is distinct from 'array' then raise exception 'invalid';end if;
  if jsonb_array_length(p_policy->'allowed_prefixes') not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_policy->'allowed_prefixes') v where jsonb_typeof(v) is distinct from 'string') then raise exception 'invalid';end if;
  select array_agg(v) into prefixes from jsonb_array_elements_text(p_policy->'allowed_prefixes') v;
  if exists(select 1 from unnest(prefixes) v where v !~ '^\+[1-9][0-9]{0,7}$') or cardinality(prefixes)<>(select count(distinct v) from unnest(prefixes) v) then raise exception 'invalid';end if;
  if jsonb_typeof(p_policy->'valid_until') is distinct from 'string' or (p_policy->>'valid_until') !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'invalid';end if;
  begin expires:=(p_policy->>'valid_until')::timestamptz;exception when others then raise exception 'invalid';end;
  if not isfinite(expires) or expires<=clock_timestamp() then raise exception 'invalid';end if;
  if currency_value is distinct from current_policy.currency and exists(select 1 from public.patient_message_spend_reservations) then raise exception 'message currency locked';end if;
  update public.patient_message_spend_policy set revision=revision+1,enabled=true,currency=currency_value,daily_limit_micros=daily,sms_segment_ceiling_micros=sms,whatsapp_message_ceiling_micros=wa,max_sms_segments=segments,allowed_prefixes=prefixes,valid_until=expires,updated_at=clock_timestamp() where id=1 returning * into next_policy;
 end if;
 insert into public.patient_message_spend_policy_events(revision,operator_label,policy) values(next_policy.revision,p_operator_label,to_jsonb(next_policy));
 return true;
end $$;
revoke all on function public.configure_patient_message_spend(bigint,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.configure_patient_message_spend(bigint,jsonb,text) to service_role;

-- Only the budget-aware version remains callable by a worker. Keep existing lock/eligibility logic private.
revoke all on function public.begin_patient_message_submission(uuid) from public,anon,authenticated,service_role;
create function public.begin_patient_message_submission_budgeted(p_job_id uuid,p_policy_revision bigint)
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
declare p public.patient_message_spend_policy;r record;amount bigint;used bigint;today date;
begin
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 if not exists(select 1 from public.patient_message_outbox where id=p_job_id and state='queued') then return;end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not p.enabled or p.valid_until is null or p.valid_until<=clock_timestamp() then raise exception 'message spending unconfigured';end if;
 if p_policy_revision is null or p.revision<>p_policy_revision then raise exception 'message spending revision';end if;
 select * into r from public.begin_patient_message_submission(p_job_id);
 if not found then return;end if;
 if not exists(select 1 from unnest(p.allowed_prefixes) prefix where starts_with(r.destination,prefix)) then raise exception 'message destination blocked';end if;
 amount:=case when r.channel='sms' then p.sms_segment_ceiling_micros*p.max_sms_segments else p.whatsapp_message_ceiling_micros end;
 today:=(clock_timestamp() at time zone 'UTC')::date;
 select reserved_micros into used from public.patient_message_spend_totals where budget_day=today and currency=p.currency;
 used:=coalesce(used,0);
 if amount>p.daily_limit_micros-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,p.currency,amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.patient_message_spend_reservations(attempt_id,budget_day,currency,amount_micros,policy_revision,segment_allowance) values(r.attempt_id,today,p.currency,amount,p.revision,case when r.channel='sms' then p.max_sms_segments else 1 end);
 return query select r.attempt_id,r.destination,r.channel,r.template_key,r.locale;
end $$;
revoke all on function public.begin_patient_message_submission_budgeted(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission_budgeted(uuid,bigint) to service_role;
