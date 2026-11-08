-- Pilot commerce groundwork, all shipped dark:
--  * test catalogue with prices and a kept price history      (NOREON_PILOT_CATALOG_ENABLED)
--  * one payment record per booking, manual mark-paid, fake provider only (NOREON_PILOT_PAYMENTS_ENABLED)
--  * admin cohort overview built from existing records       (NOREON_GM_DASHBOARD_ENABLED)
--
-- Davidyants has not supplied its test list, codes, prices, tax policy or payment
-- method (output/PENDING_QUESTIONS.md). Every seeded entry below is fictional and
-- marked 'staging-placeholder'; the member page labels such prices as samples.
--
-- No card data is ever stored. A payment holds an amount, a state, a priced snapshot
-- of the booked tests and an opaque provider reference, nothing else.

-- ---------------------------------------------------------------- catalogue
create table public.pilot_catalog_tests(
 id uuid primary key default gen_random_uuid(),
 -- The booking program's test id (lib/clinical/seed/tests.ts), which is how a booked item finds its price.
 test_key text not null unique check(test_key~'^[a-z0-9][a-z0-9-]{1,63}$'),
 partner_code text not null unique check(partner_code~'^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
 name_en text not null check(length(btrim(name_en))between 1 and 200),
 name_hy text not null check(length(btrim(name_hy))between 1 and 200),
 included_in_package boolean not null default false,
 active_from date not null,
 active_until date,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(active_until is null or active_until>=active_from)
);

-- Price history. A row is never edited or removed: a new price is a new row with
-- its own effective instant, so a paid snapshot can always be traced to the row it used.
create table public.pilot_catalog_prices(
 id uuid primary key default gen_random_uuid(),
 test_id uuid not null references public.pilot_catalog_tests(id),
 price_amd integer not null check(price_amd between 0 and 10000000),
 price_source text not null check(price_source in('staging-placeholder','partner-approved')),
 effective_from timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 recorded_by uuid references auth.users(id),
 recorded_by_name text not null check(length(btrim(recorded_by_name))between 1 and 160),
 reason text not null check(length(btrim(reason))between 1 and 500),
 unique(test_id,effective_from)
);
create index pilot_catalog_prices_current on public.pilot_catalog_prices(test_id,effective_from desc);

create table public.pilot_catalog_events(
 id uuid primary key default gen_random_uuid(),
 test_id uuid not null references public.pilot_catalog_tests(id),
 kind text not null check(kind in('created','updated','price')),
 actor_id uuid references auth.users(id),actor_name text not null,
 reason text,detail jsonb not null default '{}',
 at timestamptz not null default clock_timestamp()
);
create index pilot_catalog_events_test on public.pilot_catalog_events(test_id,at desc);

create function public._pilot_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Pilot history is immutable';
end$$;
create trigger pilot_catalog_prices_immutable before update or delete on public.pilot_catalog_prices for each row execute function public._pilot_immutable();
create trigger pilot_catalog_events_immutable before update or delete on public.pilot_catalog_events for each row execute function public._pilot_immutable();

-- ---------------------------------------------------------------- payments
-- One payment record per booking: a legacy test request or a unified-booking appointment.
create table public.pilot_payments(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id),
 test_request_id uuid unique references public.patient_test_requests(id),
 appointment_id uuid unique references public.booking_appointments(id),
 amount_amd integer not null check(amount_amd between 0 and 100000000),
 currency text not null default 'AMD' check(currency='AMD'),
 -- Priced snapshot of the booked tests at creation. Later catalogue changes never alter it.
 lines jsonb not null check(jsonb_typeof(lines)='array'and jsonb_array_length(lines)between 1 and 100),
 price_basis text not null check(price_basis in('staging-placeholder','partner-approved')),
 status text not null default 'pending' check(status in('pending','paid','failed','refunded','waived')),
 provider text not null default 'manual' check(provider~'^[a-z0-9-]{1,40}$'),
 provider_reference text check(provider_reference is null or provider_reference~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 check((test_request_id is null)<>(appointment_id is null))
);
create unique index pilot_payments_provider_reference on public.pilot_payments(provider,provider_reference)where provider_reference is not null;
create index pilot_payments_member on public.pilot_payments(member_id,created_at desc);

create table public.pilot_payment_events(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.pilot_payments(id),
 kind text not null check(kind in('created','status','reference')),
 from_status text,to_status text,
 actor_kind text not null check(actor_kind in('admin','provider')),
 actor_id uuid references auth.users(id),actor_name text not null,
 reason text,provider_reference text,provider_event_id text,
 at timestamptz not null default clock_timestamp(),
 check(actor_kind='provider'or actor_id is not null)
);
create unique index pilot_payment_events_provider_event on public.pilot_payment_events(payment_id,provider_event_id)where provider_event_id is not null;
create index pilot_payment_events_payment on public.pilot_payment_events(payment_id,at desc);
create trigger pilot_payment_events_immutable before update or delete on public.pilot_payment_events for each row execute function public._pilot_immutable();
create function public._pilot_payment_guard()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='Pilot history is immutable';end if;
 -- The booking, amount and snapshot are fixed when the record is created.
 if(new.id,new.member_id,new.test_request_id,new.appointment_id,new.amount_amd,new.currency,new.lines,new.price_basis,new.created_at,new.created_by)
  is distinct from(old.id,old.member_id,old.test_request_id,old.appointment_id,old.amount_amd,old.currency,old.lines,old.price_basis,old.created_at,old.created_by)
 then raise exception using errcode='55000',message='Pilot history is immutable';end if;
 return new;
end$$;
create trigger pilot_payments_guard before update or delete on public.pilot_payments for each row execute function public._pilot_payment_guard();

-- Idempotent admin commands: resending the same submission replays the stored result.
create table public.pilot_commands(
 actor_id uuid not null references auth.users(id),submission_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,submission_id)
);

alter table public.pilot_catalog_tests enable row level security;
alter table public.pilot_catalog_prices enable row level security;
alter table public.pilot_catalog_events enable row level security;
alter table public.pilot_payments enable row level security;
alter table public.pilot_payment_events enable row level security;
alter table public.pilot_commands enable row level security;
-- No direct table access: every read and write goes through the functions below.
revoke all on public.pilot_catalog_tests,public.pilot_catalog_prices,public.pilot_catalog_events,
 public.pilot_payments,public.pilot_payment_events,public.pilot_commands from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------- shared helpers
-- Admin actor, with the same signed-in session checks as the clinic portal admin.
create function public._pilot_admin()returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 perform public._clinic_portal_admin();
 select * into s from public.workspace_staff where user_id=auth.uid()and role='admin'and active and removed_at is null;
 if not found then raise insufficient_privilege;end if;
 return s;
end$$;

-- The catalogue day is the Yerevan calendar day.
create function public._pilot_today()returns date language sql stable set search_path=''as $$
 select (clock_timestamp() at time zone 'Asia/Yerevan')::date
$$;

create function public._pilot_current_price(p_test uuid,p_at timestamptz)returns public.pilot_catalog_prices
language sql stable security definer set search_path=''as $$
 select * from public.pilot_catalog_prices where test_id=p_test and effective_from<=p_at order by effective_from desc limit 1
$$;

create function public._pilot_price_json(p public.pilot_catalog_prices)returns jsonb
language sql stable set search_path=''as $$
 select case when p.id is null then null else jsonb_build_object('id',p.id,'priceAmd',p.price_amd,'source',p.price_source,
  'effectiveFrom',p.effective_from,'recordedAt',p.recorded_at,'recordedBy',p.recorded_by_name,'reason',p.reason)end
$$;

-- ---------------------------------------------------------------- seed (fictional)
do $$
declare t uuid;r record;
begin
 for r in select * from(values
  ('bp-visit','STG-BP-01','Repeated blood pressure measurement','Զարկերակային ճնշման կրկնակի չափում',true,0),
  ('anthropometry','STG-ANT-01','Weight and waist measurement','Քաշի և գոտկատեղի չափում',true,0),
  ('lipid-panel','STG-LIP-01','Lipid profile with LDL-C','Լիպիդային պրոֆիլ և LDL-C',false,6000),
  ('apob','STG-APB-01','ApoB','ApoB',false,9000),
  ('lpa','STG-LPA-01','Lp(a)','Lp(a)',false,12000),
  ('hba1c','STG-HBA-01','HbA1c','HbA1c',false,5000),
  ('hba1c-glucose','STG-HBG-01','HbA1c and fasting glucose','HbA1c և քաղցած գլյուկոզա',false,6500),
  ('creatinine-egfr','STG-CRE-01','Creatinine and eGFR','Կրեատինին և eGFR',false,3000),
  ('ecg-12-lead','STG-ECG-01','12-lead ECG','12-առաջատար ԷՍԳ',false,7000),
  ('tsh','STG-TSH-01','TSH','TSH',false,4500),
  ('nt-probnp','STG-BNP-01','NT-proBNP','NT-proBNP',false,15000),
  ('echocardiogram','STG-ECH-01','Echocardiogram','ԷխոԿԳ',false,20000),
  ('holter','STG-HOL-01','24–48 hour Holter monitoring','Հոլտեր 24–48 ժամ',false,25000)
 )as v(test_key,code,name_en,name_hy,included,price)loop
  insert into public.pilot_catalog_tests(test_key,partner_code,name_en,name_hy,included_in_package,active_from)
   values(r.test_key,r.code,r.name_en,r.name_hy,r.included,date '2026-10-01')returning id into t;
  insert into public.pilot_catalog_prices(test_id,price_amd,price_source,effective_from,recorded_by_name,reason)
   values(t,r.price,'staging-placeholder',timestamptz '2026-10-01 00:00+04','Seed','STAGING placeholder; awaiting the Davidyants price list');
  insert into public.pilot_catalog_events(test_id,kind,actor_name,reason,detail)
   values(t,'created','Seed','STAGING placeholder; awaiting the Davidyants price list',jsonb_build_object('priceAmd',r.price,'source','staging-placeholder'));
 end loop;
end$$;

-- ---------------------------------------------------------------- catalogue reads
create function public._pilot_catalog_test_json(t public.pilot_catalog_tests,p_now timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',t.id,'testKey',t.test_key,'partnerCode',t.partner_code,'nameEn',t.name_en,'nameHy',t.name_hy,
  'includedInPackage',t.included_in_package,'activeFrom',t.active_from,'activeUntil',t.active_until,'revision',t.revision,
  'active',t.active_from<=public._pilot_today()and(t.active_until is null or t.active_until>=public._pilot_today()),
  'currentPrice',public._pilot_price_json(public._pilot_current_price(t.id,p_now)))
$$;

-- Admin: every entry with its current price and full price history.
create function public.pilot_catalog_admin()returns jsonb
language plpgsql security definer set search_path=''as $$
declare now_at timestamptz:=clock_timestamp();
begin
 perform public._pilot_admin();
 return jsonb_build_object('asOf',now_at,'tests',coalesce((select jsonb_agg(public._pilot_catalog_test_json(t,now_at)||jsonb_build_object(
   'prices',coalesce((select jsonb_agg(public._pilot_price_json(p)order by p.effective_from desc)from public.pilot_catalog_prices p where p.test_id=t.id),'[]'))
  order by t.name_en)from public.pilot_catalog_tests t),'[]'));
end$$;

-- Any signed-in account: the active entries and their current prices. Catalogue
-- data only; nothing about any member.
create function public.pilot_catalog_member()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare now_at timestamptz:=clock_timestamp();
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 return jsonb_build_object('asOf',now_at,'tests',coalesce((select jsonb_agg(jsonb_build_object('testKey',t.test_key,'nameEn',t.name_en,'nameHy',t.name_hy,
   'includedInPackage',t.included_in_package,'priceAmd',p.price_amd,'priceSource',p.price_source)order by t.test_key)
  from public.pilot_catalog_tests t left join lateral(select * from public._pilot_current_price(t.id,now_at))p on true
  where t.active_from<=public._pilot_today()and(t.active_until is null or t.active_until>=public._pilot_today())),'[]'));
end$$;

-- ---------------------------------------------------------------- payment helpers
create function public._pilot_payment_json(y public.pilot_payments,p_admin boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',y.id,'memberId',y.member_id,
  'bookingKind',case when y.appointment_id is null then 'test-request'else 'appointment'end,
  'bookingId',coalesce(y.appointment_id,y.test_request_id),
  'amountAmd',y.amount_amd,'currency',y.currency,'lines',y.lines,'priceBasis',y.price_basis,'status',y.status,
  'revision',y.revision,'createdAt',y.created_at,'updatedAt',y.updated_at)
  ||case when p_admin then jsonb_build_object('provider',y.provider,'providerReference',y.provider_reference,
   'events',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'fromStatus',e.from_status,'toStatus',e.to_status,'actorKind',e.actor_kind,
     'actorName',e.actor_name,'reason',e.reason,'providerReference',e.provider_reference,'at',e.at)order by e.at desc,e.id)
    from public.pilot_payment_events e where e.payment_id=y.id),'[]'))else '{}'::jsonb end
$$;

create function public._pilot_payment_transition_allowed(p_from text,p_to text)returns boolean
language sql immutable set search_path=''as $$
 select (p_from,p_to)in(('pending','paid'),('pending','failed'),('pending','waived'),
  ('failed','pending'),('failed','paid'),('failed','waived'),('paid','refunded'))
$$;

-- The booked items of a booking, as {id,title,method}. Home tracking is never billed.
create function public._pilot_booking_items(p_request uuid,p_appointment uuid,out o_member uuid,out o_items jsonb,out o_state text)
language plpgsql stable security definer set search_path=''as $$
declare r public.patient_test_requests;a public.booking_appointments;
begin
 if p_request is not null then
  select * into r from public.patient_test_requests where id=p_request;
  if not found then o_state:='not-found';return;end if;
  if r.status='cancelled'then o_state:='booking-cancelled';return;end if;
  -- A request converted to the unified booking is billed through its appointment.
  if exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id)then o_state:='converted';return;end if;
  o_member:=r.user_id;o_items:=coalesce(r.requirements,'[]');
 else
  select * into a from public.booking_appointments where id=p_appointment;
  if not found then o_state:='not-found';return;end if;
  if a.status='cancelled'then o_state:='booking-cancelled';return;end if;
  o_member:=a.member_id;
  select coalesce(s.program->'items','[]')into o_items from public.booking_program_seals s where s.id=a.program_id;
 end if;
 o_items:=coalesce((select jsonb_agg(i)from jsonb_array_elements(o_items)i where coalesce(i->>'method','')<>'home-log'),'[]');
 o_state:='ok';
end$$;

-- Prices a list of booked items against the active catalogue now.
-- Unknown, inactive or unpriced items are returned, never priced as zero.
create function public._pilot_price_items(p_items jsonb,out o_lines jsonb,out o_unpriced jsonb,out o_total integer,out o_basis text)
language plpgsql stable security definer set search_path=''as $$
declare i jsonb;t public.pilot_catalog_tests;p public.pilot_catalog_prices;now_at timestamptz:=clock_timestamp();
begin
 o_lines:='[]';o_unpriced:='[]';o_total:=0;o_basis:='partner-approved';
 for i in select * from jsonb_array_elements(p_items)loop
  t:=null;
  select * into t from public.pilot_catalog_tests where test_key=i->>'id'
   and active_from<=public._pilot_today()and(active_until is null or active_until>=public._pilot_today());
  p:=case when t.id is null then null else public._pilot_current_price(t.id,now_at)end;
  if t.id is null or p.id is null then
   o_unpriced:=o_unpriced||jsonb_build_array(jsonb_build_object('testKey',i->>'id','title',i->>'title'));continue;
  end if;
  o_lines:=o_lines||jsonb_build_array(jsonb_build_object('testKey',t.test_key,'partnerCode',t.partner_code,'nameEn',t.name_en,'nameHy',t.name_hy,
   'includedInPackage',t.included_in_package,'priceAmd',p.price_amd,'chargedAmd',case when t.included_in_package then 0 else p.price_amd end,
   'priceId',p.id,'priceSource',p.price_source));
  if not t.included_in_package then o_total:=o_total+p.price_amd;end if;
  if p.price_source='staging-placeholder'then o_basis:='staging-placeholder';end if;
 end loop;
end$$;

-- ---------------------------------------------------------------- payment reads
-- Admin: every live booking with its payment record, or a priced preview when none exists.
create function public.pilot_admin_payments()returns jsonb
language plpgsql security definer set search_path=''as $$
declare b record;items record;priced record;preview jsonb;rows jsonb:='[]';y public.pilot_payments;
begin
 perform public._pilot_admin();
 for b in
  select 'test-request'kind,r.id,r.user_id member_id,r.created_at,r.status,null::uuid appointment_id,r.id request_id from public.patient_test_requests r
   where not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id)
     and(r.status<>'cancelled'or exists(select 1 from public.pilot_payments y2 where y2.test_request_id=r.id))
  union all
  select 'appointment',a.id,a.member_id,a.created_at,a.status,a.id,null from public.booking_appointments a
   where a.status<>'cancelled'or exists(select 1 from public.pilot_payments y2 where y2.appointment_id=a.id)
  order by 4 desc limit 500
 loop
  select * into y from public.pilot_payments where(b.kind='test-request'and test_request_id=b.id)or(b.kind='appointment'and appointment_id=b.id);
  if y.id is null and b.status<>'cancelled'then
   select * into items from public._pilot_booking_items(b.request_id,b.appointment_id);
   select * into priced from public._pilot_price_items(coalesce(items.o_items,'[]'));
   preview:=jsonb_build_object('lines',priced.o_lines,'unpriced',priced.o_unpriced,'totalAmd',priced.o_total,'priceBasis',priced.o_basis);
  else preview:=null;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('bookingKind',b.kind,'bookingId',b.id,'bookingStatus',b.status,'bookedAt',b.created_at,
   'memberId',b.member_id,'memberName',coalesce((select nullif(btrim(pr.display_name),'')from public.profiles pr where pr.id=b.member_id),'Member'),
   'payment',case when y.id is null then null else public._pilot_payment_json(y,true)end,
   'preview',preview));
  y:=null;
 end loop;
 return jsonb_build_object('asOf',clock_timestamp(),'bookings',rows);
end$$;

-- Member: own payment records. No provider details.
create function public.pilot_member_payments()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 return jsonb_build_object('payments',coalesce((select jsonb_agg(public._pilot_payment_json(y,false)order by y.created_at desc)
  from public.pilot_payments y where y.member_id=auth.uid()),'[]'));
end$$;

-- ---------------------------------------------------------------- admin commands
-- {action,submissionId,...}
--  create-test   {testKey,partnerCode,nameEn,nameHy,includedInPackage,activeFrom,activeUntil|null,priceAmd|null,priceSource,reason}
--  update-test   {testId,revision,partnerCode,nameEn,nameHy,includedInPackage,activeFrom,activeUntil|null,reason}
--  set-price     {testId,priceAmd,priceSource,effectiveFrom|null,reason}   effectiveFrom now or later; history is kept
--  create-payment{bookingKind,bookingId}                                   snapshot priced now; refused while any item is unpriced
--  set-reference {paymentId,revision,provider,reference}                    link reference from the provider adapter
--  set-status    {paymentId,revision,status,reason,reference|null}          audited manual transition; mark paid needs a reference
create function public.pilot_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;sub uuid;act text;stored public.pilot_commands;result jsonb;
 t public.pilot_catalog_tests;y public.pilot_payments;items record;priced record;
 v_price integer;v_source text;v_from timestamptz;v_reason text;v_until date;v_start date;v_status text;v_ref text;v_req uuid;v_appt uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 s:=public._pilot_admin();
 if jsonb_typeof(p_command)is distinct from 'object'or jsonb_typeof(p_command->'submissionId')is distinct from 'string'
  or jsonb_typeof(p_command->'action')is distinct from 'string'then return bad;end if;
 begin sub:=(p_command->>'submissionId')::uuid;exception when invalid_text_representation then return bad;end;
 act:=p_command->>'action';
 select * into stored from public.pilot_commands where actor_id=s.user_id and submission_id=sub;
 if found then
  if stored.payload is distinct from p_command then return jsonb_build_object('status','invalid');end if;
  return stored.result||jsonb_build_object('replayed',true);
 end if;
 v_reason:=nullif(btrim(coalesce(p_command->>'reason','')),'');
 if v_reason is not null and length(v_reason)>500 then return bad;end if;
 begin
 if act in('create-test','update-test')then
  if jsonb_typeof(p_command->'includedInPackage')is distinct from 'boolean'or v_reason is null then return bad;end if;
  v_start:=(p_command->>'activeFrom')::date;v_until:=nullif(p_command->>'activeUntil','')::date;
  if v_start is null then return bad;end if;
  if act='create-test'then
   v_price:=(p_command->>'priceAmd')::integer;v_source:=coalesce(p_command->>'priceSource','staging-placeholder');
   if v_source not in('staging-placeholder','partner-approved')then return bad;end if;
   insert into public.pilot_catalog_tests(test_key,partner_code,name_en,name_hy,included_in_package,active_from,active_until)
    values(lower(btrim(p_command->>'testKey')),btrim(p_command->>'partnerCode'),btrim(p_command->>'nameEn'),btrim(p_command->>'nameHy'),
     (p_command->>'includedInPackage')::boolean,v_start,v_until)returning * into t;
   insert into public.pilot_catalog_events(test_id,kind,actor_id,actor_name,reason,detail)
    values(t.id,'created',s.user_id,s.display_name,v_reason,jsonb_build_object('testKey',t.test_key,'partnerCode',t.partner_code));
   if v_price is not null then
    insert into public.pilot_catalog_prices(test_id,price_amd,price_source,effective_from,recorded_by,recorded_by_name,reason)
     values(t.id,v_price,v_source,clock_timestamp(),s.user_id,s.display_name,v_reason);
    insert into public.pilot_catalog_events(test_id,kind,actor_id,actor_name,reason,detail)
     values(t.id,'price',s.user_id,s.display_name,v_reason,jsonb_build_object('priceAmd',v_price,'source',v_source));
   end if;
  else
   select * into t from public.pilot_catalog_tests where id=(p_command->>'testId')::uuid for update nowait;
   if not found then return bad;end if;
   if t.revision is distinct from(p_command->>'revision')::bigint then return jsonb_build_object('status','stale');end if;
   update public.pilot_catalog_tests set partner_code=btrim(p_command->>'partnerCode'),name_en=btrim(p_command->>'nameEn'),name_hy=btrim(p_command->>'nameHy'),
    included_in_package=(p_command->>'includedInPackage')::boolean,active_from=v_start,active_until=v_until,revision=revision+1,updated_at=clock_timestamp()
    where id=t.id;
   insert into public.pilot_catalog_events(test_id,kind,actor_id,actor_name,reason,detail)
    values(t.id,'updated',s.user_id,s.display_name,v_reason,jsonb_build_object('before',jsonb_build_object('partnerCode',t.partner_code,'nameEn',t.name_en,'nameHy',t.name_hy,
     'includedInPackage',t.included_in_package,'activeFrom',t.active_from,'activeUntil',t.active_until)));
  end if;
  result:=jsonb_build_object('status','saved','testId',t.id);
 elsif act='set-price'then
  v_price:=(p_command->>'priceAmd')::integer;v_source:=p_command->>'priceSource';
  v_from:=coalesce(nullif(p_command->>'effectiveFrom','')::timestamptz,clock_timestamp());
  if v_price is null or v_source not in('staging-placeholder','partner-approved')or v_reason is null then return bad;end if;
  -- No backdating: a price never changes what an earlier snapshot was priced at.
  if v_from<clock_timestamp()-interval '1 minute'or v_from>clock_timestamp()+interval '366 days'then return bad;end if;
  select * into t from public.pilot_catalog_tests where id=(p_command->>'testId')::uuid for update nowait;
  if not found then return bad;end if;
  insert into public.pilot_catalog_prices(test_id,price_amd,price_source,effective_from,recorded_by,recorded_by_name,reason)
   values(t.id,v_price,v_source,v_from,s.user_id,s.display_name,v_reason);
  insert into public.pilot_catalog_events(test_id,kind,actor_id,actor_name,reason,detail)
   values(t.id,'price',s.user_id,s.display_name,v_reason,jsonb_build_object('priceAmd',v_price,'source',v_source,'effectiveFrom',v_from));
  result:=jsonb_build_object('status','saved','testId',t.id);
 elsif act='create-payment'then
  if p_command->>'bookingKind'='test-request'then v_req:=(p_command->>'bookingId')::uuid;
  elsif p_command->>'bookingKind'='appointment'then v_appt:=(p_command->>'bookingId')::uuid;
  else return bad;end if;
  if v_req is null and v_appt is null then return bad;end if;
  -- Serialise creation per booking so two admins cannot create two records.
  perform pg_advisory_xact_lock(hashtextextended('pilot-payment:'||coalesce(v_req,v_appt)::text,0));
  select * into y from public.pilot_payments where test_request_id=v_req or appointment_id=v_appt;
  if found then return jsonb_build_object('status','exists','paymentId',y.id);end if;
  select * into items from public._pilot_booking_items(v_req,v_appt);
  if items.o_state<>'ok'then return jsonb_build_object('status',items.o_state);end if;
  if jsonb_array_length(items.o_items)=0 then return jsonb_build_object('status','nothing-to-pay');end if;
  select * into priced from public._pilot_price_items(items.o_items);
  if jsonb_array_length(priced.o_unpriced)>0 then return jsonb_build_object('status','unpriced','unpriced',priced.o_unpriced);end if;
  insert into public.pilot_payments(member_id,test_request_id,appointment_id,amount_amd,lines,price_basis,created_by)
   values(items.o_member,v_req,v_appt,priced.o_total,priced.o_lines,priced.o_basis,s.user_id)returning * into y;
  insert into public.pilot_payment_events(payment_id,kind,to_status,actor_kind,actor_id,actor_name,reason)
   values(y.id,'created','pending','admin',s.user_id,s.display_name,v_reason);
  result:=jsonb_build_object('status','saved','paymentId',y.id);
 elsif act in('set-reference','set-status')then
  select * into y from public.pilot_payments where id=(p_command->>'paymentId')::uuid for update nowait;
  if not found then return bad;end if;
  if y.revision is distinct from(p_command->>'revision')::bigint then return jsonb_build_object('status','stale','current',y.status);end if;
  v_ref:=nullif(btrim(coalesce(p_command->>'reference','')),'');
  if act='set-reference'then
   if v_ref is null or y.status not in('pending','failed')or coalesce(p_command->>'provider','')!~'^[a-z0-9-]{1,40}$'then return bad;end if;
   update public.pilot_payments set provider=p_command->>'provider',provider_reference=v_ref,revision=revision+1,updated_at=clock_timestamp()where id=y.id;
   insert into public.pilot_payment_events(payment_id,kind,actor_kind,actor_id,actor_name,reason,provider_reference)
    values(y.id,'reference','admin',s.user_id,s.display_name,v_reason,v_ref);
  else
   v_status:=p_command->>'status';
   -- A repeated confirmation is not a second payment.
   if v_status=y.status then return jsonb_build_object('status','unchanged','current',y.status);end if;
   if not public._pilot_payment_transition_allowed(y.status,v_status)or v_reason is null then return bad;end if;
   if v_status='paid'and v_ref is null then return bad;end if;
   update public.pilot_payments set status=v_status,revision=revision+1,updated_at=clock_timestamp()where id=y.id;
   insert into public.pilot_payment_events(payment_id,kind,from_status,to_status,actor_kind,actor_id,actor_name,reason,provider_reference)
    values(y.id,'status',y.status,v_status,'admin',s.user_id,s.display_name,v_reason,v_ref);
  end if;
  result:=jsonb_build_object('status','saved','paymentId',y.id);
 else return bad;
 end if;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation then return bad;
 end;
 insert into public.pilot_commands(actor_id,submission_id,payload,result)values(s.user_id,sub,p_command,result);
 return result||jsonb_build_object('replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','conflict');
end$$;

-- ---------------------------------------------------------------- provider events (service role)
-- Entry point for a payment provider adapter, keyed by the provider's own reference.
-- {provider,providerReference,eventId,status:'paid'|'failed'|'refunded'}
-- Replaying an event id is a no-op; a transition the state machine does not allow is
-- reported, not applied, so a late or duplicate provider message cannot undo a refund.
create function public.pilot_payment_provider_event(p_event jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare y public.pilot_payments;v_status text;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_event)is distinct from 'object'or p_event-array['provider','providerReference','eventId','status']<>'{}'
  or coalesce(p_event->>'provider','')!~'^[a-z0-9-]{1,40}$'or coalesce(p_event->>'eventId','')!~'^[A-Za-z0-9._:-]{1,200}$'
  or coalesce(p_event->>'providerReference','')=''or p_event->>'status'not in('paid','failed','refunded')then return jsonb_build_object('status','invalid');end if;
 select * into y from public.pilot_payments where provider=p_event->>'provider'and provider_reference=p_event->>'providerReference'for update nowait;
 if not found then return jsonb_build_object('status','not-found');end if;
 if exists(select 1 from public.pilot_payment_events where payment_id=y.id and provider_event_id=p_event->>'eventId')then
  return jsonb_build_object('status','replayed','current',y.status);
 end if;
 v_status:=p_event->>'status';
 if v_status=y.status then return jsonb_build_object('status','unchanged','current',y.status);end if;
 if not public._pilot_payment_transition_allowed(y.status,v_status)then return jsonb_build_object('status','transition-refused','current',y.status);end if;
 update public.pilot_payments set status=v_status,revision=revision+1,updated_at=clock_timestamp()where id=y.id;
 insert into public.pilot_payment_events(payment_id,kind,from_status,to_status,actor_kind,actor_name,provider_reference,provider_event_id)
  values(y.id,'status',y.status,v_status,'provider',y.provider,y.provider_reference,p_event->>'eventId');
 return jsonb_build_object('status','saved','current',v_status);
exception when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','replayed');
end$$;

-- ---------------------------------------------------------------- cohort overview
-- Admin-only aggregate counts over existing records. Dates are Yerevan calendar days,
-- both inclusive. No member identifiers or clinical values are returned; doctor rows
-- carry staff display names only.
-- Cohort = every member with a clinical case; a Davidyants cohort marker is not defined yet.
create function public.pilot_gm_overview(p_from date,p_to date)returns jsonb
language plpgsql security definer set search_path=''as $$
declare lo timestamptz;hi timestamptz;
begin
 perform public._pilot_admin();
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise invalid_parameter_value;end if;
 lo:=p_from::timestamp at time zone 'Asia/Yerevan';hi:=(p_to+1)::timestamp at time zone 'Asia/Yerevan';
 return jsonb_build_object('asOf',clock_timestamp(),'from',p_from,'to',p_to,
  'enrolled',(select jsonb_build_object('total',count(*)filter(where created_at<hi),'inRange',count(*)filter(where created_at>=lo and created_at<hi))
   from public.patient_clinical_cases),
  'booked',(select jsonb_build_object('members',count(distinct member_id),'testRequests',count(*)filter(where kind='r'),'appointments',count(*)filter(where kind='a'))
   from(select 'r'kind,user_id member_id from public.patient_test_requests r where created_at>=lo and created_at<hi
     and not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id)
    union all select 'a',member_id from public.booking_appointments where created_at>=lo and created_at<hi)b),
  'cancelled',(select count(*)from(select id from public.patient_test_requests where status='cancelled'and created_at>=lo and created_at<hi
    union all select id from public.booking_appointments where status='cancelled'and created_at>=lo and created_at<hi)c),
  'visits',(select jsonb_build_object('recorded',count(*),'members',count(distinct user_id))from public.patient_care_visits where created_at>=lo and created_at<hi),
  'results',jsonb_build_object(
   'receivedMembers',(select count(distinct user_id)from(
     select user_id from public.clinic_result_attachments where created_at>=lo and created_at<hi
     union all select user_id from public.patient_care_lab_stages where stage='results-received'and occurred_at>=lo and occurred_at<hi)x),
   'releasedMembers',(select count(distinct user_id)from public.patient_clinical_publications where published_at>=lo and published_at<hi)),
  'bp',jsonb_build_object(
   'manualReadings',(select count(*)from public.patient_measurements where measured_at>=lo and measured_at<hi),
   'deviceReadings',(select count(*)from public.bp_device_readings where state='attached'and measured_at>=lo and measured_at<hi),
   'membersWithReadings',(select count(distinct user_id)from(
     select user_id from public.patient_measurements where measured_at>=lo and measured_at<hi
     union all select member_id from public.bp_device_readings where state='attached'and measured_at>=lo and measured_at<hi)x)),
  -- Awaiting reply is a current snapshot, the same rule as the doctor's Replies list.
  'awaitingReply',(select count(*)from public.conversations c
   where c.version>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),
  'payments',(select jsonb_build_object('pending',count(*)filter(where status='pending'),'paid',count(*)filter(where status='paid'),
    'failed',count(*)filter(where status='failed'),'refunded',count(*)filter(where status='refunded'),'waived',count(*)filter(where status='waived'),
    'paidAmd',coalesce(sum(amount_amd)filter(where status='paid'),0),'staging',count(*)filter(where price_basis='staging-placeholder'))
   from public.pilot_payments where created_at>=lo and created_at<hi),
  'unassignedMembers',(select count(*)from public.patient_clinical_cases where assigned_doctor_id is null and created_at<hi),
  'doctors',coalesce((select jsonb_agg(jsonb_build_object('name',w.display_name,'assignedMembers',
     (select count(*)from public.patient_clinical_cases cs where cs.assigned_doctor_id=w.user_id),
     'awaitingReply',(select count(*)from public.patient_clinical_cases cs join public.conversations c on c.member_id=cs.user_id
      where cs.assigned_doctor_id=w.user_id and c.version>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)))
    order by w.display_name)
   from public.workspace_staff w where w.role='doctor'and w.active and w.removed_at is null),'[]'));
end$$;

revoke all on function public._pilot_immutable(),public._pilot_payment_guard(),public._pilot_admin(),public._pilot_today(),
 public._pilot_current_price(uuid,timestamptz),public._pilot_price_json(public.pilot_catalog_prices),
 public._pilot_catalog_test_json(public.pilot_catalog_tests,timestamptz),public._pilot_payment_json(public.pilot_payments,boolean),
 public._pilot_payment_transition_allowed(text,text),public._pilot_booking_items(uuid,uuid),public._pilot_price_items(jsonb),
 public.pilot_catalog_admin(),public.pilot_catalog_member(),public.pilot_admin_payments(),public.pilot_member_payments(),
 public.pilot_command(jsonb),public.pilot_payment_provider_event(jsonb),public.pilot_gm_overview(date,date)
 from public,anon,authenticated,service_role;
grant execute on function public.pilot_catalog_admin(),public.pilot_catalog_member(),public.pilot_admin_payments(),public.pilot_member_payments(),
 public.pilot_command(jsonb),public.pilot_gm_overview(date,date)to authenticated;
grant execute on function public.pilot_payment_provider_event(jsonb)to service_role;
