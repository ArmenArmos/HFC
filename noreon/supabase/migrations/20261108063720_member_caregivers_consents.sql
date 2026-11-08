-- WP F (RBAC foundation): authorized caregivers, member consents and their chat cards.
--
-- * member_consents: one append-only record of each member consent decision (data processing, caregiver sharing, voice
--   processing, research, Telegram channel), with the wording version, the hash of the exact text shown and how the
--   member confirmed it. patient_consents and zoe_consents are untouched.
-- * member_caregivers: a member invites a person by phone number to help them, with explicit scopes. The invited person
--   signs in with that phone number (the ordinary member phone sign-in) and accepts. Nothing is shared until then, and
--   the member can change scopes or revoke at any time. member_caregiver_events is the append-only trail.
-- * Delegated actions read and write only through definer functions that check _caregiver_can(member, caregiver, scope)
--   and record every read and write in member_caregiver_events and access_audit (actor_role 'caregiver').
-- * zoe_chat_cards gains the kinds 'caregiver' and 'consents'.
--
-- Draft wording: the consent texts the hashes refer to live in lib/consents/copy.ts and are not yet legally approved.

create or replace function pg_temp.widen_in_check(p_table regclass,p_constraint text,p_column text,p_add text[])returns void
language plpgsql as $$
declare def text;vals text[];
begin
 select pg_get_constraintdef(oid)into def from pg_constraint where conrelid=p_table and conname=p_constraint;
 if def is null then raise exception 'Constraint % not found',p_constraint;end if;
 select coalesce(array_agg(m[1] order by ord),'{}')into vals from regexp_matches(def,'''([^'']+)''::text','g')with ordinality t(m,ord);
 if cardinality(vals)=0 then raise exception 'Constraint % is not a value list',p_constraint;end if;
 select array_agg(v order by first_seen)into vals from(select v,min(o)first_seen from unnest(vals||p_add)with ordinality u(v,o)group by v)x;
 execute format('alter table %s drop constraint %I',p_table,p_constraint);
 execute format('alter table %s add constraint %I check(%I in(%s))',p_table,p_constraint,p_column,(select string_agg(quote_literal(v),',')from unnest(vals)v));
end$$;
-- Function patches (exact text replacements of live definitions) are queued here and applied by one DO block at the
-- end of this migration, each asserting that its target text occurs exactly once.
drop table if exists pg_temp.function_patches;
create temp table function_patches(n serial primary key,fn regprocedure not null,old text not null,new text not null);

-- History rows may only go when their member's account itself is deleted (the cascade), as zoe_consents does.
create function public._member_history_immutable()returns trigger
language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from auth.users where id=old.member_id)then return old;end if;
 raise exception using errcode='55000',message='Member history is append-only';
end$$;
revoke all on function public._member_history_immutable()from public,anon,authenticated,service_role;

-- The signed-in member: an authenticated, phone-confirmed account that is not staff. Raises otherwise.
create function public._member_self()returns uuid
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not exists(select 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null and(banned_until is null or banned_until<=clock_timestamp()))
  or exists(select 1 from public.workspace_staff where user_id=m)then raise insufficient_privilege using message='Member session required';end if;
 return m;
end$$;
revoke all on function public._member_self()from public,anon,authenticated,service_role;

-- The confirmed phone of the signed-in account in E.164, or null. Auth stores it without the plus.
create function public._auth_phone_e164(p_user uuid)returns text
language sql stable security definer set search_path=''as $$
 select '+'||ltrim(u.phone,'+')from auth.users u where u.id=p_user and u.phone is not null and u.phone<>'' and u.phone_confirmed_at is not null
  and(u.banned_until is null or u.banned_until<=clock_timestamp())
$$;
revoke all on function public._auth_phone_e164(uuid)from public,anon,authenticated,service_role;

-- 1. Member consents ------------------------------------------------------------------------------------------------

create table public.member_consents(
 id bigint generated always as identity primary key,
 member_id uuid not null references auth.users(id) on delete cascade,
 kind text not null constraint member_consents_kind_check check(kind in('data_processing','caregiver_sharing','voice_processing','research','telegram_channel')),
 granted boolean not null,
 wording_version text not null constraint member_consents_wording_version_check check(wording_version ~ '^[a-z0-9-]{1,64}$'),
 text_hash text not null constraint member_consents_text_hash_check check(text_hash ~ '^[a-f0-9]{64}$'),
 method text not null constraint member_consents_method_check check(method in('tap','voice')),
 source text not null constraint member_consents_source_check check(source in('chat_card','settings','enrolment','caregiver_invite','caregiver_scopes','caregiver_revoke','telegram')),
 recorded_at timestamptz not null default clock_timestamp()
);
create index member_consents_member on public.member_consents(member_id,kind,id desc);
alter table public.member_consents enable row level security;
revoke all on public.member_consents from public,anon,authenticated,service_role;
grant select on public.member_consents to authenticated;
create policy member_consents_own on public.member_consents for select to authenticated using((select auth.uid())=member_id);
create trigger member_consents_append_only before update or delete on public.member_consents for each row execute function public._member_history_immutable();
comment on table public.member_consents is
 'Append-only member consent decisions. The newest row per member and kind is the current choice. Written only through member_consent_set and the caregiver invitation functions.';

create function public._member_consent_row_json(c public.member_consents)returns jsonb
language sql immutable set search_path=''as $$
 select jsonb_build_object('kind',c.kind,'granted',c.granted,'wordingVersion',c.wording_version,'method',c.method,'source',c.source,'recordedAt',c.recorded_at)
$$;
revoke all on function public._member_consent_row_json(public.member_consents)from public,anon,authenticated,service_role;

create function public._member_consents_current(p_member uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(public._member_consent_row_json(c)order by c.kind),'[]'::jsonb)
 from(select distinct on(kind)* from public.member_consents where member_id=p_member order by kind,id desc)c
$$;
revoke all on function public._member_consents_current(uuid)from public,anon,authenticated,service_role;

create function public._member_consent_record(p_member uuid,p_kind text,p_granted boolean,p_wording_version text,p_text_hash text,p_method text,p_source text)returns boolean
language plpgsql security definer set search_path=''as $$
declare cur public.member_consents;
begin
 perform pg_advisory_xact_lock(hashtextextended('member-consent:'||p_member::text,0));
 select * into cur from public.member_consents where member_id=p_member and kind=p_kind order by id desc limit 1;
 -- The same decision about the same text again changes nothing.
 if found and cur.granted=p_granted and cur.wording_version=p_wording_version and cur.text_hash=p_text_hash then return false;end if;
 insert into public.member_consents(member_id,kind,granted,wording_version,text_hash,method,source)values(p_member,p_kind,p_granted,p_wording_version,p_text_hash,p_method,p_source);
 return true;
end$$;
revoke all on function public._member_consent_record(uuid,text,boolean,text,text,text,text)from public,anon,authenticated,service_role;

-- Caregiver sharing is decided on the caregiver card (invite and revoke), never here.
create function public.member_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_text_hash text,p_method text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=public._member_self();changed boolean;
begin
 if p_kind is null or p_kind not in('data_processing','voice_processing','research','telegram_channel')or p_granted is null
  or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'or coalesce(p_text_hash,'')!~'^[a-f0-9]{64}$'
  or p_method is null or p_method not in('tap','voice')or p_source is null or p_source not in('chat_card','settings','enrolment','telegram')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 changed:=public._member_consent_record(m,p_kind,p_granted,p_wording_version,p_text_hash,p_method,p_source);
 return jsonb_build_object('ok',true,'changed',changed,'consents',public._member_consents_current(m));
end$$;
create function public.member_consents_current()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=public._member_self();
begin
 return jsonb_build_object('ok',true,'consents',public._member_consents_current(m));
end$$;
create function public.member_consent_history()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=public._member_self();
begin
 return jsonb_build_object('ok',true,'history',coalesce((select jsonb_agg(public._member_consent_row_json(c)order by c.id desc)
  from(select * from public.member_consents where member_id=m order by id desc limit 200)c),'[]'::jsonb));
end$$;
revoke all on function public.member_consent_set(text,boolean,text,text,text,text),public.member_consents_current(),public.member_consent_history()from public,anon,authenticated,service_role;
grant execute on function public.member_consent_set(text,boolean,text,text,text,text),public.member_consents_current(),public.member_consent_history()to authenticated;

-- 2. Caregivers ------------------------------------------------------------------------------------------------------

create table public.member_caregivers(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 caregiver_user_id uuid references auth.users(id) on delete set null,
 request_id uuid not null,
 phone text not null constraint member_caregivers_phone_check check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 display_name text not null constraint member_caregivers_display_name_check check(length(btrim(display_name))between 1 and 80 and display_name=btrim(display_name)),
 relationship text not null constraint member_caregivers_relationship_check check(relationship in('spouse','partner','child','parent','sibling','relative','friend','other')),
 scopes text[] not null constraint member_caregivers_scopes_check check(cardinality(scopes)between 1 and 6
  and scopes<@array['view_plan','view_readings','log_readings','confirm_doses','receive_alerts','message_care_team']::text[]
  and array_position(scopes,null)is null),
 status text not null default 'pending' constraint member_caregivers_status_check check(status in('pending','active','revoked','declined')),
 consent_wording_version text not null constraint member_caregivers_wording_check check(consent_wording_version ~ '^[a-z0-9-]{1,64}$'),
 consent_text_hash text not null constraint member_caregivers_hash_check check(consent_text_hash ~ '^[a-f0-9]{64}$'),
 consent_method text not null default 'tap' constraint member_caregivers_method_check check(consent_method in('tap','voice')),
 invited_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 declined_at timestamptz,
 revoked_at timestamptz,
 revision bigint not null default 1 constraint member_caregivers_revision_check check(revision>0),
 constraint member_caregivers_request unique(member_id,request_id),
 constraint member_caregivers_not_self check(caregiver_user_id is distinct from member_id),
 constraint member_caregivers_active_shape check(status<>'active'or(caregiver_user_id is not null and accepted_at is not null and revoked_at is null)),
 constraint member_caregivers_revoked_shape check((status='revoked')=(revoked_at is not null)),
 constraint member_caregivers_declined_shape check((status='declined')=(declined_at is not null))
);
-- One active link per member and phone number, and per member and caregiver account. A pending invitation is live for
-- 14 days only (_caregiver_link_live), which an index predicate cannot express: the invite function checks it under the
-- member's lock instead.
create unique index member_caregivers_active_phone on public.member_caregivers(member_id,phone)where status='active';
create unique index member_caregivers_active_account on public.member_caregivers(member_id,caregiver_user_id)where status='active';
create index member_caregivers_caregiver on public.member_caregivers(caregiver_user_id)where status='active';
create index member_caregivers_pending_phone on public.member_caregivers(phone)where status='pending';
alter table public.member_caregivers enable row level security;
revoke all on public.member_caregivers from public,anon,authenticated,service_role;
grant select on public.member_caregivers to authenticated;
create policy member_caregivers_member on public.member_caregivers for select to authenticated using((select auth.uid())=member_id);
-- A caregiver sees its own link only while it is active: revocation ends that too.
create policy member_caregivers_caregiver on public.member_caregivers for select to authenticated using((select auth.uid())=caregiver_user_id and status='active');
comment on table public.member_caregivers is
 'Caregivers a member authorised, by phone number, with explicit scopes. Written only through member_caregiver_* and caregiver_invitation_* functions; delegated access checks _caregiver_can.';

create table public.member_caregiver_events(
 id bigint generated always as identity primary key,
 link_id uuid not null references public.member_caregivers(id) on delete cascade,
 member_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid,
 actor_kind text not null constraint member_caregiver_events_actor_check check(actor_kind in('member','caregiver','system')),
 kind text not null constraint member_caregiver_events_kind_check check(kind in('invited','scopes_updated','revoked','accepted','declined','members_read','plan_read','readings_read','bp_logged')),
 detail jsonb not null default '{}'::jsonb constraint member_caregiver_events_detail_check check(jsonb_typeof(detail)='object'and octet_length(detail::text)<=2048),
 at timestamptz not null default clock_timestamp()
);
create index member_caregiver_events_member on public.member_caregiver_events(member_id,at desc);
create index member_caregiver_events_link on public.member_caregiver_events(link_id,at desc);
alter table public.member_caregiver_events enable row level security;
revoke all on public.member_caregiver_events from public,anon,authenticated,service_role;
grant select on public.member_caregiver_events to authenticated;
create policy member_caregiver_events_own on public.member_caregiver_events for select to authenticated using((select auth.uid())=member_id);
create trigger member_caregiver_events_append_only before update or delete on public.member_caregiver_events for each row execute function public._member_history_immutable();
comment on table public.member_caregiver_events is 'Append-only trail of every caregiver link change and every caregiver read or write. Ids and codes only.';

-- A caregiver account that is deleted ends its active links: the delete's "set null" on caregiver_user_id revokes the
-- link in the same statement, so account erasure is never blocked by member_caregivers_active_shape. The link's trail
-- records it as a system revocation. It is not the member's decision, so member_consents is left as the member set it.
create function public._member_caregiver_account_gone()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if old.caregiver_user_id is not null and new.caregiver_user_id is null and old.status='active'then
  new.status:='revoked';new.revoked_at:=clock_timestamp();new.revision:=old.revision+1;
  insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind,detail)
   values(old.id,old.member_id,null,'system','revoked',jsonb_build_object('reason','caregiver_account_deleted'));
 end if;
 return new;
end$$;
revoke all on function public._member_caregiver_account_gone()from public,anon,authenticated,service_role;
create trigger member_caregivers_account_gone before update of caregiver_user_id on public.member_caregivers
 for each row execute function public._member_caregiver_account_gone();


-- Scopes in one canonical order, without duplicates; null when a value is outside the vocabulary.
create function public._caregiver_scopes(p_scopes text[])returns text[]
language sql immutable set search_path=''as $$
 select case when p_scopes is null or cardinality(p_scopes)=0 or array_position(p_scopes,null)is not null
  or not p_scopes<@array['view_plan','view_readings','log_readings','confirm_doses','receive_alerts','message_care_team']::text[]then null
  else array(select s from unnest(array['view_plan','view_readings','log_readings','confirm_doses','receive_alerts','message_care_team']::text[])with ordinality v(s,o)where s=any(p_scopes)order by o)end
$$;
revoke all on function public._caregiver_scopes(text[])from public,anon,authenticated,service_role;

-- A link that still counts: active, or pending and invited less than 14 days ago. An older pending invitation has
-- expired: it can no longer be accepted, and it no longer counts toward the limit or blocks inviting the same number.
create function public._caregiver_link_live(l public.member_caregivers)returns boolean
language sql stable set search_path=''as $$
 select l.status='active'or(l.status='pending'and l.invited_at>clock_timestamp()-interval '14 days')
$$;
revoke all on function public._caregiver_link_live(public.member_caregivers)from public,anon,authenticated,service_role;

-- What the member sees about one link. The phone stays the member's own data: shown to the member only. An expired
-- pending invitation reads as status 'expired'.
create function public._caregiver_link_json(l public.member_caregivers)returns jsonb
language sql stable set search_path=''as $$
 select jsonb_build_object('id',l.id,'name',l.display_name,'relationship',l.relationship,'phone',l.phone,'scopes',to_jsonb(l.scopes),
  'status',case when l.status='pending'and not public._caregiver_link_live(l)then 'expired'else l.status end,'revision',l.revision,'invitedAt',l.invited_at,'acceptedAt',l.accepted_at,'revokedAt',l.revoked_at,'declinedAt',l.declined_at,
  'wordingVersion',l.consent_wording_version)
$$;
revoke all on function public._caregiver_link_json(public.member_caregivers)from public,anon,authenticated,service_role;

-- The member's first name as a caregiver sees it; never the surname, phone or anything clinical.
create function public._member_first_name(p_member uuid)returns text
language sql stable security definer set search_path=''as $$
 select nullif(split_part(btrim(coalesce((select display_name from public.profiles where id=p_member),'')),' ',1),'')
$$;
revoke all on function public._member_first_name(uuid)from public,anon,authenticated,service_role;

-- True only for an active link of this member and caregiver that holds the scope, whose caregiver account still signs in
-- with the invited phone number, of a member whose account is still in good standing. The single check every delegated
-- action uses.
create function public._caregiver_can(p_member uuid,p_caregiver uuid,p_scope text)returns boolean
language sql stable security definer set search_path=''as $$
 select p_member is not null and p_caregiver is not null and p_scope is not null and p_member<>p_caregiver
  and not exists(select 1 from public.workspace_staff where user_id=p_caregiver)
  -- The member's account itself must still be a member's: phone confirmed, not banned or locked, not staff. Every
  -- delegated action inherits this.
  and public._auth_phone_e164(p_member)is not null and not exists(select 1 from public.workspace_staff where user_id=p_member)
  and exists(select 1 from public.member_caregivers l where l.member_id=p_member and l.caregiver_user_id=p_caregiver
   and l.status='active'and l.revoked_at is null and p_scope=any(l.scopes)and l.phone=public._auth_phone_e164(p_caregiver))
$$;
revoke all on function public._caregiver_can(uuid,uuid,text)from public,anon,authenticated,service_role;

-- One caregiver read or write: the link's trail and the shared access audit, in the caller's transaction.
create function public._caregiver_audit(p_member uuid,p_caregiver uuid,p_kind text,p_surface text,p_object text default null)returns void
language plpgsql security definer set search_path=''as $$
declare link uuid;
begin
 select id into link from public.member_caregivers where member_id=p_member and caregiver_user_id=p_caregiver and status='active';
 if link is null then raise insufficient_privilege using message='Active caregiver link required';end if;
 insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind,detail)
  values(link,p_member,p_caregiver,'caregiver',p_kind,jsonb_strip_nulls(jsonb_build_object('object',left(p_object,200))));
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(p_caregiver,'caregiver',p_member,p_surface,left(p_object,200),left(auth.jwt()->>'session_id',80));
end$$;
revoke all on function public._caregiver_audit(uuid,uuid,text,text,text)from public,anon,authenticated,service_role;

-- The signed-in caregiver: an authenticated account with a confirmed phone that is not staff. Raises otherwise.
create function public._caregiver_self()returns uuid
language plpgsql stable security definer set search_path=''as $$
declare c uuid:=auth.uid();
begin
 if auth.role()is distinct from 'authenticated'or c is null or public._auth_phone_e164(c)is null
  or exists(select 1 from public.workspace_staff where user_id=c)then raise insufficient_privilege using message='Signed-in phone account required';end if;
 return c;
end$$;
revoke all on function public._caregiver_self()from public,anon,authenticated,service_role;

-- Member side ---------------------------------------------------------------------------------------------------------

-- Invites one caregiver and records the caregiver-sharing consent for the exact text shown. Idempotent on p_request_id:
-- the same request returns the same link; a different request with the same id is a conflict. At most 3 live links
-- (_caregiver_link_live: an expired invitation no longer counts).
create function public.member_caregiver_invite(p_request_id uuid,p_display_name text,p_relationship text,p_phone text,p_scopes text[],p_wording_version text,p_text_hash text,p_method text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=public._member_self();l public.member_caregivers;v_scopes text[]:=public._caregiver_scopes(p_scopes);v_name text:=btrim(p_display_name);v_phone text:=regexp_replace(coalesce(p_phone,''),'[\s()-]','','g');
begin
 if p_request_id is null or v_name is null or length(v_name)not between 1 and 80 or p_relationship is null
  or p_relationship not in('spouse','partner','child','parent','sibling','relative','friend','other')
  or v_phone !~ '^\+[1-9][0-9]{6,14}$' or v_scopes is null
  or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'or coalesce(p_text_hash,'')!~'^[a-f0-9]{64}$'or p_method is null or p_method not in('tap','voice')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-caregivers:'||m::text,0));
 select * into l from public.member_caregivers where member_id=m and request_id=p_request_id;
 if found then
  if l.phone<>v_phone or l.display_name<>v_name or l.relationship<>p_relationship or l.scopes<>v_scopes or l.consent_text_hash<>p_text_hash then
   return jsonb_build_object('ok',false,'code','conflict');end if;
  return jsonb_build_object('ok',true,'replayed',true,'link',public._caregiver_link_json(l));
 end if;
 if v_phone=public._auth_phone_e164(m)then return jsonb_build_object('ok',false,'code','own_phone');end if;
 if exists(select 1 from public.member_caregivers x where x.member_id=m and x.phone=v_phone and public._caregiver_link_live(x))then
  return jsonb_build_object('ok',false,'code','duplicate');end if;
 if(select count(*)from public.member_caregivers x where x.member_id=m and public._caregiver_link_live(x))>=3 then
  return jsonb_build_object('ok',false,'code','limit');end if;
 insert into public.member_caregivers(member_id,request_id,phone,display_name,relationship,scopes,consent_wording_version,consent_text_hash,consent_method)
  values(m,p_request_id,v_phone,v_name,p_relationship,v_scopes,p_wording_version,p_text_hash,p_method)returning * into l;
 insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind,detail)
  values(l.id,m,m,'member','invited',jsonb_build_object('scopes',to_jsonb(v_scopes),'wordingVersion',p_wording_version,'method',p_method));
 perform public._member_consent_record(m,'caregiver_sharing',true,p_wording_version,p_text_hash,p_method,'caregiver_invite');
 return jsonb_build_object('ok',true,'replayed',false,'link',public._caregiver_link_json(l));
end$$;

-- Changes what one caregiver may do. The member confirms the statement for the new scopes, so the link takes that
-- statement's version and hash and member_consents records the caregiver-sharing grant for it, exactly as on invite.
create function public.member_caregiver_update_scopes(p_id uuid,p_revision bigint,p_scopes text[],p_wording_version text,p_text_hash text,p_method text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=public._member_self();l public.member_caregivers;v_scopes text[]:=public._caregiver_scopes(p_scopes);
begin
 if p_id is null or p_revision is null or v_scopes is null
  or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'or coalesce(p_text_hash,'')!~'^[a-f0-9]{64}$'or p_method is null or p_method not in('tap','voice')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-caregivers:'||m::text,0));
 select * into l from public.member_caregivers where id=p_id and member_id=m for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if not public._caregiver_link_live(l)then return jsonb_build_object('ok',false,'code','closed','link',public._caregiver_link_json(l));end if;
 if l.scopes=v_scopes then return jsonb_build_object('ok',true,'changed',false,'link',public._caregiver_link_json(l));end if;
 if l.revision<>p_revision then return jsonb_build_object('ok',false,'code','stale','link',public._caregiver_link_json(l));end if;
 update public.member_caregivers set scopes=v_scopes,consent_wording_version=p_wording_version,consent_text_hash=p_text_hash,consent_method=p_method,revision=revision+1
  where id=l.id returning * into l;
 insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind,detail)
  values(l.id,m,m,'member','scopes_updated',jsonb_build_object('scopes',to_jsonb(v_scopes),'wordingVersion',p_wording_version,'method',p_method));
 perform public._member_consent_record(m,'caregiver_sharing',true,p_wording_version,p_text_hash,p_method,'caregiver_scopes');
 return jsonb_build_object('ok',true,'changed',true,'link',public._caregiver_link_json(l));
end$$;

-- Revoking ends access at once. When no other link remains, the caregiver-sharing consent is recorded as withdrawn.
create function public.member_caregiver_revoke(p_id uuid,p_revision bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=public._member_self();l public.member_caregivers;
begin
 if p_id is null or p_revision is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-caregivers:'||m::text,0));
 select * into l from public.member_caregivers where id=p_id and member_id=m for update;
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 if l.status='revoked'then return jsonb_build_object('ok',true,'changed',false,'link',public._caregiver_link_json(l));end if;
 if l.status='declined'then return jsonb_build_object('ok',false,'code','closed','link',public._caregiver_link_json(l));end if;
 if l.revision<>p_revision then return jsonb_build_object('ok',false,'code','stale','link',public._caregiver_link_json(l));end if;
 update public.member_caregivers set status='revoked',revoked_at=clock_timestamp(),revision=revision+1 where id=l.id returning * into l;
 insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind)values(l.id,m,m,'member','revoked');
 if not exists(select 1 from public.member_caregivers x where x.member_id=m and public._caregiver_link_live(x))then
  perform public._member_consent_record(m,'caregiver_sharing',false,l.consent_wording_version,l.consent_text_hash,'tap','caregiver_revoke');
 end if;
 return jsonb_build_object('ok',true,'changed',true,'link',public._caregiver_link_json(l));
end$$;

-- Live links, and closed or expired ones for 90 days after they ended.
create function public.member_caregivers_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=public._member_self();
begin
 return jsonb_build_object('ok',true,'links',coalesce((select jsonb_agg(public._caregiver_link_json(l)order by l.status in('revoked','declined'),l.invited_at desc,l.id)
  from(select * from public.member_caregivers where member_id=m and(status='active'or status='pending'and invited_at>clock_timestamp()-interval '104 days'
    or coalesce(revoked_at,declined_at)>clock_timestamp()-interval '90 days')
   order by invited_at desc limit 20)l),'[]'::jsonb));
end$$;

-- Caregiver side ------------------------------------------------------------------------------------------------------

-- A pending invitation is for the account that signs in with the invited phone number, for 14 days.
create function public.caregiver_invitations_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();v_phone text:=public._auth_phone_e164(c);
begin
 return jsonb_build_object('ok',true,'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'memberFirstName',public._member_first_name(l.member_id),
   'relationship',l.relationship,'scopes',to_jsonb(l.scopes),'invitedAt',l.invited_at,'wordingVersion',l.consent_wording_version)order by l.invited_at,l.id)
  from public.member_caregivers l where l.phone=v_phone and l.status='pending'and l.member_id<>c and l.invited_at>clock_timestamp()-interval '14 days'),'[]'::jsonb));
end$$;

create function public._caregiver_invitation_answer(p_id uuid,p_accept boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();v_phone text:=public._auth_phone_e164(c);l public.member_caregivers;m uuid;
begin
 if p_id is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- The member's lock first, then the row, in the same order as invite, scope changes and revoke take them.
 select member_id into m from public.member_caregivers where id=p_id;
 if m is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-caregivers:'||m::text,0));
 select * into l from public.member_caregivers where id=p_id for update;
 -- Another number's invitation reads exactly as a missing one.
 if not found or l.phone<>v_phone or l.member_id=c then return jsonb_build_object('ok',false,'code','not_found');end if;
 if l.status='active'and l.caregiver_user_id=c and p_accept then return jsonb_build_object('ok',true,'changed',false,'status','active');end if;
 if l.status='declined'and not p_accept then return jsonb_build_object('ok',true,'changed',false,'status','declined');end if;
 if l.status<>'pending'then return jsonb_build_object('ok',false,'code','closed');end if;
 if l.invited_at<=clock_timestamp()-interval '14 days'then return jsonb_build_object('ok',false,'code','expired');end if;
 if p_accept then
  if exists(select 1 from public.member_caregivers where member_id=l.member_id and caregiver_user_id=c and status='active')then
   return jsonb_build_object('ok',false,'code','duplicate');end if;
  update public.member_caregivers set status='active',caregiver_user_id=c,accepted_at=clock_timestamp(),revision=revision+1 where id=l.id returning * into l;
 else
  update public.member_caregivers set status='declined',declined_at=clock_timestamp(),revision=revision+1 where id=l.id returning * into l;
 end if;
 insert into public.member_caregiver_events(link_id,member_id,actor_id,actor_kind,kind)values(l.id,l.member_id,c,'caregiver',case when p_accept then 'accepted'else 'declined'end);
 return jsonb_build_object('ok',true,'changed',true,'status',l.status);
end$$;
revoke all on function public._caregiver_invitation_answer(uuid,boolean)from public,anon,authenticated,service_role;
create function public.caregiver_invitation_accept(p_id uuid)returns jsonb
language sql security definer set search_path=''as $$select public._caregiver_invitation_answer(p_id,true)$$;
create function public.caregiver_invitation_decline(p_id uuid)returns jsonb
language sql security definer set search_path=''as $$select public._caregiver_invitation_answer(p_id,false)$$;

-- The members this account cares for: first name and scopes only. Recorded per member.
create function public.caregiver_members_read()returns jsonb
language plpgsql security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();v_phone text:=public._auth_phone_e164(c);result jsonb;l public.member_caregivers;
begin
 select coalesce(jsonb_agg(jsonb_build_object('linkId',x.id,'memberId',x.member_id,'firstName',public._member_first_name(x.member_id),
   'relationship',x.relationship,'scopes',to_jsonb(x.scopes),'since',x.accepted_at)order by x.accepted_at,x.id),'[]'::jsonb)into result
  from public.member_caregivers x where x.caregiver_user_id=c and x.status='active'and x.phone=v_phone;
 for l in select * from public.member_caregivers where caregiver_user_id=c and status='active'and phone=v_phone loop
  perform public._caregiver_audit(l.member_id,c,'members_read','caregiver_members',l.id::text);
 end loop;
 return jsonb_build_object('ok',true,'members',result);
end$$;

-- Delegated actions ---------------------------------------------------------------------------------------------------

-- The member's own typed-reading internals, so the caregiver's reading is stored, checked, alerted on and verified by a
-- nurse when high exactly like one the member typed, with its provenance: entry_source 'caregiver_reported'.
select pg_temp.widen_in_check('public.patient_measurements','patient_measurements_entry_source_check','entry_source',array['caregiver_reported']);
insert into function_patches(fn,old,new)values('public._record_patient_measurement_sourced(uuid,uuid,integer,integer,integer,timestamptz,text)'::regprocedure,
 'p_entry_source not in(''patient_text_entry'',''patient_photo_confirmed'')',
 'p_entry_source not in(''patient_text_entry'',''patient_photo_confirmed'',''caregiver_reported'')');
-- A caregiver is not a clinician: their reading is a home reading for the BP check, not a staff-measured one.
insert into function_patches(fn,old,new)values('public._bp_check_saved()'::regprocedure,
 'staff boolean:=auth.uid()is not null and auth.uid()<>new.user_id;',
 'staff boolean:=auth.uid()is not null and auth.uid()<>new.user_id and new.entry_source is distinct from ''caregiver_reported'';');
-- A caregiver's typed reading is an unverified observation, exactly like the member's own typed one
-- (20261104173300_zoe_unverified_bp): kept as raw evidence and for safety, never counted as measured BP evidence.
insert into function_patches(fn,old,new)
select fn::regprocedure,frag,replace(frag,alias||'entry_source is distinct from ''patient_text_entry''',
  alias||'entry_source is distinct from ''patient_text_entry'' and '||alias||'entry_source is distinct from ''caregiver_reported''')
from(values
 ('public.pilot_gm_overview(date,date)','count(*)from public.patient_measurements where entry_source is distinct from ''patient_text_entry''',''),
 ('public.pilot_gm_overview(date,date)','select user_id from public.patient_measurements where entry_source is distinct from ''patient_text_entry''',''),
 ('public._gp_report_source_body(uuid)','m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_member','m.'),
 ('public.doctor_programme_member(uuid)','x.entry_source is distinct from ''patient_text_entry'' and x.user_id=p_user_id','x.'),
 ('public.doctor_programme_member(uuid)','m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_user_id','m.'),
 ('public.zoe_run_health_context(uuid[])','l.entry_source is distinct from ''patient_text_entry'' and l.user_id=r.member_id','l.'),
 ('public.zoe_run_health_context(uuid[])','pm.entry_source is distinct from ''patient_text_entry'' and pm.user_id=r.member_id','pm.'),
 ('public._required_evidence_sources(uuid,text)','m.entry_source is distinct from ''patient_text_entry'' and b.week_id=w.id','m.'),
 ('public._required_evidence_sources(uuid,text)','m.entry_source is distinct from ''patient_text_entry'' and m.user_id=p_user','m.'),
 ('public._bp_weekly_trend(uuid,timestamptz)','where entry_source is distinct from ''patient_text_entry'' and user_id=p_member','')
)v(fn,frag,alias);
-- The safety net of a typed reading: a high caregiver-reported reading raises the same nurse verification task
-- ('bp_member_reported_high', verify_bp) as a high member-typed one, labelled with who reported it.
insert into function_patches(fn,old,new)values
 ('public._typed_bp_task(public.patient_measurements)'::regprocedure,
  'if m.entry_source is distinct from ''patient_text_entry'' or m.systolic<180 then return;end if;',
  'if m.entry_source is null or m.entry_source not in(''patient_text_entry'',''caregiver_reported'') or m.systolic<180 then return;end if;'),
 ('public._typed_bp_task(public.patient_measurements)'::regprocedure,
  '''Check reported BP ''||m.systolic||''/''||m.diastolic||'' mmHg. Member-reported, not verified''',
  '''Check reported BP ''||m.systolic||''/''||m.diastolic||'' mmHg. ''||case when m.entry_source=''caregiver_reported''then ''Caregiver-reported''else ''Member-reported''end||'', not verified''');
alter table public.care_queue_tasks drop constraint care_queue_zone_or_verification,drop constraint care_queue_sla_or_verification;
alter table public.care_queue_tasks add constraint care_queue_zone_or_verification check(
 ((queue='admin')=(zone is null))or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource' in('patient_text_entry','caregiver_reported'),false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));
alter table public.care_queue_tasks add constraint care_queue_sla_or_verification check(
 queue='admin'or sla_deadline is not null or(queue='nurse'and zone is null and reason_code='bp_member_reported_high'
  and coalesce(summary->>'entrySource' in('patient_text_entry','caregiver_reported'),false)and source_ref ~ '^typed-bp:[a-f0-9-]{36}$'));

create function public.caregiver_bp_log(p_member uuid,p_request_id uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();saved uuid;existed boolean;failure text;
begin
 if not public._caregiver_can(p_member,c,'log_readings')then raise insufficient_privilege using message='Caregiver scope required';end if;
 if p_request_id is null or p_systolic is null or p_diastolic is null or p_measured_at is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 existed:=exists(select 1 from public.patient_measurements where user_id=p_member and submission_id=p_request_id);
 begin
  saved:=public._record_patient_measurement_sourced(p_member,p_request_id,p_systolic,p_diastolic,p_pulse,p_measured_at,'caregiver_reported');
 exception
  when check_violation then return jsonb_build_object('ok',false,'code','invalid');
  when raise_exception then
   -- The recorder's fixed messages, mapped to codes; the text itself is never returned.
   get stacked diagnostics failure=message_text;
   return jsonb_build_object('ok',false,'code',case when failure='measurement conflict'then 'conflict'when failure='verified membership required'then 'not_eligible'else 'invalid'end);
 end;
 if existed and not exists(select 1 from public.patient_measurements where id=saved and entry_source='caregiver_reported')then
  return jsonb_build_object('ok',false,'code','conflict');end if;
 -- A replay of the same request is not a second write.
 if not existed then perform public._caregiver_audit(p_member,c,'bp_logged','caregiver_bp_log',saved::text);end if;
 return jsonb_build_object('ok',true,'replayed',existed,'measurementId',saved);
end$$;

-- The published plan, read exactly as the member's own Telegram plan card reads it: member_plan_read_for's body moves
-- into _member_plan_read unchanged, and member_plan_read_for keeps its service-role and eligibility checks around it.
create function public._member_plan_read(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare p public.patient_care_plans;
begin
 select * into p from public.patient_care_plans where user_id=p_member and active and published_at<=clock_timestamp();
 if p.id is null then return jsonb_build_object('plan',null);end if;
 return jsonb_build_object('plan',jsonb_build_object('id',p.id,'clinician',p.clinician,'publishedAt',p.published_at,'instructions',p.instructions,
   'version',case when public._doctor_completion_enabled()then(select v.version from public.patient_care_plan_versions v where v.plan_id=p.id and v.user_id=p_member order by v.version desc limit 1)end,
   'medicines',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'dose',m.dose,'times',(select coalesce(jsonb_agg(to_char(t,'HH24:MI')order by t),'[]'::jsonb)from unnest(m.times)t))order by m.name,m.id)
    from public.patient_care_medications m where m.user_id=p_member and m.active
     -- In force today, Yerevan time, as the app's plan card and the dose list read it (#417, test gap 6): the card shows no
     -- dates, so an ended course would read as current.
     and(m.end_date is null or m.end_date>=(clock_timestamp()at time zone 'Asia/Yerevan')::date)
     and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
     -- As own_published_care_medications: the plan the medicine came from must be published too (Astra R3).
     and exists(select 1 from public.patient_care_plans o where o.id=m.plan_id and o.user_id=p_member and o.published_at<=clock_timestamp())),'[]'::jsonb),
   'review',(select case when r is not null then jsonb_build_object('planId',r->>'planId','instructions',coalesce(r#>>'{draft,instructions}',''))end from public._patient_current_published_clinical_review(p_member)r)));
end$$;
revoke all on function public._member_plan_read(uuid)from public,anon,authenticated,service_role;
create or replace function public.member_plan_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 return public._member_plan_read(p_member);
end$$;

create function public.caregiver_plan_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();r jsonb;
begin
 if not public._caregiver_can(p_member,c,'view_plan')then raise insufficient_privilege using message='Caregiver scope required';end if;
 r:=public._member_plan_read(p_member);
 perform public._caregiver_audit(p_member,c,'plan_read','caregiver_plan',r#>>'{plan,id}');
 return jsonb_build_object('ok',true)||r;
end$$;

-- Home readings of the last 30 days, newest first, at most 60. Values and provenance only.
create function public.caregiver_readings_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c uuid:=public._caregiver_self();rows jsonb;
begin
 if not public._caregiver_can(p_member,c,'view_readings')then raise insufficient_privilege using message='Caregiver scope required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',m.measured_at,'entrySource',m.entry_source)
  order by m.measured_at desc,m.id),'[]'::jsonb)into rows
  from(select * from public.patient_measurements where user_id=p_member and measured_at>clock_timestamp()-interval '30 days'order by measured_at desc,id limit 60)m;
 perform public._caregiver_audit(p_member,c,'readings_read','caregiver_readings',null);
 return jsonb_build_object('ok',true,'readings',rows);
end$$;

revoke all on function public.member_caregiver_invite(uuid,text,text,text,text[],text,text,text),public.member_caregiver_update_scopes(uuid,bigint,text[],text,text,text),
 public.member_caregiver_revoke(uuid,bigint),public.member_caregivers_read(),public.caregiver_invitations_read(),public.caregiver_invitation_accept(uuid),
 public.caregiver_invitation_decline(uuid),public.caregiver_members_read(),public.caregiver_bp_log(uuid,uuid,integer,integer,integer,timestamptz),
 public.caregiver_plan_read(uuid),public.caregiver_readings_read(uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_caregiver_invite(uuid,text,text,text,text[],text,text,text),public.member_caregiver_update_scopes(uuid,bigint,text[],text,text,text),
 public.member_caregiver_revoke(uuid,bigint),public.member_caregivers_read(),public.caregiver_invitations_read(),public.caregiver_invitation_accept(uuid),
 public.caregiver_invitation_decline(uuid),public.caregiver_members_read(),public.caregiver_bp_log(uuid,uuid,integer,integer,integer,timestamptz),
 public.caregiver_plan_read(uuid),public.caregiver_readings_read(uuid)to authenticated;

-- 3. Unified audit read -----------------------------------------------------------------------------------------------
-- Consent decisions and caregiver link changes join the audit sources. Caregiver reads are already there through
-- access_audit (actor_role 'caregiver'), so only the link changes and delegated writes are added here.
do $migration$
declare def text:=pg_get_functiondef('public._audit_source_rows(timestamptz,timestamptz,uuid,uuid,text)'::regprocedure);patched text;
begin
 patched:=regexp_replace(def,'\s*\$function\$\s*$',$add$
 union all
 select c.recorded_at,'member_consent:'||c.id,'permission_change','member_consent',c.kind||':'||case when c.granted then 'granted'else 'withdrawn'end,c.member_id,c.member_id,null
  from public.member_consents c where c.recorded_at>=p_from and c.recorded_at<=p_to
   and(p_category is null or p_category='permission_change')and(p_actor is null or c.member_id=p_actor)
   and(p_member is null or c.member_id=p_member)
 union all
 select e.at,'caregiver:'||e.id,case when e.kind='bp_logged'then 'care_change'else 'permission_change'end,'caregiver',e.kind,e.actor_id,e.member_id,e.link_id::text
  from public.member_caregiver_events e where e.at>=p_from and e.at<=p_to and e.kind in('invited','scopes_updated','revoked','accepted','declined','bp_logged')
   and(p_category is null or p_category=case when e.kind='bp_logged'then 'care_change'else 'permission_change'end)and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or e.member_id=p_member)
$function$
$add$);
 if patched=def then raise exception 'Unexpected _audit_source_rows definition';end if;
 execute patched;
end $migration$;

-- 4. Chat cards -------------------------------------------------------------------------------------------------------
select pg_temp.widen_in_check('public.zoe_chat_cards','zoe_chat_cards_kind_check','kind',array['caregiver','consents']);

-- Apply the queued function patches, in order.
do $patch$
declare r record;def text;
begin
 for r in select * from function_patches order by n loop
  def:=pg_get_functiondef(r.fn);
  if position(r.old in def)=0 or cardinality(string_to_array(def,r.old))<>2 then raise exception 'Unexpected definition of %',r.fn;end if;
  execute replace(def,r.old,r.new);
 end loop;
end $patch$;
drop table pg_temp.function_patches;
