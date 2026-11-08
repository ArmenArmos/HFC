-- WP B: brand names in stored copy, and Russian for member-facing templates.
--
-- 1. Armenian copy names the assistant «Զոյա» and the service «Նորեոն Հելթ» (lib/brand.ts ZOE_HY, NOREON_HY).
--    Template versions are immutable (_template_frozen), so each Armenian template whose latest version still
--    says Latin "Noreon"/"Zoe" or «Զոի»/«Զոե» gets a new version; lookups take the latest version per locale.
--    Only unapproved versions are superseded: an approved wording is never replaced by an unapproved one here
--    (that would hold its messages at claim); those are listed with a notice for the copy owner instead.
--    Safety wording is left to its owner too: zoe.urgent and every template that carries the 103 emergency line keep
--    their versions (a notice names them), so an approval of "version N" for every locale still releases the
--    Armenian 103 text together with the English one.
--    The new version number is the template's highest version + 1, and every other locale whose latest version is
--    unapproved gets an unchanged copy at that same number (Russian with «Нореон Хелс»), so "approve version N"
--    covers all locales of a template. Bilingual bodies ("Armenian line\nEnglish line") change only their Armenian lines.
-- 2. system_message_templates.locale accepts 'ru' for every template, and member-facing templates get Russian
--    rows marked 'UNAPPROVED PLACEHOLDER.' with approved=false, at the template's current highest version. Nothing
--    sends them until approved: _member_notice_locale already falls back to English for a Russian reader until the
--    Russian row is approved, and Telegram system messages still follow profiles.locale (hy/en), which is unchanged.
-- 3. Zoe's Telegram signature follows the template locale: «Զոյա՝ » (hy), «Зоя: » (ru), "Zoe: " (en), in
--    _zoe_text_enqueue (latest definition 20261018121002_zoe_warm_replies.sql) and _zoe_mode_notify (latest
--    20261020082321_zoe_doctor_takeover.sql), whose member line also says «Զոյան»/«Зоя». Same as
--    lib/brand.ts zoeSignature(), which signs the Telegram cards.
-- 4. zoe_run_context passes Russian through (see below).
-- The Zoe consent wording switch to zoe-consent-draft-3 is NOT made here: migrations go live before the app, and the
-- running app still offers draft-2. It is an operator step after the app deploy (docs/operations/staging-ai-mode.sql 0c).

alter table public.system_message_templates drop constraint system_message_templates_locale_check;
alter table public.system_message_templates add constraint system_message_templates_locale_check
 check(locale in('en','hy','ru'));

-- Armenian brand names for one line of Armenian text. Longest case endings first.
create function pg_temp.brand_hy_line(s text)returns text language sql immutable as $$
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  s,
  'Noreon(?: Health)?-ում','Նորեոն Հելթում','g'),
  'Noreon(?: Health)?-ին','Նորեոն Հելթին','g'),
  'Noreon(?: Health)?-ից','Նորեոն Հելթից','g'),
  'Noreon(?: Health)?-ով','Նորեոն Հելթով','g'),
  'Noreon(?: Health)?-ի','Նորեոն Հելթի','g'),
  'Noreon(?: Health)?-[ըն]','Նորեոն Հելթը','g'),
  'Noreon(?: Health)?','Նորեոն Հելթ','g'),
  'Zoe-ին','Զոյային','g'),
  'Zoe-ից','Զոյայից','g'),
  'Zoe-ով','Զոյայով','g'),
  'Zoe-ի','Զոյայի','g'),
  'Zoe-[նը]','Զոյան','g'),
  'Zoe','Զոյա','g'),
  'Զոիին','Զոյային','g'),
  'Զոին','Զոյան','g'),
  'Զոեի','Զոյայի','g'),
  'Զոեն','Զոյան','g'),
  'Զո[եի](?![ա-ֆ])','Զոյա','g')
$$;
-- Whole body: only lines with Armenian letters change.
create function pg_temp.brand_hy(s text)returns text language sql immutable as $$
 select string_agg(case when l ~ '[Ա-ֆ]' then pg_temp.brand_hy_line(l) else l end,E'\n' order by n)
 from regexp_split_to_table(s,E'\n') with ordinality as x(l,n)
$$;

-- Armenian templates to rename: latest Armenian version unapproved and still using the old names, not safety wording.
create temp table brand_hy_targets as
select t.template_id,t.version as hy_version,
 (select max(x.version)from public.system_message_templates x where x.template_id=t.template_id)+1 as new_version
from(select distinct on(template_id)* from public.system_message_templates where locale='hy'order by template_id,version desc)t
where not t.approved and pg_temp.brand_hy(t.body)<>t.body
 and t.template_id<>'zoe.urgent'
 and not exists(select 1 from public.system_message_templates x where x.template_id=t.template_id and x.body like '%103%');

do $$
declare r record;
begin
 for r in select distinct on(t.template_id) t.template_id,t.version,t.approved,t.body
  from public.system_message_templates t where t.locale='hy'
  order by t.template_id,t.version desc
 loop
  if pg_temp.brand_hy(r.body)<>r.body and not exists(select 1 from brand_hy_targets b where b.template_id=r.template_id)then
   if r.approved then
    raise notice 'Approved Armenian template % v% still uses the old brand names; needs a new approved version',r.template_id,r.version;
   else
    raise notice 'Safety template % v% (103 or urgent wording) still uses the old brand names; left to its copy and clinical owner',r.template_id,r.version;
   end if;
  end if;
 end loop;
end$$;

insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note,free_body,renderer_version,substitution_schema,clinical_copy_version)
select t.template_id,b.new_version,t.locale,pg_temp.brand_hy(t.body),false,
 'Brand names only (Զոյա, Նորեոն Հելթ); wording otherwise as version '||t.version||'.',
 t.free_body,t.renderer_version,t.substitution_schema,t.clinical_copy_version
from brand_hy_targets b join public.system_message_templates t on t.template_id=b.template_id and t.version=b.hy_version and t.locale='hy';

-- The other locales of those templates, at the same version number when their latest version is unapproved
-- (an approved English or Russian wording is never superseded by an unapproved copy).
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note,free_body,renderer_version,substitution_schema,clinical_copy_version)
select t.template_id,b.new_version,t.locale,case t.locale when 'ru'then replace(t.body,'Noreon','Нореон Хелс')else t.body end,false,
 case when t.locale='ru'and t.body like '%Noreon%'then 'Brand name only (Нореон Хелс); wording otherwise as version '||t.version||'.'
  else 'Unchanged copy of version '||t.version||', at the version number of the Armenian brand-name version.'end,
 t.free_body,t.renderer_version,t.substitution_schema,t.clinical_copy_version
from brand_hy_targets b
join lateral(select distinct on(x.locale)x.* from public.system_message_templates x where x.template_id=b.template_id and x.locale<>'hy'
 order by x.locale,x.version desc)t on true
where not t.approved;
drop table brand_hy_targets;

-- Russian: any latest Russian row still saying "Noreon" outside the renamed templates is named for the copy owner.
do $$
declare r record;
begin
 for r in select distinct on(template_id) template_id,version from public.system_message_templates where locale='ru'order by template_id,version desc
 loop
  if exists(select 1 from public.system_message_templates t where t.template_id=r.template_id and t.version=r.version and t.locale='ru'and t.body like '%Noreon%')then
   raise notice 'Russian template % v% still says Noreon; needs a new version from the copy owner',r.template_id,r.version;
  end if;
 end loop;
end$$;

-- Russian drafts for the member-facing templates without Russian, at the template's highest version.
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)
select v.template_id,(select max(t.version)from public.system_message_templates t where t.template_id=v.template_id),'ru',v.body,false,'Russian draft (WP B); awaits the copy owner.'
from(values
 ('booking.clinic_proposal','UNAPPROVED PLACEHOLDER. Ваша клиника предложила новое время визита. Откройте Нореон Хелс, чтобы принять или отклонить его.'),
 ('member.booking_cancelled','UNAPPROVED PLACEHOLDER. Ваш визит {date} в {time} отменён. Откройте Нореон Хелс, чтобы посмотреть подробности или выбрать новое время.'),
 ('member.booking_confirmed','UNAPPROVED PLACEHOLDER. Ваш визит подтверждён: {date} в {time}, {clinic}. Как подготовиться, смотрите в Нореон Хелс.'),
 ('member.booking_declined','UNAPPROVED PLACEHOLDER. Клиника не смогла принять выбранное вами время визита. Откройте Нореон Хелс, чтобы выбрать другое время.'),
 ('member.booking_rescheduled','UNAPPROVED PLACEHOLDER. У вашего визита новое время: {date} в {time}, {clinic}. Как подготовиться, смотрите в Нореон Хелс.'),
 ('member.consultation_clinic','UNAPPROVED PLACEHOLDER. Ваша консультация назначена на {date} в {time}, {clinic}.'),
 ('member.consultation_needed','UNAPPROVED PLACEHOLDER. Ваш врач хотел бы поговорить с вами. Нореон Хелс свяжется с вами, чтобы согласовать время.'),
 ('member.consultation_phone','UNAPPROVED PLACEHOLDER. Ваш врач позвонит вам {date} примерно в {time}.'),
 ('member.document_released','UNAPPROVED PLACEHOLDER. В Нореон Хелс для вас готов новый результат.'),
 ('member.home_arranged','UNAPPROVED PLACEHOLDER. Ваш визит на дом назначен на {date}, с {time} до {end_time}. Ваша медсестра: {nurse}.'),
 ('member.home_arranged_plain','UNAPPROVED PLACEHOLDER. Ваш визит на дом назначен на {date}, с {time} до {end_time}.'),
 ('member.home_received','UNAPPROVED PLACEHOLDER. Мы получили вашу заявку на визит на дом. Нореон Хелс свяжется с вами, чтобы согласовать время.'),
 ('member.ldl_result_with_doctor','UNAPPROVED PLACEHOLDER. Ваш новый результат анализа у вашего врача. Врач сообщит вам следующий шаг.'),
 ('member.ldl_retest_due','UNAPPROVED PLACEHOLDER. Ваш врач назначил повторный анализ крови начиная с {date}. Наша команда позвонит вам, чтобы договориться о визите медсестры на дом.'),
 ('member.ldl_retest_overdue','UNAPPROVED PLACEHOLDER. Повторный анализ крови ещё не сдан. Наша команда позвонит вам, чтобы найти удобное время. Подробности также есть в Нореон Хелс.'),
 ('member.medicine_ask','UNAPPROVED PLACEHOLDER. Это Зоя. Один из приёмов лекарства не отмечен в Нореон Хелс. Если что-то помешало, можно сказать мне одним касанием. Ничего страшного, так бывает.'),
 ('member.plan_ready','UNAPPROVED PLACEHOLDER. Ваш план лечения готов. Откройте Нореон Хелс, чтобы прочитать его.'),
 ('member.plan_updated','UNAPPROVED PLACEHOLDER. Ваш план лечения обновлён. Откройте Нореон Хелс, чтобы посмотреть, что изменилось.'),
 ('member.programme_month3_open','UNAPPROVED PLACEHOLDER. Скоро ваша проверка за 3-й месяц. Откройте Нореон Хелс и ответьте на три коротких вопроса для вашего врача.'),
 ('member.programme_month6_open','UNAPPROVED PLACEHOLDER. Скоро ваша проверка за 6-й месяц. Откройте Нореон Хелс и ответьте на три коротких вопроса для вашего врача.'),
 ('member.programme_plan_confirmed','UNAPPROVED PLACEHOLDER. Ваш врач посмотрел ваш прогресс. Ваш план лечения остаётся прежним. Откройте Нореон Хелс, чтобы прочитать заметку.'),
 ('member.programme_week4_open','UNAPPROVED PLACEHOLDER. Скоро ваш обзор за 4-ю неделю. Откройте Нореон Хелс и ответьте на три коротких вопроса для вашего врача.'),
 ('member.reminder_bp_week','UNAPPROVED PLACEHOLDER. Сейчас {time}: время для двух ваших измерений. Сохраните их в Нореон Хелс.'),
 ('member.reminder_home_soon','UNAPPROVED PLACEHOLDER. Напоминание: медсестра придёт к вам сегодня с {time} до {end_time}.'),
 ('member.reminder_home_tomorrow','UNAPPROVED PLACEHOLDER. Напоминание: ваш визит на дом завтра, {date}, с {time} до {end_time}.'),
 ('member.reminder_medicine','UNAPPROVED PLACEHOLDER. Сейчас {time}, время, которое вы выбрали для своего распорядка дня. Отметьте это в Нореон Хелс, когда сделаете.'),
 ('member.reminder_visit_soon','UNAPPROVED PLACEHOLDER. Напоминание: ваш визит сегодня в {time}, {clinic}.'),
 ('member.reminder_visit_tomorrow','UNAPPROVED PLACEHOLDER. Напоминание: ваш визит завтра, {date} в {time}, {clinic}. Как подготовиться, смотрите в Нореон Хелс.'),
 ('member.request_cancelled','UNAPPROVED PLACEHOLDER. Ваша заявка на визит отменена. Откройте Нореон Хелс, чтобы посмотреть подробности или подать новую заявку.'),
 ('member.results_received','UNAPPROVED PLACEHOLDER. Ваши результаты получены. Откройте Нореон Хелс, чтобы увидеть следующий шаг.'),
 ('member.samples_at_lab','UNAPPROVED PLACEHOLDER. Ваши образцы доставлены в лабораторию. Мы сообщим вам, когда придут результаты.'),
 ('member_notice.push','UNAPPROVED PLACEHOLDER. У вас есть новости в Нореон Хелс.'),
 ('telegram.ack','UNAPPROVED PLACEHOLDER. Мы получили ваше сообщение и передали его вашей медицинской команде. Если ваша медицинская команда ответит, ответ придёт в этот чат. Этот чат не для экстренных случаев. Если вы считаете, что вам может угрожать опасность, сразу звоните 103.'),
 ('telegram.binding_replaced','UNAPPROVED PLACEHOLDER. Ваша учётная запись Нореон Хелс привязана к другой учётной записи Telegram. Если это были не вы, обратитесь в Нореон Хелс.'),
 ('telegram.contact_ok','UNAPPROVED PLACEHOLDER. Ваш номер подтверждён. Вернитесь в приложение Нореон Хелс, чтобы продолжить.'),
 ('telegram.contact_refused','UNAPPROVED PLACEHOLDER. Не удалось подтвердить этот номер. Откройте Нореон Хелс и попробуйте ещё раз.'),
 ('telegram.link_confirmed','UNAPPROVED PLACEHOLDER. Ваша учётная запись Нореон Хелс теперь привязана к этому чату. Можно вернуться в приложение. Если ваша медицинская команда ответит, ответ придёт сюда. Этот чат не для экстренных случаев. Если вы считаете, что вам может угрожать опасность, сразу звоните 103.'),
 ('telegram.link_expired','UNAPPROVED PLACEHOLDER. Эта ссылка больше не работает. Начните заново в приложении Нореон Хелс.'),
 ('telegram.media_to_app','UNAPPROVED PLACEHOLDER. Здесь мы можем читать только текстовые сообщения, а не фото, голосовые сообщения, файлы или подписи к ним. Чтобы отправить заключение или фото, откройте «Прогресс» в приложении Нореон Хелс и выберите «Добавить предыдущие результаты». Этот чат не для экстренных случаев. Если вы считаете, что вам может угрожать опасность, сразу звоните 103.'),
 ('telegram.next_profile','UNAPPROVED PLACEHOLDER. Чтобы написать вашей медицинской команде, сначала заполните профиль: https://app.noreon.health/patient/profile В экстренном случае звоните 103.'),
 ('telegram.next_questionnaire','UNAPPROVED PLACEHOLDER. Чтобы написать вашей медицинской команде, сначала заполните анкету о здоровье: https://app.noreon.health/patient/questions В экстренном случае звоните 103.'),
 ('telegram.next_review','UNAPPROVED PLACEHOLDER. Чтобы написать вашей медицинской команде, отправьте запрос на рассмотрение: https://app.noreon.health/patient/review В экстренном случае звоните 103.'),
 ('telegram.ready','UNAPPROVED PLACEHOLDER. Здесь можно написать вашей медицинской команде. В экстренном случае звоните 103.'),
 ('telegram.replies_auto_linked','UNAPPROVED PLACEHOLDER. Ответы вашей медицинской команды будут приходить в этот чат. Это можно отключить в профиле Нореон Хелс.'),
 ('telegram.replies_off','UNAPPROVED PLACEHOLDER. Ответы в Telegram отключены. Включите их здесь: https://app.noreon.health/patient/account/telegram В экстренном случае звоните 103.'),
 ('telegram.share_contact','UNAPPROVED PLACEHOLDER. Чтобы подтвердить, что это ваш номер, нажмите кнопку ниже и поделитесь своим номером телефона с Нореон Хелс.'),
 ('telegram.share_contact_label','Поделиться моим номером'),
 ('telegram.signup','UNAPPROVED PLACEHOLDER. Чтобы начать, откройте https://app.noreon.health/patient и войдите по своему номеру телефона. В экстренном случае звоните 103.'),
 ('telegram.unsupported_media','UNAPPROVED PLACEHOLDER. Здесь мы можем читать только текстовые сообщения, а не фото, голосовые сообщения, файлы или подписи к ним. Пожалуйста, напишите сообщение текстом. Этот чат не для экстренных случаев. Если вы считаете, что вам может угрожать опасность, сразу звоните 103.')
)v(template_id,body)
where exists(select 1 from public.system_message_templates t where t.template_id=v.template_id)
 and not exists(select 1 from public.system_message_templates t where t.template_id=v.template_id and t.locale='ru');

-- Zoe's Telegram texts (answers, warm replies, receipts) are signed in the template's language: «Զոյա՝ » (Armenian
-- uses the abbreviation mark as the label colon), «Зоя: », "Zoe: ". Everything else as 20261018121002_zoe_warm_replies.sql.
-- CREATE OR REPLACE keeps the existing internal-only grants.
create or replace function public._zoe_text_enqueue(m uuid,p_inbox uuid,p_body0 text,p_template text)returns uuid
language plpgsql security definer set search_path=''as $$
declare l text;t public.system_message_templates;ep public.conversation_endpoints;new_id uuid;p_body text;
begin
 select e.* into ep from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id where i.id=p_inbox;
 if not found or ep.member_id<>m or not ep.active then return null;end if;
 select coalesce((select locale from public.profiles where id=m),'hy')into l;
 select * into t from public.system_message_templates where template_id=p_template and locale=l and free_body order by version desc limit 1;
 if not found then return null;end if;
 -- On Telegram, Zoe's texts are signed so they are never mistaken for the doctor's replies
 -- (Khikar 18 Oct: "like Zoe is answering, just through Telegram"). The app thread labels them itself.
 p_body:=case t.locale when 'hy'then 'Զոյա՝ 'when 'ru'then 'Зоя: 'else 'Zoe: 'end||p_body0;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,source_inbox_id)
 values(m,t.template_id,t.version,t.locale,p_body,public._system_message_hash(t.template_id,t.version,t.locale,p_body),ep.id,ep.generation,p_inbox)
 on conflict(source_inbox_id,template_id)do nothing returning system_messages.id into new_id;
 if new_id is not null then perform public._system_message_audit(new_id,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));end if;
 return new_id;
end$$;
revoke all on function public._zoe_text_enqueue(uuid,uuid,text,text)from public,anon,authenticated,service_role;

-- The member's doctor-mode line: brand names and the Telegram signature in the template's language; everything else
-- as 20261020082321_zoe_doctor_takeover.sql.
-- CREATE OR REPLACE keeps the existing internal-only grants.
create or replace function public._zoe_mode_notify(p_conversation uuid,m uuid,p_kind text,p_at timestamptz)returns uuid
language plpgsql security definer set search_path=''as $$
declare lang text;loc text;body text;sig text;nid uuid;pol public.conversation_policy;ep public.conversation_endpoints;t public.system_message_templates;smid uuid;
begin
 loc:=coalesce((select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=m),'hy');
 lang:=coalesce((select a.language from public.zoe_member_answers a where a.conversation_id=p_conversation order by a.created_at desc,a.id desc limit 1),loc);
 body:=case p_kind
  when 'doctor_on'then case lang when 'en'then 'Your doctor is answering you now.'when 'ru'then 'Сейчас вам отвечает ваш врач.'else 'Այժմ ձեզ պատասխանում է ձեր բժիշկը։'end
  else case lang when 'en'then 'Zoe is with you again.'when 'ru'then 'Зоя снова с вами.'else 'Զոյան կրկին ձեզ հետ է։'end end;
 insert into public.zoe_mode_notices(conversation_id,member_id,kind,body,language,created_at)values(p_conversation,m,p_kind,body,lang,p_at)returning id into nid;
 -- Telegram, when the member has an active route (the same route a doctor's reply takes). Approval is checked again at claim.
 select * into pol from public.conversation_policy where singleton;
 select e.* into ep from public.conversation_endpoints e where e.member_id=m and e.active and e.adapter='telegram'and e.expires_at>clock_timestamp()
  and e.policy_version=pol.version order by e.id limit 1;
 if ep.id is not null then
  select * into t from public.system_message_templates where template_id='zoe.mode'and locale=loc and free_body order by version desc limit 1;
  if found then
   sig:=case t.locale when 'hy'then 'Զոյա՝ 'when 'ru'then 'Зоя: 'else 'Zoe: 'end;
   insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation)
   values(m,t.template_id,t.version,t.locale,sig||body,public._system_message_hash(t.template_id,t.version,t.locale,sig||body),ep.id,ep.generation)returning id into smid;
   perform public._system_message_audit(smid,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));
   update public.zoe_mode_notices set system_message_id=smid where id=nid;
  end if;
 end if;
 return nid;
end$$;
revoke all on function public._zoe_mode_notify(uuid,uuid,text,timestamptz)from public,anon,authenticated,service_role;

-- 4. The Zoe worker's conversation locale includes Russian: a member whose screen language is Russian
--    (profiles.ui_locale='ru', stored with locale='hy') gets 'ru', so a message with no words of its own
--    ("128/82") is answered in Russian. Clinical text is unaffected: clinicalLocale() still maps ru to hy in the
--    app, and profiles.locale is unchanged. Latest definition: 20261019210625_zoe_member_daily_cap.sql; only the
--    'locale' entry changes. CREATE OR REPLACE keeps the existing service-role-only grants.
create or replace function public.zoe_run_context(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select conversational_replies_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,
   'doctorName',(select ws.display_name from public.patient_clinical_cases cs join public.workspace_staff ws on ws.user_id=cs.assigned_doctor_id and ws.active and ws.removed_at is null
     where cs.user_id=r.member_id limit 1),
   -- Abuse limits: the member's Zoe spend today and the runs with a suspected injection in 24 hours.
   'memberSpentTodayUsd',coalesce((select sum(coalesce(z.cost_usd,z.estimate_usd))from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day),0),
   'memberDailyCapUsd',(select least(coalesce(s.member_daily_cap_usd,3.00),least(coalesce(s.daily_spend_cap_usd,0),10))from public.zoe_settings s where s.singleton),
   'injectionsLast24h',(select count(*)from public.zoe_runs z where z.member_id=r.member_id and z.id<>r.id and z.state='finished'and z.finished_at>clock_timestamp()-interval '24 hours'
     and z.injection_detected),
   'locale',(select case when pr.ui_locale='ru'then 'ru'when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),
   'answeredThroughSeq',greatest(
     coalesce((select max(a.message_seq)from public.zoe_member_answers a where a.conversation_id=r.conversation_id),0),
     coalesce((select max(ap.context_version)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id),0))))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
