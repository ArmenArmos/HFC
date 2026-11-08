-- Short lessons (Armen's coaching item 6, 20 Oct 2026).
--
-- The lessons themselves are versioned content in the app (lib/lessons/content.ts), each with a
-- draft, approved or rejected status from Armen's review; the database never holds lesson text.
-- Here: which lessons a member marked done, and Zoe's lesson offers, at most one per member per
-- Yerevan day (the primary key enforces it, so two tabs cannot both claim a day).
-- A member reads and writes only their own rows, through these functions; no direct table access.
-- The database never sees lesson statuses (they ship with the app), so draft or approved is a
-- display gate the app enforces on every read and write path (lib/lessons/catalogue.ts): an id a
-- member records here directly only marks their own progress, is never shown unless the app shows
-- that lesson, and reveals no content. What a direct caller can write is bounded: well-formed ids
-- only, at most 200 done rows per member, one offer per day.

create table public.member_lesson_done(
 user_id uuid not null references auth.users(id)on delete cascade,
 lesson_id text not null check(lesson_id~'^[a-z0-9]+(-[a-z0-9]+){0,7}$'),
 done_at timestamptz not null default clock_timestamp(),
 primary key(user_id,lesson_id)
);

create table public.member_lesson_offers(
 user_id uuid not null references auth.users(id)on delete cascade,
 offered_on date not null,
 lesson_id text not null check(lesson_id~'^[a-z0-9]+(-[a-z0-9]+){0,7}$'),
 offered_at timestamptz not null default clock_timestamp(),
 dismissed_at timestamptz,
 primary key(user_id,offered_on)
);
create index member_lesson_offers_lesson on public.member_lesson_offers(user_id,lesson_id);

alter table public.member_lesson_done enable row level security;
alter table public.member_lesson_offers enable row level security;
revoke all on public.member_lesson_done,public.member_lesson_offers from public,anon,authenticated,service_role;

create function public._member_lesson_today()returns date language sql stable set search_path=''as $$
 select(clock_timestamp()at time zone 'Asia/Yerevan')::date
$$;

-- A signed-in member (not a staff account). Raises otherwise.
create function public._member_lesson_member()returns uuid
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 return uid;
end$$;

-- The member's done lessons and their offers of the last 90 days.
create function public.member_lessons_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=public._member_lesson_member();
begin
 return jsonb_build_object('version','member-lessons-v1','today',public._member_lesson_today(),
  'done',coalesce((select jsonb_agg(jsonb_build_object('lessonId',d.lesson_id,'doneAt',d.done_at)order by d.done_at)
   from public.member_lesson_done d where d.user_id=uid),'[]'::jsonb),
  'offers',coalesce((select jsonb_agg(jsonb_build_object('lessonId',o.lesson_id,'day',o.offered_on,'dismissedAt',o.dismissed_at)order by o.offered_on desc)
   from public.member_lesson_offers o where o.user_id=uid and o.offered_on>public._member_lesson_today()-90),'[]'::jsonb));
end$$;

-- Mark a lesson done (p_done true) or not done. {status:'saved'|'invalid'|'limit'}.
create function public.member_lesson_done_set(p_lesson text,p_done boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_lesson_member();
begin
 if p_lesson is null or p_lesson!~'^[a-z0-9]+(-[a-z0-9]+){0,7}$'or p_done is null then return jsonb_build_object('status','invalid');end if;
 if p_done then
  perform pg_advisory_xact_lock(hashtextextended('member-lessons:'||uid::text,0));
  if(select count(*)from public.member_lesson_done where user_id=uid)>=200
   and not exists(select 1 from public.member_lesson_done where user_id=uid and lesson_id=p_lesson)then return jsonb_build_object('status','limit');end if;
  insert into public.member_lesson_done(user_id,lesson_id)values(uid,p_lesson)on conflict(user_id,lesson_id)do nothing;
 else
  delete from public.member_lesson_done where user_id=uid and lesson_id=p_lesson;
 end if;
 return jsonb_build_object('status','saved');
end$$;

-- Claim today's one offer for a lesson. When today already has an offer, that one stands and is
-- returned instead: {status:'offered'|'already',lessonId,dismissed} | {status:'invalid'}.
create function public.member_lesson_offer(p_lesson text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_lesson_member();o public.member_lesson_offers;today date:=public._member_lesson_today();
begin
 if p_lesson is null or p_lesson!~'^[a-z0-9]+(-[a-z0-9]+){0,7}$'then return jsonb_build_object('status','invalid');end if;
 insert into public.member_lesson_offers(user_id,offered_on,lesson_id)values(uid,today,p_lesson)
  on conflict(user_id,offered_on)do nothing returning * into o;
 if found then return jsonb_build_object('status','offered','lessonId',o.lesson_id,'dismissed',false);end if;
 select * into o from public.member_lesson_offers where user_id=uid and offered_on=today;
 return jsonb_build_object('status','already','lessonId',o.lesson_id,'dismissed',o.dismissed_at is not null);
end$$;

-- "Not now" on today's offer. {status:'dismissed'|'none'}.
create function public.member_lesson_offer_dismiss()returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_lesson_member();
begin
 update public.member_lesson_offers set dismissed_at=coalesce(dismissed_at,clock_timestamp())
  where user_id=uid and offered_on=public._member_lesson_today();
 return jsonb_build_object('status',case when found then 'dismissed'else 'none'end);
end$$;

revoke all on function public._member_lesson_today(),public._member_lesson_member(),public.member_lessons_read(),
 public.member_lesson_done_set(text,boolean),public.member_lesson_offer(text),public.member_lesson_offer_dismiss()from public,anon,authenticated,service_role;
grant execute on function public.member_lessons_read(),public.member_lesson_done_set(text,boolean),public.member_lesson_offer(text),
 public.member_lesson_offer_dismiss()to authenticated;
