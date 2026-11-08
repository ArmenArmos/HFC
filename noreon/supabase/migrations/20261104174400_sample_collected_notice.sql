-- The lead assigns STAMP before replay/merge. Requested by Khikar, 5 Nov 2026.
-- Reuse care notice decisions, app history and Telegram delivery rows. No backfill.
-- Telegram wording is registered verbatim as an unapproved draft; Armen or Roo must
-- approve these versions and the Russian Open Noreon label before Telegram can send.
alter table public.system_message_templates drop constraint system_message_templates_locale_check;
alter table public.system_message_templates add constraint system_message_templates_locale_check
 check(locale in('en','hy')or(locale='ru'and(template_id like 'telegram.nurse.%'
  or template_id in('app.bp_weekly_summary','member.samples_collected','member.samples_collected_exceptions','member_notice.open_label'))));
insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.samples_collected',1,'en',E'Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.'),
 ('member.samples_collected_exceptions',1,'en',E'Your samples have been collected. We''ll let you know once your doctor has reviewed the results and approved your plan.\nSamples were not collected for: {collection_tests}. Your nurse will be in touch.'),
 ('member.samples_collected',1,'hy',E'Ձեր նմուշները վերցված են։ Կտեղեկացնենք ձեզ, երբ ձեր բժիշկը վերանայի արդյունքները և հաստատի ձեր պլանը։'),
 ('member.samples_collected_exceptions',1,'hy',E'Ձեր նմուշները վերցված են։ Կտեղեկացնենք ձեզ, երբ ձեր բժիշկը վերանայի արդյունքները և հաստատի ձեր պլանը։\nՆմուշներ չեն վերցվել հետևյալ հետազոտությունների համար՝ {collection_tests}։ Ձեր բուժքույրը կկապվի ձեզ հետ։'),
 ('member.samples_collected',1,'ru',E'Ваши образцы взяты. Мы сообщим вам, когда ваш врач проверит результаты и одобрит ваш план.'),
 ('member.samples_collected_exceptions',1,'ru',E'Ваши образцы взяты. Мы сообщим вам, когда ваш врач проверит результаты и одобрит ваш план.\nНе удалось взять образцы для следующих анализов: {collection_tests}. Ваша медсестра свяжется с вами.');
insert into public.system_message_templates(template_id,version,locale,body)values
 ('member_notice.open_label',1,'ru','Открыть Noreon');
insert into public.notice_channels(template_id,push)values('member.samples_collected',false),('member.samples_collected_exceptions',false);
-- Stop proactive results-ready messages in every member channel, including pending push.
update public.notice_channels set chat=false,telegram=false,push=false,updated_at=clock_timestamp()
 where template_id in('member.results_received','member.document_released');

create or replace function public._member_notice_params_ok(p jsonb)returns boolean language sql immutable set search_path=''as $$
 select p is null or case when jsonb_typeof(p)<>'object'then false
 when p ? 'collection_tests' then
  (p-array['collection_tests'])='{}'::jsonb
  and jsonb_typeof(p->'collection_tests')='string'
  and length(p->>'collection_tests') between 1 and 2600
  and p->>'collection_tests' !~ '[{}\r\n\t]'
  and p->>'collection_tests'=btrim(p->>'collection_tests')
 when p ?| array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next'] then
  (p-array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next'])='{}'::jsonb
  and p ?& array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next']
  and coalesce(p->>'bp_sys'~'^[0-9]{2,3}$'and p->>'bp_dia'~'^[0-9]{2,3}$'and p->>'bp_days'~'^[2-7]$',false)
  and not exists(select 1 from jsonb_each(p)e where jsonb_typeof(e.value)<>'string'or length(e.value#>>'{}')>200 or e.value#>>'{}'~'[{}\r\n\t]')
 else (p-array['date','time','end_time','clinic','nurse'])='{}'::jsonb
  and not exists(select 1 from jsonb_each(p)e where jsonb_typeof(e.value)<>'string'or length(e.value#>>'{}')not between 1 and 80
   or e.value#>>'{}'~'[{}\r\n\t]'or e.value#>>'{}'<>btrim(e.value#>>'{}'))end
$$;

create or replace function public._member_notice(p_member uuid,p_group text,p_template text,p_key text,p_params jsonb,p_path text,p_step text)returns uuid
language plpgsql security definer set search_path=''as $$
declare s public.member_notice_settings;ch public.telegram_channel_settings;b public.telegram_auth_bindings;t public.system_message_templates;
 enabled boolean;why text;mid uuid;loc text;route public.notice_channels;app_txt text;
begin
 if p_member is null or p_key is null then return null;end if;
 -- Member results notifications stop here, including old lab/PDF trigger callers.
 if p_template in('member.results_received','member.document_released')then return null;end if;
 select * into s from public.member_notice_settings where singleton;
 enabled:=case p_group when 'booking'then s.booking when 'reminders'then s.reminders when 'results'then s.results when 'care'then s.care end;
 if enabled is not true then perform public._member_notice_trace(p_member,p_template,p_key,p_group,'skipped','switched_off');return null;end if;
 -- One decision per member at a time, so the throttle and the once-per-event check cannot race.
 -- A leaf lock: nothing below waits on another lock while holding it. The reminder sweep never
 -- waits for it: a busy member is left for the next sweep (no journal row), so a booking or care
 -- command is not kept waiting behind the sweep (review F2A).
 if current_setting('noreon.member_notice_sweep',true)='on'then
  if not pg_try_advisory_xact_lock(hashtextextended('member-notice:'||p_member::text,0))then return null;end if;
 else perform pg_advisory_xact_lock(hashtextextended('member-notice:'||p_member::text,0));end if;
 if exists(select 1 from public.member_notices where event_key=p_key)then return null;end if;
 select * into ch from public.telegram_channel_settings where singleton;
 select * into b from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active order by created_at desc limit 1;
 why:=case
  when exists(select 1 from public.workspace_staff where user_id=p_member)or exists(select 1 from public.clinic_portal_memberships where user_id=p_member)then 'staff_account'
  when b.id is null then 'not_connected'
  when ch.singleton is null or b.account_ref is distinct from public._telegram_account_ref(ch)then 'other_bot'
  when public._member_notice_turned_off(p_member)then 'turned_off'
  when exists(select 1 from public.member_notices where member_id=p_member and template_id=p_template and outcome='queued'
   and created_at>clock_timestamp()-make_interval(secs=>s.throttle_seconds))then 'throttled'
  when(select count(*)from public.member_notices where member_id=p_member and outcome='queued'and created_at>clock_timestamp()-interval '1 hour')>=s.hourly_cap then 'hourly_cap'
 end;
 select * into route from public.notice_channels where template_id=p_template;
 loc:=case when p_template in('app.bp_weekly_summary','member.samples_collected','member.samples_collected_exceptions') then
  coalesce((select coalesce(ui_locale,locale) from public.profiles where id=p_member),'hy')
  else public._telegram_auth_locale(p_member) end;
 select * into t from public.system_message_templates where template_id=p_template and locale=loc order by version desc limit 1;
 -- This collection copy is requested for the app even while Telegram wording awaits approval.
 -- Telegram still queues the template version and is held at claim, like other care notices.
 -- Staff accounts and staff-targeted templates never produce an app notice.
 if why<>'staff_account'or why is null then
  if coalesce(route.audience,'member')='member'and coalesce(route.chat,true)and (t.approved or p_template in('member.samples_collected','member.samples_collected_exceptions')) then app_txt:=public._member_notice_render(t.body,p_params);end if;
  if coalesce(route.audience,'member')<>'member'then why:='staff_account';
  elsif route.telegram is false then why:='telegram_off';end if;
 end if;
 if why is null then
  if t.template_id is null then why:='no_template';
  else
   insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard,params)
   values(b.address,b.principal_ref,t.template_id,t.version,t.locale,t.body,jsonb_build_object('kind','open_url','url',s.app_origin||p_path),nullif(p_params,'{}'::jsonb))
   returning id into mid;
   why:='queued';
   -- The one-tap sign-in link (armed only when sent; at most 5 per member per hour, as for next-step replies).
   -- The link row references the binding (a key-share lock): never wait for it, since an unlink
   -- locks the binding and then the case this command may hold (review F2B); skip the link instead.
   if p_step is not null and(select count(*)from public.telegram_signin_links where auth_user_id=p_member and created_at>clock_timestamp()-interval '1 hour')<5 then
    begin
     perform 1 from public.telegram_auth_bindings where id=b.id for key share nowait;
     insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,message_id)values(p_member,b.id,b.generation,b.principal_ref,p_step,mid);
    exception when lock_not_available then null;
    end;
   end if;
  end if;
 end if;
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id,app_text,params)
 values(p_member,p_key,p_group,p_template,case when mid is null then 'skipped'else 'queued'end,why,mid,app_txt,nullif(p_params,'{}'::jsonb));
 perform public._member_notice_trace(p_member,p_template,p_key,p_group,case when mid is null then 'skipped'else 'queued'end,why);
 return mid;
end$$;


create or replace function public._member_notice_closed(p_member uuid,p_key text,p_template text,p_params jsonb)returns boolean
language plpgsql stable security definer set search_path=''as $$
declare part text[]:=string_to_array(p_key,':');w public.bp_weeks;
begin
 if p_template in('member.results_received','member.document_released')then return true;end if;
 if part[1]='bp_weekly'then
  return exists(select 1 from public.care_alerts a where a.member_id=p_member and a.priority='urgent'and a.state='open');
 elsif part[1]in('reminder.tomorrow','reminder.soon','medicine')then
  return public._member_reminder_stale(p_member,p_key,p_template,p_params);
 elsif part[1]='bpweek'then
  if array_length(part,1)<>4 or part[4]not in('morning','evening')then return true;end if;
  select * into w from public.bp_weeks where id=part[2]::uuid and member_id=p_member;
  if not found or w.stopped_at is not null or part[3]::integer not between 1 and w.days then return true;end if;
  return(select count(*)from public.bp_week_readings where week_id=w.id and day=part[3]::integer and slot=part[4])>=w.readings_per_slot;
 elsif part[1]='medicine_ask'then
  return not exists(select 1 from public.member_medicine_asks a where a.id=part[2]::uuid and a.user_id=p_member
   and a.state='open'and a.expires_at>now());
 elsif part[1]='booking.proposal'then
  return not exists(select 1 from public.clinic_booking_proposals pr join public.booking_appointments a on a.id=pr.appointment_id
   where pr.id=part[2]::uuid and a.member_id=p_member and pr.state='open');
 elsif part[1]='care.plan'then
  return not exists(select 1 from public.patient_care_plans p where p.id=part[2]::uuid and p.user_id=p_member and p.active and p.retired_at is null and p.acknowledged_at is null);
 elsif part[1]in('ldl.retest_due','ldl.retest_overdue')then
  return not exists(select 1 from public.ldl_retests r where r.id=part[2]::uuid and r.member_id=p_member and r.state in('scheduled','requested','fenced'));
 end if;
 return false;
exception when others then return true;
end$$;


create or replace function public.member_notices_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();result jsonb;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 with recent as materialized(
  select n.id,n.created_at,n.app_text,n.event_key,n.template_id,n.params
  from public.member_notices n where n.member_id=uid and n.app_text is not null
   and n.template_id not in('member.results_received','member.document_released')
  order by n.created_at desc,n.id desc limit 200
 ), items as materialized(
  select r.*,case when r.created_at>=now()-interval '7 days'
   then public._member_notice_closed(uid,r.event_key,r.template_id,r.params)else true end closed from recent r
 )
 select jsonb_build_object('notices',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'text',i.app_text,'at',i.created_at,'closed',i.closed)order by i.created_at,i.id),'[]'::jsonb),
  'firstUnseen',(select x.id from items x where not x.closed
   and x.created_at>coalesce((select s.seen_at from public.member_notice_seen s where s.member_id=uid),'-infinity'::timestamptz)
   order by x.created_at,x.id limit 1))into result from items i;
 return result;
end$$;

-- Snapshot of TEST_CATALOGUE names, with the exact testTitle rule: translate a catalogue
-- title only; retain provider-authored titles. check-sample-collected-notice.ts pins parity.
create function public._sample_collected_test_title(p_id text,p_title text,p_locale text)returns text
language sql immutable set search_path=''as $$
 select case when names is not null and p_title in(names->>'en',names->>'hy',names->>'ru')
  then names->>p_locale else p_title end
 from(select '{"tsh":{"en":"TSH","ru":"TSH","hy":"TSH"},"nt-probnp":{"en":"NT-proBNP","ru":"NT-proBNP","hy":"NT-proBNP"},"echocardiogram":{"en":"Echocardiogram","ru":"Эхокардиография","hy":"ԷխոԿԳ"},"holter":{"en":"24–48 hour Holter monitoring","ru":"Холтеровское мониторирование в течение 24–48 часов","hy":"Հոլտեր 24–48 ժամ"},"insulin-homa":{"en":"Fasting insulin and HOMA-IR","ru":"Инсулин натощак и HOMA-IR","hy":"Ծոմային ինսուլին · HOMA-IR"},"sleep-study":{"en":"Sleep study (PSG/HSAT)","ru":"Исследование сна (ПСГ/HSAT)","hy":"Պոլիսոմնոգրաֆիա / HSAT"},"fundoscopy":{"en":"Eye fundus examination","ru":"Исследование глазного дна","hy":"Աչքի հատակի հետազոտություն"},"foot-exam":{"en":"Foot examination","ru":"Осмотр стоп","hy":"Ոտքերի զննում"},"bp-visit":{"hy":"Զարկերակային ճնշման կրկնակի չափում","en":"Repeated blood pressure measurement","ru":"Повторное измерение артериального давления"},"anthropometry":{"hy":"Քաշի և գոտկատեղի չափում","en":"Weight and waist measurement","ru":"Измерение веса и окружности талии"},"lipid-panel":{"hy":"Լիպիդային պրոֆիլ և LDL-C","en":"Lipid profile with LDL-C","ru":"Липидный профиль с LDL-C"},"apob":{"hy":"ApoB","en":"ApoB","ru":"ApoB"},"lpa":{"hy":"Lp(a)","en":"Lp(a)","ru":"Lp(a)"},"hba1c":{"hy":"HbA1c","en":"HbA1c","ru":"HbA1c"},"hba1c-glucose":{"hy":"HbA1c և քաղցած գլյուկոզա","en":"HbA1c and fasting glucose","ru":"HbA1c и глюкоза натощак"},"creatinine-egfr":{"hy":"Կրեատինին և eGFR","en":"Creatinine and eGFR","ru":"Креатинин и eGFR"},"urine-acr":{"hy":"Միզի ալբումին/կրեատինին հարաբերություն (ACR)","en":"Urine albumin to creatinine ratio (ACR)","ru":"Соотношение альбумина и креатинина в моче (ACR)"},"urinalysis":{"hy":"Մեզի ընդհանուր հետազոտություն","en":"Urinalysis","ru":"Общий анализ мочи"},"potassium":{"hy":"Կալիում","en":"Potassium","ru":"Калий"},"sodium":{"hy":"Նատրիում","en":"Sodium","ru":"Натрий"},"cbc-hb":{"hy":"Արյան ընդհանուր հետազոտություն","en":"Full blood count","ru":"Общий анализ крови"},"ecg-12-lead":{"hy":"12-առաջատար ԷՍԳ","en":"12-lead ECG","ru":"ЭКГ в 12 отведениях"},"bp-home-log":{"hy":"Ճնշման 7-օրյա տնային գրանցամատյան","en":"7-day home blood pressure log","ru":"Дневник домашнего артериального давления за 7 дней"}}'::jsonb->p_id as names)s
$$;
revoke all on function public._sample_collected_test_title(text,text,text)from public,anon,authenticated,service_role;

create function public._sample_collected_notice(p_member uuid,p_source text,p_id uuid,p_arrangement timestamptz,p_items jsonb)returns void
language plpgsql security definer set search_path=''as $$
declare loc text;tests text;extra integer;tpl text:='member.samples_collected';
 k text:='samples.collected:'||p_source||':'||p_id::text||':'||extract(epoch from p_arrangement)::text;
begin
 if not exists(select 1 from jsonb_array_elements(p_items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'='collected')
  or exists(select 1 from jsonb_array_elements(p_items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'is null)then return;end if;
 -- ui_locale first, then clinical locale, as the first-note notice. All three have copy.
 loc:=coalesce((select ui_locale from public.profiles where id=p_member),public._telegram_auth_locale(p_member));
 select string_agg(title,', 'order by ord)filter(where n<=5),greatest(count(*)::integer-5,0) into tests,extra
 from(select ord,row_number()over(order by ord)n,
  regexp_replace(public._sample_collected_test_title(x->>'testId',x->>'title',loc),'[{}\r\n\t]',' ','g')title
  from jsonb_array_elements(p_items)with ordinality as a(x,ord)
  where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'in('not-collected','issue'))e;
 if tests is not null then
  if extra>0 then tests:=tests||case loc when 'hy'then ' և ևս 'when 'ru'then ' и ещё 'else ' and 'end||extra::text||case loc when 'en'then ' more'else ''end;end if;
  tpl:='member.samples_collected_exceptions';
 end if;
 perform public._member_notice(p_member,'care',tpl,k,case when tests is null then '{}'::jsonb else jsonb_build_object('collection_tests',tests)end,'/patient/chat',null);
end$$;
revoke all on function public._sample_collected_notice(uuid,text,uuid,timestamptz,jsonb)from public,anon,authenticated,service_role;

create or replace function public._nurse_visit_collect_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;expected bigint;s public.workspace_staff;v jsonb;items jsonb;i jsonb;
 st text;reason text;canonical jsonb;r bigint;mid uuid;receipt public.nurse_visit_collection_receipts;all_pending boolean;arrangement_token text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object' or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','expectedRevision','arrangementToken'])
  or p_command-array['version','memberId','source','sourceId','submissionId','expectedRevision','arrangementToken','all','testId','status','reason']<>'{}'
  or jsonb_typeof(p_command->'arrangementToken')is distinct from 'string'
  or length(p_command->>'arrangementToken')not between 1 and 100
  or jsonb_typeof(p_command->'expectedRevision')is distinct from 'number'
  or (p_command->>'expectedRevision')!~'^[0-9]+$' then return bad;end if;
 all_pending:=p_command?'all';
 if all_pending then
  if p_command->'all'is distinct from 'true'::jsonb or p_command?|array['testId','status','reason'] then return bad;end if;
 else
  if not(p_command?&array['testId','status','reason']) or jsonb_typeof(p_command->'testId')is distinct from 'string'
   or coalesce(p_command->>'status','')not in('collected','not-collected','issue')
   or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
  st:=p_command->>'status';reason:=nullif(btrim(p_command->>'reason'),'');
  if (st in('not-collected','issue')and(reason is null or length(reason)>300))
   or(st='collected'and reason is not null)then return bad;end if;
 end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  expected:=(p_command->>'expectedRevision')::bigint;
 exception when invalid_text_representation or numeric_value_out_of_range then return bad;end;
 src:=p_command->>'source';
 if coalesce(src,'')not in('home-request','appointment')or m is null or sid is null or sub is null then return bad;end if;
 canonical:=case when all_pending then p_command else jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb))end;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,true);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into receipt from public.nurse_visit_collection_receipts where member_id=m and submission_id=sub;
 if found then
  if receipt.command is distinct from canonical or receipt.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 -- Do not reuse a submission from the older single-mark path.
 if exists(select 1 from public.nurse_visit_marks where member_id=m and submission_id=sub)then return jsonb_build_object('status','stale');end if;
 -- Match the source locks used by home-request changes and booking commands.
 -- Portal confirmation also locks the appointment row, without the case lock above.
 -- Keep this row locked from the token read through marks, steps and the receipt.
 if src='home-request'then
  select revision::text into arrangement_token from public.patient_test_requests where id=sid and user_id=m for update nowait;
 else
  select current_reservation_id::text into arrangement_token from public.booking_appointments where id=sid and member_id=m for update nowait;
 end if;
 if not found then return jsonb_build_object('status','unavailable');end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid is distinct from m then return jsonb_build_object('status','unavailable');end if;
 if v->>'bookingStatus'='cancelled'then return jsonb_build_object('status','cancelled');end if;
 -- Starts still key historical marks and steps, but do not identify arrangement changes.
 -- A stored receipt returned earlier, so exact replay remains safe after replacement.
 if p_command->>'arrangementToken'is distinct from arrangement_token then return jsonb_build_object('status','stale');end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 if expected is distinct from(select revision from public.patient_clinical_cases where user_id=m)then return jsonb_build_object('status','stale');end if;
 items:=public._nurse_visit_items_marked(src,sid);
 if not exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'
  and(all_pending or x->>'testId'=p_command->>'testId'))then return jsonb_build_object('status','stale');end if;
 for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
  and case when all_pending then x#>>'{mark,collectionStatus}'is null else x->>'testId'=p_command->>'testId'end loop
  insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name,collection_status)
   values(m,src,sid,i->>'key',all_pending or st='collected',case when all_pending then null else reason end,null,null,
    gen_random_uuid(),s.user_id,s.display_name,case when all_pending then 'collected'else st end)returning id into mid;
  -- Fixed text and internal IDs only: reasons remain solely in the protected immutable mark.
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','collection','source',src,'sourceId',sid,
    'item',i->>'key','collectionStatus',case when all_pending then 'collected'else st end,'markId',mid,'submissionId',sub));
 end loop;
 items:=public._nurse_visit_items_marked(src,sid);
 if not exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'is null)
  and exists(select 1 from jsonb_array_elements(items)x where x->>'kind'='sample'and x#>>'{mark,collectionStatus}'='collected')
  and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 insert into public.nurse_visit_collection_receipts(member_id,submission_id,source,source_id,arrangement,command,result,actor_id,actor_name,session_id,channel,binding_id,binding_generation)
  values(m,sub,src,sid,(v->>'startsAt')::timestamptz,canonical,jsonb_build_object('status','saved','submissionId',sub,'replayed',false),
   s.user_id,s.display_name,case when p_binding is null then(auth.jwt()->>'session_id')::uuid end,
   case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 -- A stored replay returned above. Confirm-all with no pending samples writes no mark.
 -- Corrections after the first notice share its event key and cannot notify again.
 if mid is not null then
  begin
   perform public._sample_collected_notice(m,src,sid,(v->>'startsAt')::timestamptz,items);
  exception when others then
   -- IDs and SQLSTATE only. The receipt and collection stay saved if the notice fails.
   begin perform public._member_notice_trace(m,'member.samples_collected','samples.collected:'||src||':'||sid::text||':'||extract(epoch from (v->>'startsAt')::timestamptz)::text,'care','failed',lower(sqlstate));exception when others then null;end;
  end;
 end if;
 return jsonb_build_object('status','saved','submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;

-- Retire the old results-ready Telegram card route too. Plan notices keep their cards.
create or replace function public._zoe_chat_card_for_template(t text)returns text
language sql immutable set search_path=''as $$
 select case t when 'member.reminder_medicine'then 'dose' when 'member.reminder_bp_week'then 'bp' when 'member.medicine_ask'then 'ask'
  when 'member.plan_ready'then 'plan' when 'member.plan_updated'then 'plan'
  when 'member.ldl_retest_due'then 'ldl' when 'member.ldl_retest_overdue'then 'ldl' when 'member.ldl_result_with_doctor'then 'ldl' end
$$;
