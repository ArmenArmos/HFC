-- PR 7. Nullable document facts; old uploads and old readers retain their behavior.
alter table public.member_reported_documents
 add column doc_type text check(doc_type in('lab','ecg','echocg','duplex','ct_calcium','discharge','prescription','other')),
 add column uploader_role text check(uploader_role in('member','nurse','doctor','admin')),
 add column study_date date check(study_date between date '1950-01-01'and date '2100-01-01'),
 add column classification_confidence numeric check(classification_confidence between 0 and 1),
 -- V3 uploads are saved without model reading. Existing rows and classic uploads keep the previous trigger behavior.
 add column auto_read_allowed boolean not null default true;

create or replace function public._lab_ai_enqueue_member_upload()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.auto_read_allowed and public._lab_ai_member_upload_enabled()and(select count(*)from public.lab_ai_jobs j where j.kind='member_upload'and j.member_id=new.user_id
   and(j.created_at at time zone 'Asia/Yerevan')::date=(clock_timestamp()at time zone 'Asia/Yerevan')::date)<public._lab_ai_member_upload_daily_limit()then
  insert into public.lab_ai_jobs(kind,member_document_id,member_id)values('member_upload',new.id,new.user_id)on conflict(member_document_id)where kind='member_upload'do nothing;
 end if;
 return new;
end$$;

-- Definer read admits only a member and explicitly limits metadata to that member. Only metadata crosses this boundary, never file content or values.
create function public.zoe_v3_document_read(p_document uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();
begin
 return jsonb_build_object('v',1,'document',(
  select jsonb_build_object('id',d.id,'fileName',d.file_name,'mime',d.mime,'docType',d.doc_type,
   'studyDate',d.study_date,'uploaderRole',d.uploader_role,'classificationConfidence',d.classification_confidence,
   'readStatus',case when exists(select 1 from public.lab_ai_jobs j where j.member_document_id=d.id and j.state='done')then 'read'else 'not_read'end)
  from public.member_reported_documents d where d.user_id=uid and d.deleted_at is null and(p_document is null or d.id=p_document)
  order by d.created_at desc,d.id limit 1));
end$$;
revoke all on function public.zoe_v3_document_read(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_document_read(uuid)to authenticated;

-- A member may supply type and date, never a classifier confidence, uploader identity or read status.
create function public.zoe_v3_document_details(p_document uuid,p_type text,p_study_date date)returns boolean
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();
begin
 if p_type is null or p_type not in('lab','ecg','echocg','duplex','ct_calcium','discharge','prescription','other')
  or p_study_date is not null and(p_study_date<date '1950-01-01'or p_study_date>(clock_timestamp()at time zone 'Asia/Yerevan')::date)then return false;end if;
 update public.member_reported_documents set doc_type=p_type,study_date=p_study_date
 where id=p_document and user_id=uid and deleted_at is null;
 return found;
end$$;
revoke all on function public.zoe_v3_document_details(uuid,text,date)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_document_details(uuid,text,date)to authenticated;

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check
 check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask','medicines','account','repeat','red_flags','profile','document','prep','fasting','symptom_gate','consult_questions'));

-- A lab appointment is the existing booking, never a second booking path. Preparation is the clinic's own stored text.
create function public._zoe_v3_lab_snapshot(a public.booking_appointments)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('v',1,'appointmentId',a.id,'revision',a.revision,'startsAt',a.current_arrangement->>'startsAt',
  'location',a.current_arrangement->>'location','preparation',coalesce(nullif(a.current_arrangement->>'preparation',''),s.preparation))
 from public.booking_program_seals p left join public.clinic_schedules s on s.clinic_id=(a.current_arrangement->>'clinicId')::uuid
 where p.id=a.program_id and a.status='confirmed'and coalesce(nullif(a.current_arrangement->>'preparation',''),s.preparation)is not null
 and(a.current_arrangement->>'startsAt')::timestamptz>clock_timestamp()
 and exists(select 1 from jsonb_array_elements(coalesce(a.current_program,p.program->'items'))i where i->>'method'='lab')
$$;
revoke all on function public._zoe_v3_lab_snapshot(public.booking_appointments)from public,anon,authenticated,service_role;

create function public.zoe_v3_lab_appointment(p_appointment uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();a public.booking_appointments;
begin
 select * into a from public.booking_appointments where id=p_appointment and member_id=uid;
 if not found then return null;end if;
 return public._zoe_v3_lab_snapshot(a);
end$$;
revoke all on function public.zoe_v3_lab_appointment(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_lab_appointment(uuid)to authenticated;

create index zoe_v3_lab_cards_appointment on public.zoe_chat_cards(member_id,(snapshot->>'appointmentId'),(snapshot->>'revision'),kind)where kind in('prep','fasting');

create function public.zoe_v3_lab_candidates(p_limit integer default 100,p_after timestamptz default null,p_after_id uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(x.snapshot||jsonb_build_object('memberId',x.member_id,'quietStart',x.quiet_start,'quietEnd',x.quiet_end,'postedKinds',x.posted))from(
  select a.member_id,public._zoe_v3_lab_snapshot(a) snapshot,k.posted,
   coalesce(r.preferences->>'quietStart','22:00')quiet_start,coalesce(r.preferences->>'quietEnd','07:00')quiet_end
  from public.booking_appointments a left join public.patient_reminder_preferences r on r.user_id=a.member_id
  cross join lateral(select coalesce(jsonb_agg(distinct c.kind),'[]'::jsonb)posted from public.zoe_chat_cards c
   where c.member_id=a.member_id and c.kind in('prep','fasting')and c.snapshot->>'appointmentId'=a.id::text and c.snapshot->>'revision'=a.revision::text)k
  where not(k.posted?&array['prep','fasting'])and a.status='confirmed'and(a.current_arrangement->>'startsAt')::timestamptz between clock_timestamp()and clock_timestamp()+interval '36 hours'
  and(p_after is null or((a.current_arrangement->>'startsAt')::timestamptz,a.id)>(p_after,p_after_id))
  and public._zoe_v3_lab_snapshot(a)is not null
  order by(a.current_arrangement->>'startsAt')::timestamptz,a.id limit greatest(1,least(coalesce(p_limit,100),100))
 )x),'[]'::jsonb);
end$$;
revoke all on function public.zoe_v3_lab_candidates(integer,timestamptz,uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_lab_candidates(integer,timestamptz,uuid)to service_role;

-- Recheck while holding the booking row: cancellation or rescheduling cannot post a stale scheduled form.
create function public.zoe_v3_lab_card_post(p_appointment uuid,p_revision bigint,p_kind text,p_request uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;snapshot jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('prep','fasting')then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into a from public.booking_appointments where id=p_appointment for update;
 if not found or a.revision<>p_revision then return jsonb_build_object('ok',false,'code','stale');end if;
 snapshot:=public._zoe_v3_lab_snapshot(a);
 if snapshot is null then return jsonb_build_object('ok',false,'code','stale');end if;
 return public.zoe_chat_card_post(a.member_id,p_request,p_kind,'chip',null,snapshot);
end$$;
revoke all on function public.zoe_v3_lab_card_post(uuid,bigint,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_lab_card_post(uuid,bigint,text,uuid)to service_role;

-- The member's questions. No staff SELECT policy: the assigned doctor uses the function below.
create table public.consult_questions(
 id uuid primary key default gen_random_uuid(),member_id uuid not null references auth.users(id)on delete cascade,
 appointment_id uuid references public.booking_appointments(id),request_id uuid not null,
 text text not null check(length(btrim(text))between 1 and 1000),
 group_label text not null check(group_label in('symptoms','medicines','results')),
 created_at timestamptz not null default clock_timestamp(),sent_at timestamptz,
 unique(member_id,request_id,group_label)
);
create index consult_questions_member on public.consult_questions(member_id,created_at desc);
alter table public.consult_questions enable row level security;
revoke all on public.consult_questions from public,anon,authenticated,service_role;
-- Browser writes use the member-scoped save/sent functions below.
grant select on public.consult_questions to authenticated;
create policy consult_questions_read on public.consult_questions for select to authenticated using(member_id=(select auth.uid()));

create function public._consult_questions_appointment_guard()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.appointment_id is not null and not exists(select 1 from public.booking_appointments where id=new.appointment_id and member_id=new.member_id)then
  raise check_violation using message='Your appointment is unavailable';end if;
 return new;
end$$;
create trigger consult_questions_appointment_guard before insert or update on public.consult_questions for each row execute function public._consult_questions_appointment_guard();
revoke all on function public._consult_questions_appointment_guard()from public,anon,authenticated,service_role;

create function public.doctor_consult_questions(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_member);
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'appointmentId',q.appointment_id,'text',q.text,'groupLabel',q.group_label,'createdAt',q.created_at,'sentAt',q.sent_at)order by q.created_at,q.id)
 from public.consult_questions q where q.member_id=p_member and q.sent_at is not null),'[]'::jsonb);
end$$;
revoke all on function public.doctor_consult_questions(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_consult_questions(uuid)to authenticated;

-- One batch for the claimed card operation. An unknown send replays its exact request id and immutable text.
create function public.zoe_v3_consult_questions_save(p_request uuid,p_appointment uuid,p_groups jsonb)returns boolean
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();g jsonb;prior jsonb;wanted jsonb;
begin
 if p_request is null or jsonb_typeof(p_groups)is distinct from 'array'or jsonb_array_length(p_groups)not between 1 and 3 then return false;end if;
 for g in select value from jsonb_array_elements(p_groups)loop
  if jsonb_typeof(g)is distinct from 'object'or not(g?&array['label','text'])or g-array['label','text']<>'{}'
   or jsonb_typeof(g->'label')is distinct from 'string'or jsonb_typeof(g->'text')is distinct from 'string'
   or g->>'label'not in('symptoms','medicines','results')or length(btrim(g->>'text'))not between 1 and 1000 then return false;end if;
 end loop;
 if(select count(distinct e->>'label')from jsonb_array_elements(p_groups)e)<>jsonb_array_length(p_groups)then return false;end if;
 if p_appointment is not null and not exists(select 1 from public.booking_appointments where id=p_appointment and member_id=uid)then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('consult-questions:'||uid::text||':'||p_request::text,0));
 select jsonb_agg(jsonb_build_object('label',q.group_label,'text',q.text)order by q.group_label)into prior from public.consult_questions q where member_id=uid and request_id=p_request;
 select jsonb_agg(e order by e->>'label')into wanted from jsonb_array_elements(p_groups)e;
 if prior is not null then return prior=wanted and not exists(select 1 from public.consult_questions where member_id=uid and request_id=p_request and appointment_id is distinct from p_appointment);end if;
 insert into public.consult_questions(member_id,appointment_id,request_id,text,group_label)
 select uid,p_appointment,p_request,e->>'text',e->>'label'from jsonb_array_elements(p_groups)e;
 return true;
end$$;
revoke all on function public.zoe_v3_consult_questions_save(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_consult_questions_save(uuid,uuid,jsonb)to authenticated;

create function public.zoe_v3_consult_questions_sent(p_request uuid)returns boolean
language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();sent timestamptz;
begin
 -- A successful ordinary message-to-doctor write is evidence of sending; the browser cannot supply a timestamp.
 select m.created_at into sent from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
 where c.member_id=uid and m.author_id=uid and m.request_id=p_request and m.to_doctor;
 if sent is null then return false;end if;
 update public.consult_questions set sent_at=coalesce(sent_at,sent)where member_id=uid and request_id=p_request;
 return found;
end$$;
revoke all on function public.zoe_v3_consult_questions_sent(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_consult_questions_sent(uuid)to authenticated;
