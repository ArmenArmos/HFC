-- Gohar's production QA (QA msg 267, 4 Nov): the first note the doctor approved at 21:57 was not in her V3 chat after a
-- reload. The note was saved (member_first_notes) but its only reader is the old member Home (memberFirstNote); the V3 chat has
-- no Home, and #578 (20261103181538) put only a programme checkpoint's note in the chat. The doctor's note is the doctor's own
-- text, so, as there, it becomes an app-only chat notice, once per member, in the screen language, when care notices are on.
-- Telegram gets nothing from this. The notice leaves the chat's "new" list after 7 days, like every notice.

create function public._first_note_notice(p_member uuid,p_text_en text,p_text_hy text,p_at timestamptz)returns void
language plpgsql security definer set search_path=''as $$
declare loc text;label text;body text;
begin
 if(select care from public.member_notice_settings where singleton)is not true then return;end if;
 -- The screen language: Russian is stored as ui_locale, over the clinical locale; a note is written in English and Armenian only.
 loc:=coalesce((select ui_locale from public.profiles where id=p_member),public._telegram_auth_locale(p_member));
 label:=case loc when 'hy'then 'Ձեր բժշկի նշումը'when 'ru'then 'Заметка вашего врача'else 'Note from your doctor'end;
 body:=case when loc='hy'then p_text_hy else p_text_en end;
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id,app_text,created_at)
 values(p_member,'first_note:'||p_member::text,'care','member.first_doctor_note','skipped','telegram_off',null,label||E'\n'||body,p_at)
 on conflict(event_key)do nothing;
exception when others then
 -- Rides on the doctor's approval: never makes it fail.
 begin perform public._member_notice_trace(p_member,'member.first_doctor_note','first_note:'||p_member::text,'care','failed',lower(sqlstate));exception when others then null;end;
end$$;
revoke all on function public._first_note_notice(uuid,text,text,timestamptz)from public,anon,authenticated,service_role;

create function public._first_note_notice_trigger()returns trigger language plpgsql set search_path=''as $$
begin
 perform public._first_note_notice(new.user_id,new.text_en,new.text_hy,new.approved_at);
 return null;
end$$;
create trigger member_first_notes_notice after insert on public.member_first_notes
 for each row execute function public._first_note_notice_trigger();

-- Notes approved before this: the same notice, at the approval time, for members whose Home would still show the note
-- (no active plan). Does nothing while care notices are off.
do $$declare n record;begin
 for n in select f.* from public.member_first_notes f
  where not exists(select 1 from public.patient_care_plans p where p.user_id=f.user_id and p.active)loop
  perform public._first_note_notice(n.user_id,n.text_en,n.text_hy,n.approved_at);
 end loop;
end$$;
