-- Member safety holds (decision tree v1.1, 18 Oct 2026). Dark until member_safety_settings has
-- a row with enabled=true. Wording is an unapproved placeholder (Armen/Tatevik); clinical
-- meaning belongs to the clinical owners, this file only records and enforces it.
--
-- * chest_pain_card (DT P341-P342): a questionnaire answer of chest pain on exertion or stress
--   (q9.present yes or unsure) that is not present right now (q9.right_now no, so the 103
--   screen did not open) shows a safety card on Home for 30 days. The member can hide it for
--   the current Yerevan day only. It ends when the 30 days pass or a doctor clears it.
-- * exercise_pause (DT P369-P374, P371, P389): fainting during exertion (RF-08) or at rest with
--   no warning signs (RF-09, "same path") pauses every exercise reminder and suggestion until a
--   doctor clears it. The member cannot hide it.
--
-- A hold opens when a save makes its condition true (the trigger below, so no save path can
-- skip it) and the switch is on. Switched off, nothing is recorded, the member status says
-- disabled and staff decisions are refused. member_safety_backfill() opens holds for answers
-- saved before the switch went on (run once from the staging SQL).
-- Who decides: the assigned doctor, or an active administrator (break-glass, a note is
-- required). Every open, hide, keep and clear is in member_safety_audit, append-only.

-- 1. Tables -------------------------------------------------------------------------------

create table public.member_safety_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);

create table public.member_safety_holds (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('chest_pain_card','exercise_pause')),
 -- The answer that opened it, e.g. q10.syncope = exertion.
 source_field text not null check(source_field in('q9.present','q10.syncope')),
 source_value text not null check(source_value in('yes','unsure','exertion','rest')),
 assessment_id uuid,assessment_revision bigint,
 started_at timestamptz not null default clock_timestamp(),
 -- chest_pain_card ends by itself, at the end of the 30th Yerevan day after the answer (the
 -- date the card shows); exercise_pause only when cleared.
 expires_at timestamptz,
 -- The Yerevan day the member chose "hide for today" (chest_pain_card only).
 hidden_on date,
 reviewed_at timestamptz,reviewed_by uuid,
 -- Staff are deactivated, not deleted, so no foreign keys on the actors.
 cleared_at timestamptz,cleared_by uuid,cleared_by_role text check(cleared_by_role in('doctor','admin')),
 clear_note text check(char_length(clear_note)<=500),
 check((kind='chest_pain_card')=(expires_at is not null)),
 check(kind='chest_pain_card'or hidden_on is null),
 check((kind='chest_pain_card'and source_field='q9.present'and source_value in('yes','unsure'))
  or(kind='exercise_pause'and source_field='q10.syncope'and source_value in('exertion','rest'))),
 check((cleared_at is null)=(cleared_by is null)and(cleared_at is null)=(cleared_by_role is null)),
 check(cleared_by_role is distinct from 'admin'or nullif(btrim(clear_note),'')is not null)
);
create index member_safety_holds_member on public.member_safety_holds(member_id,kind,started_at desc);

create table public.member_safety_audit (
 id bigint generated always as identity primary key,
 -- No foreign key on the hold, so the record outlives a hold row deleted by hand (Fable F6).
 -- Account deletion still removes it, through member_id.
 hold_id uuid not null,
 member_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid,
 actor_role text not null check(actor_role in('system','member','doctor','admin')),
 action text not null check(action in('opened','backfilled','hidden_today','kept','cleared')),
 note text check(char_length(note)<=500),
 created_at timestamptz not null default clock_timestamp()
);
create index member_safety_audit_hold on public.member_safety_audit(hold_id,created_at);
-- Append-only, except when the member's account is deleted (the cascade from auth.users).
create function public._member_safety_audit_immutable()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'and pg_trigger_depth()>1 then return old;end if;
 raise exception using errcode='55000',message='Member safety audit is append-only';end$$;
create trigger member_safety_audit_append_only before update or delete on public.member_safety_audit
 for each row execute function public._member_safety_audit_immutable();

alter table public.member_safety_settings enable row level security;
alter table public.member_safety_holds enable row level security;
alter table public.member_safety_audit enable row level security;
-- No direct access for anyone: every read and write goes through the functions below.
revoke all on public.member_safety_settings,public.member_safety_holds,public.member_safety_audit
 from public,anon,authenticated,service_role;

-- 2. Conditions and opening -----------------------------------------------------------------

create function public._member_safety_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.member_safety_settings where singleton),false)
$$;

-- The answer that opens each hold, or null. Mirrors NRN-RULE-CP-002/RF-07 (chest pain not
-- present now) and RF-08/RF-09 in lib/clinical/rules/rules.ts.
create function public._member_safety_chest_value(a jsonb)returns text language sql immutable set search_path=''as $$
 select case when a->'q9.present'->>'value' in('yes','unsure')and a->'q9.right_now'->>'value'='no'
  then a->'q9.present'->>'value' end
$$;
create function public._member_safety_syncope_value(a jsonb)returns text language sql immutable set search_path=''as $$
 select case when a->'q10.syncope'->>'value' in('exertion','rest')then a->'q10.syncope'->>'value' end
$$;

-- Active: not cleared, and for the card not past its 30 days.
create function public._member_safety_active(m uuid,k text)returns public.member_safety_holds
language sql stable security definer set search_path=''as $$
 select * from public.member_safety_holds h where h.member_id=m and h.kind=k and h.cleared_at is null
  and(h.expires_at is null or h.expires_at>clock_timestamp())
 order by h.started_at desc limit 1
$$;

-- DT P342: the card covers the answer's Yerevan day and the 30 days after it, ending at Yerevan
-- midnight so it never disappears partway through the date it shows (Fable F5).
create function public._member_safety_card_end(started timestamptz)returns timestamptz language sql immutable set search_path=''as $$
 select ((timezone('Asia/Yerevan',started))::date+31)::timestamp at time zone 'Asia/Yerevan'
$$;

create function public._member_safety_open(m uuid,k text,f text,v text,aid uuid,rev bigint,started timestamptz,act text)
returns uuid language plpgsql security definer set search_path=''as $$
declare hid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('member-safety:'||m::text||':'||k,0));
 if(public._member_safety_active(m,k)).id is not null then return null;end if;
 if k='chest_pain_card'and public._member_safety_card_end(started)<=clock_timestamp()then return null;end if;
 insert into public.member_safety_holds(member_id,kind,source_field,source_value,assessment_id,assessment_revision,started_at,expires_at)
 values(m,k,f,v,aid,rev,started,case when k='chest_pain_card'then public._member_safety_card_end(started)end)returning id into hid;
 insert into public.member_safety_audit(hold_id,member_id,actor_role,action,note)
 values(hid,m,'system',act,f||'='||v);
 return hid;
end$$;

-- Opens a hold when a save makes its condition true. A changed answer never closes a hold:
-- only a doctor (or the 30 days, for the card) does.
create function public._member_safety_from_assessment()returns trigger
language plpgsql security definer set search_path=''as $$
declare c text;s text;
begin
 if not public._member_safety_enabled()then return null;end if;
 c:=public._member_safety_chest_value(new.answers);
 s:=public._member_safety_syncope_value(new.answers);
 if c is not null and(tg_op='INSERT'or public._member_safety_chest_value(old.answers)is null)then
  perform public._member_safety_open(new.user_id,'chest_pain_card','q9.present',c,new.id,new.revision,clock_timestamp(),'opened');
 end if;
 if s is not null and(tg_op='INSERT'or public._member_safety_syncope_value(old.answers)is distinct from s)then
  perform public._member_safety_open(new.user_id,'exercise_pause','q10.syncope',s,new.id,new.revision,clock_timestamp(),'opened');
 end if;
 return null;
exception when others then
 -- Never block a questionnaire save. The doctor still sees RF-07/RF-08/RF-09 in the review.
 raise warning 'member safety hold not recorded (%)',sqlstate;
 return null;
end$$;
create trigger member_safety_from_assessment after insert or update of answers on public.patient_assessments
 for each row execute function public._member_safety_from_assessment();

-- For answers saved before the switch went on. Runs as the database owner (staging SQL).
create function public.member_safety_backfill()returns integer language plpgsql security definer set search_path=''as $$
declare a record;n integer:=0;
begin
 if not public._member_safety_enabled()then raise exception using errcode='55000',message='Member safety is switched off';end if;
 for a in select * from public.patient_assessments loop
  if public._member_safety_chest_value(a.answers)is not null
   and not exists(select 1 from public.member_safety_holds h where h.member_id=a.user_id and h.kind='chest_pain_card')
   and public._member_safety_open(a.user_id,'chest_pain_card','q9.present',public._member_safety_chest_value(a.answers),a.id,a.revision,coalesce(a.completed_at,a.updated_at),'backfilled')is not null then n:=n+1;end if;
  if public._member_safety_syncope_value(a.answers)is not null
   and not exists(select 1 from public.member_safety_holds h where h.member_id=a.user_id and h.kind='exercise_pause')
   and public._member_safety_open(a.user_id,'exercise_pause','q10.syncope',public._member_safety_syncope_value(a.answers),a.id,a.revision,coalesce(a.completed_at,a.updated_at),'backfilled')is not null then n:=n+1;end if;
 end loop;
 return n;
end$$;

-- 3. Member functions ----------------------------------------------------------------------

create function public.member_safety_status()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();c public.member_safety_holds;e public.member_safety_holds;
begin
 if auth.role()is distinct from 'authenticated'or uid is null then raise insufficient_privilege using message='Sign in required';end if;
 if not public._member_safety_enabled()then
  return jsonb_build_object('enabled',false,'chestPainCard',null,'exercisePaused',false);end if;
 c:=public._member_safety_active(uid,'chest_pain_card');
 e:=public._member_safety_active(uid,'exercise_pause');
 return jsonb_build_object('enabled',true,
  'chestPainCard',case when c.id is null then null else jsonb_build_object('id',c.id,'startedAt',c.started_at,'expiresAt',c.expires_at,
   'hiddenToday',c.hidden_on is not distinct from timezone('Asia/Yerevan',clock_timestamp())::date)end,
  'exercisePaused',e.id is not null);
end$$;

create function public.member_safety_hide_today(p_hold uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();h public.member_safety_holds;today date:=timezone('Asia/Yerevan',clock_timestamp())::date;
begin
 if auth.role()is distinct from 'authenticated'or uid is null then raise insufficient_privilege using message='Sign in required';end if;
 if not public._member_safety_enabled()then return jsonb_build_object('ok',false,'code','unavailable');end if;
 h:=public._member_safety_active(uid,'chest_pain_card');
 if h.id is null or h.id is distinct from p_hold then return jsonb_build_object('ok',false,'code','not_open');end if;
 if h.hidden_on is not distinct from today then return jsonb_build_object('ok',true,'result','already_hidden');end if;
 update public.member_safety_holds set hidden_on=today where id=h.id;
 insert into public.member_safety_audit(hold_id,member_id,actor_id,actor_role,action)values(h.id,uid,uid,'member','hidden_today');
 return jsonb_build_object('ok',true,'result','hidden');
end$$;

-- 4. Staff functions -----------------------------------------------------------------------

-- 'doctor' for the member's assigned doctor, 'admin' for an active administrator, both on a
-- current managed session; otherwise refused. Nurses and other doctors are refused.
create function public._member_safety_staff(p_member uuid)returns text language plpgsql stable security definer set search_path=''as $$
declare r text;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null
  or not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id'and user_id=auth.uid()and(not_after is null or not_after>now()))
 then raise insufficient_privilege using message='Current staff session required';end if;
 r:=public.real_clinical_staff_identity()->>'role';
 if r='admin'then return 'admin';end if;
 if r='doctor'and public.staff_care_access(p_member,auth.uid(),true)then return 'doctor';end if;
 raise insufficient_privilege using message='Assigned doctor or administrator required';
end$$;

create function public.staff_member_safety(p_member uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r text:=public._member_safety_staff(p_member);
begin
 if not public._member_safety_enabled()then return jsonb_build_object('enabled',false,'role',r,'holds','[]'::jsonb);end if;
 return jsonb_build_object('enabled',true,'role',r,'holds',coalesce((select jsonb_agg(jsonb_build_object(
   'id',h.id,'kind',h.kind,'sourceField',h.source_field,'sourceValue',h.source_value,'startedAt',h.started_at,'expiresAt',h.expires_at,
   'active',h.cleared_at is null and(h.expires_at is null or h.expires_at>clock_timestamp()),
   'reviewedAt',h.reviewed_at,'clearedAt',h.cleared_at,'clearedByRole',h.cleared_by_role,'clearNote',h.clear_note,
   'audit',(select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'actorRole',a.actor_role,'actorName',s.display_name,'note',a.note,'at',a.created_at)order by a.created_at,a.id),'[]')
     from public.member_safety_audit a left join public.workspace_staff s on s.user_id=a.actor_id and a.actor_role in('doctor','admin')where a.hold_id=h.id))
  order by h.started_at desc,h.id)from public.member_safety_holds h where h.member_id=p_member),'[]'::jsonb));
end$$;

-- clear: ends the hold. keep: records that the doctor reviewed it and it stays.
create function public.staff_member_safety_decide(p_hold uuid,p_action text,p_note text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare h public.member_safety_holds;r text;note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
 if p_action is null or p_action not in('clear','keep')then raise check_violation using message='Choose clear or keep';end if;
 if char_length(note)>500 then raise check_violation using message='Note is too long';end if;
 select * into h from public.member_safety_holds where id=p_hold;
 if not found then raise insufficient_privilege using message='Assigned doctor or administrator required';end if;
 r:=public._member_safety_staff(h.member_id);
 if not public._member_safety_enabled()then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if r='admin'and p_action='clear'and note is null then raise check_violation using message='An administrator must give a reason';end if;
 perform pg_advisory_xact_lock(hashtextextended('member-safety:'||h.member_id::text||':'||h.kind,0));
 select * into h from public.member_safety_holds where id=p_hold;
 if h.cleared_at is not null or(h.expires_at is not null and h.expires_at<=clock_timestamp())then
  return jsonb_build_object('ok',false,'code','not_open');end if;
 if p_action='clear'then
  update public.member_safety_holds set cleared_at=clock_timestamp(),cleared_by=auth.uid(),cleared_by_role=r,clear_note=note where id=h.id;
 else
  update public.member_safety_holds set reviewed_at=clock_timestamp(),reviewed_by=auth.uid()where id=h.id;
 end if;
 insert into public.member_safety_audit(hold_id,member_id,actor_id,actor_role,action,note)
 values(h.id,h.member_id,auth.uid(),r,case when p_action='clear'then 'cleared'else 'kept'end,note);
 return jsonb_build_object('ok',true,'result',case when p_action='clear'then 'cleared'else 'kept'end);
end$$;

-- 5. Grants --------------------------------------------------------------------------------

revoke all on function public._member_safety_audit_immutable(),public._member_safety_enabled(),public._member_safety_card_end(timestamptz),public._member_safety_chest_value(jsonb),
 public._member_safety_syncope_value(jsonb),public._member_safety_active(uuid,text),
 public._member_safety_open(uuid,text,text,text,uuid,bigint,timestamptz,text),public._member_safety_from_assessment(),
 public.member_safety_backfill(),public.member_safety_status(),public.member_safety_hide_today(uuid),public._member_safety_staff(uuid),
 public.staff_member_safety(uuid),public.staff_member_safety_decide(uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.member_safety_status(),public.member_safety_hide_today(uuid),public.staff_member_safety(uuid),
 public.staff_member_safety_decide(uuid,text,text)to authenticated;
