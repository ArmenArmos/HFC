-- The one blood pressure check (Armen's 2 Nov list, tasks 4 and 5), the part that sends to the doctor. The rule is
-- lib/clinical/rules/bp-check.ts; a trigger cannot call it, so _bp_check_level repeats its cuts and scripts/check-bp-one-rule.ts
-- fails if they drift. Every save route lands in patient_measurements, so no caller can forget, and a nurse's visit mark counts
-- as soon as it is made, before the visit is completed. STAGING until Armen and Yesayi sign off.
--
-- 180/110 or more: a member's first reading raises no alert (the member is asked to rest and repeat). A repeat after 5 minutes and
-- within 120 raises one, and so does any reading entered by staff. Readings older than 24 hours are history and stay quiet. Alerts
-- are still behind care_alert_settings.enabled. A failure is journaled and never undoes the save.
--
-- So a reading cannot vanish if nobody repeats it: a member's first reading at 180 or more, or 120 or more, leaves a quiet note in the
-- doctor's low-priority lane at once, with no alert and no 103. Any repeat closes it, the alert taking its place if the repeat is high.

alter table public.care_alerts drop constraint care_alerts_source_check;
alter table public.care_alerts add constraint care_alerts_source_check check(source in('questionnaire','message','lab','zoe','reading'));
alter table public.care_alert_screenings drop constraint care_alert_screenings_source_check;
alter table public.care_alert_screenings add constraint care_alert_screenings_source_check check(source in('questionnaire','message','lab','zoe','reading'));

-- Null: nothing to send. Same cuts as bp-check.ts. Either number counts for doctor today (answers file, item 15).
create function public._bp_check_level(s integer,d integer,repeated boolean,by_staff boolean)returns text
language sql immutable set search_path=''as $$
 select case when not(s>=180 or d>=110)or not(repeated or by_staff)then null
  when s>=180 or d>=120 then 'bp_doctor_today'else 'bp_doctor_48h'end
$$;

-- Sends that failed, for the sweep (bp_check_retry). One row per reading or nurse mark. No policy: only the definer functions touch it.
create table public.bp_check_retries(
 ref text primary key,member_id uuid not null references auth.users(id)on delete cascade,level text not null,measured_at timestamptz not null,
 attempts integer not null default 0,created_at timestamptz not null default clock_timestamp()
);
alter table public.bp_check_retries enable row level security;

-- True only when the alert is recorded. A live alert keeps one reason: a same-day reason replaces the 48-hour one and never goes back
-- (_care_alert_raise leaves the first reason on a repeat). A failure leaves a retry row, and the save stands.
create function public._bp_check_raise(p_member uuid,p_ref text,p_level text,p_measured_at timestamptz)returns boolean
language plpgsql security definer set search_path=''as $$
begin
 begin
  perform public._care_alert_screen(p_member,'reading',p_ref,'escalate',p_level,array['RF-06'],'clinical.bp_one_rule','bp-one-rule-1');
  if p_level='bp_doctor_today'then
   update public.care_alerts set reason_code='bp_doctor_today',state_seq=state_seq+1 where member_id=p_member and source='reading'and state<>'resolved'and reason_code='bp_doctor_48h';
  end if;
  delete from public.bp_check_retries where ref=p_ref;
  return true;
 exception when others then
  begin
   insert into public.bp_check_retries(ref,member_id,level,measured_at)values(p_ref,p_member,p_level,p_measured_at)on conflict(ref)do update set attempts=public.bp_check_retries.attempts+1;
   perform public._conversation_trace(p_member,null,'bp_reading',p_ref,'care_alert','care_alert.raise_failed','failed','alert_not_recorded_will_retry','clinical.bp_one_rule','bp-one-rule-1','system',null,
    jsonb_build_object('noreon.care_alert.source','reading','noreon.error.sqlstate',sqlstate));
  exception when others then null;
  end;
  return false;
 end;
end$$;

-- Run by every sweep. _care_alert_screen is idempotent per reading, so a retry raises one alert. A note closes only once the alert exists.
create function public.bp_check_retry(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.bp_check_retries;n integer:=0;f integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(public._care_alert_settings()).enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for r in select * from public.bp_check_retries order by created_at limit greatest(1,least(coalesce(p_limit,20),50))loop
  if public._bp_check_raise(r.member_id,r.ref,r.level,r.measured_at)then
   update public.bp_repeat_notes set closed_at=clock_timestamp()where member_id=r.member_id and closed_at is null and measured_at<r.measured_at;
   n:=n+1;
  else f:=f+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',f);
end$$;

-- The doctor's quiet notes. One open per member. No policy: only the definer functions here read or write it.
create table public.bp_repeat_notes(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 measurement_id uuid not null references public.patient_measurements(id)on delete cascade,
 systolic integer not null,diastolic integer not null,measured_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),closed_at timestamptz
);
create unique index bp_repeat_notes_open on public.bp_repeat_notes(member_id)where closed_at is null;
alter table public.bp_repeat_notes enable row level security;

-- Never undoes the save. A newer first reading updates the open note rather than adding one.
create function public._bp_check_note(m public.patient_measurements,p_close boolean,p_open boolean)returns void
language plpgsql security definer set search_path=''as $$
begin
 begin
  if p_close then update public.bp_repeat_notes set closed_at=clock_timestamp()where member_id=m.user_id and closed_at is null and measured_at<m.measured_at;end if;
  if p_open then
   insert into public.bp_repeat_notes(member_id,measurement_id,systolic,diastolic,measured_at)values(m.user_id,m.id,m.systolic,m.diastolic,m.measured_at)
    on conflict(member_id)where closed_at is null do update set measurement_id=excluded.measurement_id,systolic=excluded.systolic,diastolic=excluded.diastolic,measured_at=excluded.measured_at;
  end if;
 exception when others then
  begin
   perform public._conversation_trace(m.user_id,null,'bp_reading',m.id::text,'care_alert','bp_note.failed','failed','note_not_recorded','clinical.bp_one_rule','bp-one-rule-1','system',null,
    jsonb_build_object('noreon.error.sqlstate',sqlstate));
  exception when others then null;
  end;
 end;
end$$;

create function public._bp_check_saved()returns trigger
language plpgsql security definer set search_path=''as $$
declare staff boolean:=auth.uid()is not null and auth.uid()<>new.user_id;high boolean:=new.systolic>=180 or new.diastolic>=110;repeated boolean;lvl text;alerts boolean;
begin
 if new.measured_at<clock_timestamp()-interval '24 hours'then return null;end if;
 -- A calm reading is the repeat: the note closes.
 if not high then perform public._bp_check_note(new,true,false);return null;end if;
 repeated:=exists(select 1 from public.patient_measurements p where p.user_id=new.user_id and p.id<>new.id
  and p.measured_at between new.measured_at-interval '120 minutes' and new.measured_at-interval '5 minutes'and(p.systolic>=180 or p.diastolic>=110));
 lvl:=public._bp_check_level(new.systolic,new.diastolic,repeated,staff);
 alerts:=(public._care_alert_settings()).enabled is true;
 if lvl is not null and alerts then
  -- The alert takes the note's place: no duplicate. Only once it exists: a failed raise keeps the note until the sweep has raised it.
  if public._bp_check_raise(new.user_id,new.id::text,lvl,new.measured_at)then perform public._bp_check_note(new,true,false);end if;
 elsif lvl is null and(new.systolic>=180 or new.diastolic>=120)then
  perform public._bp_check_note(new,false,true);
 end if;
 return null;
end$$;
create trigger bp_check_saved after insert on public.patient_measurements for each row execute function public._bp_check_saved();

create function public._bp_check_nurse_mark()returns trigger
language plpgsql security definer set search_path=''as $$
declare s integer;d integer;lvl text;
begin
 if new.item<>'measure:bp'or not new.done or jsonb_typeof(new.vals->'systolic')<>'number'or jsonb_typeof(new.vals->'diastolic')<>'number'then return null;end if;
 if(public._care_alert_settings()).enabled is not true then return null;end if;
 s:=(new.vals->>'systolic')::integer;d:=(new.vals->>'diastolic')::integer;
 lvl:=public._bp_check_level(s,d,false,true);
 if lvl is not null then perform public._bp_check_raise(new.member_id,'nurse-mark:'||new.id::text,lvl,new.recorded_at);end if;
 return null;
end$$;
create trigger bp_check_nurse_mark after insert on public.nurse_visit_marks for each row execute function public._bp_check_nurse_mark();

-- The assigned doctor's open quiet notes, as low-priority inbox items (lib/doctor-inbox/day.ts adds them to the day). Seven days, then
-- they leave the queue; the reading stays on the record and in the routine-review hold.
create function public.doctor_bp_repeat_notes()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;r jsonb;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 select coalesce(jsonb_agg(x order by x->>'at'),'[]')into r from(
  select jsonb_build_object('id','bp_repeat:'||n.id,'lane','P3','kind','bp_repeat_pending','rank',3,'memberId',n.member_id,'memberName',coalesce(pr.display_name,''),
   'at',n.created_at,'confidence','rule','ai','none','systolic',n.systolic,'diastolic',n.diastolic,
   'sources',jsonb_build_array(jsonb_build_object('type','measurement','ref',n.measurement_id::text,'rule','clinical.bp_one_rule')))x
  from public.bp_repeat_notes n join public.patient_clinical_cases k on k.user_id=n.member_id left join public.profiles pr on pr.id=n.member_id
  where n.closed_at is null and n.created_at>clock_timestamp()-interval '7 days'and k.assigned_doctor_id=me and public.staff_care_access(n.member_id,me,true)
  order by n.created_at limit 50)q;
 return r;
end$$;

-- The nurse checklist and NurseUrgentGuidance say the rule (lib/clinical/rules/bp-words.ts, BP_NURSE_GUIDANCE).
-- A clinical edit of the checklist is a new version, never an update of rows a visit was ticked against: the new version
-- is a copy of the current one with the severe blood pressure item reworded, and the settings pointer moves to it.
insert into public.nurse_visit_checklist(version,id,position,section,requires_test,label_en,label_hy,source)
select 'protocol-draft-2',id,position,section,requires_test,
 case when id='severe-bp-contact' then 'If systolic is 180 or higher, or diastolic 110 or higher: have the member rest 5 minutes and measure again. With symptoms, call 103 now. Without symptoms, if the repeat is systolic 180 or higher, or diastolic 120 or higher, contact the assigned doctor today; otherwise the doctor within 48 hours.' else label_en end,
 case when id='severe-bp-contact' then 'Եթե սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 110 կամ ավելի. թող անդամը 5 րոպե հանգստանա և նորից չափեք։ Ախտանիշների դեպքում անմիջապես զանգահարեք 103։ Առանց ախտանիշների, եթե կրկնակի չափմամբ սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 120 կամ ավելի, այսօր կապվեք նշանակված բժշկի հետ, հակառակ դեպքում՝ բժիշկ 48 ժամվա ընթացքում։' else label_hy end,
 source
from public.nurse_visit_checklist where version='protocol-draft-1';
update public.nurse_visit_settings set checklist_version='protocol-draft-2',updated_at=clock_timestamp()where checklist_version='protocol-draft-1';

-- The latest readings, for the one check after a save: the member's own, or a named member for the service role (Telegram).
create function public.member_bp_recent(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=case when auth.role()='service_role'then p_member else auth.uid()end;
begin
 if m is null then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('systolic',x.systolic,'diastolic',x.diastolic,'measuredAt',x.measured_at)order by x.measured_at desc)
  from(select p.systolic,p.diastolic,p.measured_at from public.patient_measurements p where p.user_id=m and p.measured_at>clock_timestamp()-interval '26 hours'order by p.measured_at desc limit 20)x),'[]'::jsonb);
end$$;

revoke all on function public._bp_check_level(integer,integer,boolean,boolean),public._bp_check_raise(uuid,text,text,timestamptz),public._bp_check_saved(),public._bp_check_nurse_mark(),public._bp_check_note(public.patient_measurements,boolean,boolean)from public,anon,authenticated,service_role;
revoke all on table public.bp_repeat_notes,public.bp_check_retries from public,anon,authenticated;
revoke all on function public.bp_check_retry(integer)from public,anon,authenticated;
grant execute on function public.bp_check_retry(integer)to service_role;
revoke all on function public.doctor_bp_repeat_notes()from public,anon;
grant execute on function public.doctor_bp_repeat_notes()to authenticated;
revoke all on function public.member_bp_recent(uuid)from public,anon;
grant execute on function public.member_bp_recent(uuid)to authenticated,service_role;
