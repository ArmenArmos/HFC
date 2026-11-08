-- The doctor's own note on a closed programme checkpoint reaches the member chat as its own message
-- (Gohar QA 243, TC-QST-013). Until now it showed only on the progress card, and the notice that points
-- to it waits for approved wording. The note is the doctor's text, so it needs no template; the label is
-- the one the progress card already shows, in the member's language. Telegram gets nothing from this:
-- health text stays out of it, and the neutral notice (member.programme_plan_confirmed) is unchanged.

create function public._programme_note_notice(p_member uuid,p_checkpoint uuid,p_note text)returns void
language plpgsql security definer set search_path=''as $$
declare loc text;label text;
begin
 if p_note is null or(select care from public.member_notice_settings where singleton)is not true then return;end if;
 -- The screen language: Russian is stored as ui_locale, over the clinical locale.
 loc:=coalesce((select ui_locale from public.profiles where id=p_member),public._telegram_auth_locale(p_member));
 label:=case loc when 'hy'then 'Ձեր բժշկի նշումը'when 'ru'then 'Заметка вашего врача'else 'Note from your doctor'end;
 -- App copy only: skipped for Telegram, like a notice whose Telegram route is off. Once per checkpoint.
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id,app_text)
 values(p_member,'programme.note:'||p_checkpoint::text,'care','member.programme_doctor_note','skipped','telegram_off',null,label||E'\n'||p_note)
 on conflict(event_key)do nothing;
exception when others then
 -- Rides on the doctor's confirm: never makes it fail.
 begin perform public._member_notice_trace(p_member,'member.programme_doctor_note','programme.note:'||p_checkpoint::text,'care','failed',lower(sqlstate));exception when others then null;end;
end$$;
revoke all on function public._programme_note_notice(uuid,uuid,text)from public,anon,authenticated,service_role;

create or replace function public.doctor_programme_confirm(p_user_id uuid,p_checkpoint uuid,p_note text,p_submission uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;cp public.programme_checkpoints;note text:=nullif(btrim(coalesce(p_note,'')),'');who text;
begin
 if not public._programme_enabled()then raise exception using errcode='55P03',message='The programme is switched off';end if;
 d:=public._programme_doctor(p_user_id);
 if p_submission is null then raise exception using errcode='22023',message='Submission id required';end if;
 select * into cp from public.programme_checkpoints where submission_id=p_submission;
 if found then
  if cp.member_id<>p_user_id then raise insufficient_privilege;end if;
  return jsonb_build_object('status','confirmed','completedAt',cp.completed_at);
 end if;
 if note is not null and length(note)>1000 then raise exception using errcode='22023',message='Keep the note within 1000 characters';end if;
 select * into cp from public.programme_checkpoints where id=p_checkpoint and member_id=p_user_id for update;
 if not found then raise insufficient_privilege using message='Not this member''s checkpoint';end if;
 if cp.state<>'open'then return jsonb_build_object('status','closed');end if;
 if not exists(select 1 from public.patient_care_plans p where p.user_id=p_user_id and p.active)then return jsonb_build_object('status','no_plan');end if;
 select display_name into who from public.workspace_staff where user_id=d;
 update public.programme_checkpoints set state='completed',completed_at=clock_timestamp(),completed_by=d,completed_by_name=coalesce(who,'Doctor'),
  outcome='confirmed',doctor_note=note,submission_id=p_submission where id=cp.id returning * into cp;
 insert into public.programme_checkpoint_events(checkpoint_id,kind,actor_id)values(cp.id,'confirmed',d);
 perform public._member_notice_safe(p_user_id,'care','member.programme_plan_confirmed','programme.confirmed:'||cp.id::text,'{}','/patient/dashboard','open_home');
 perform public._programme_note_notice(p_user_id,cp.id,note);
 return jsonb_build_object('status','confirmed','completedAt',cp.completed_at);
end$$;
