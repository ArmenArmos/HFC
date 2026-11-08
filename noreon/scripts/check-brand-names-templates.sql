-- Brand names and Russian in stored copy (20261108064222_brand_names_ru_templates.sql, WP B). Rolled back.
-- Armenian template wording names «Զոյա» and «Նորեոն Հելթ»; Russian rows say «Зоя» and «Нореон Хелс»; every
-- member-facing template has a Russian row that stays an unapproved draft; the locale check accepts Russian.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
-- The Armenian lines of a body (bilingual bodies keep their English line).
create function pg_temp.hy_lines(s text)returns text language sql immutable as $$
 select coalesce(string_agg(l,E'\n'),'')from regexp_split_to_table(s,E'\n')l where l ~ '[Ա-ֆ]'$$;

-- Safety wording (zoe.urgent and every template carrying the 103 line) is left to its copy and clinical owner.
create function pg_temp.safety(p text)returns boolean language sql stable as $$
 select p='zoe.urgent'or exists(select 1 from public.system_message_templates x where x.template_id=p and x.body like '%103%')$$;

-- 1. Latest Armenian wording of every template that was not already approved, safety wording aside.
select pg_temp.ok(not exists(
 select 1 from(select distinct on(template_id)* from public.system_message_templates where locale='hy'order by template_id,version desc)t
 where not t.approved and not pg_temp.safety(t.template_id) and pg_temp.hy_lines(t.body) ~ '(Noreon|Zoe|Զոի|Զոե)'),
 'latest unapproved Armenian templates use Զոյա and Նորեոն Հելթ');
select pg_temp.ok(not exists(select 1 from public.system_message_templates where approval_note like 'Brand name%'and pg_temp.safety(template_id)),
 'no brand-name version supersedes urgent or 103 wording');
select pg_temp.ok((select max(version)from public.system_message_templates where template_id='zoe.urgent'and locale='hy')
 =(select max(version)from public.system_message_templates where template_id='zoe.urgent'and locale='en'),'zoe.urgent keeps one version number for hy and en');
-- A renamed template has one latest version number for every locale whose latest version was unapproved.
select pg_temp.ok(not exists(select 1 from public.system_message_templates n
 join lateral(select distinct on(x.locale)x.* from public.system_message_templates x where x.template_id=n.template_id order by x.locale,x.version desc)o on true
 where n.locale='hy'and n.approval_note like 'Brand names only%'and not o.approved and o.version<>n.version),
 'renamed templates: one version number across locales');
select pg_temp.ok((select body from public.system_message_templates where template_id='member.plan_ready'and locale='en'order by version desc limit 1)
 =(select body from public.system_message_templates where template_id='member.plan_ready'and locale='en'and version=1),'the English copy at the new number is unchanged');
select pg_temp.ok((select body from public.system_message_templates where template_id='member.medicine_ask'and locale='hy'order by version desc limit 1)
 like 'UNAPPROVED PLACEHOLDER. Զոյան է։%Նորեոն Հելթում%','the medicine question says «Զոյան» and «Նորեոն Հելթում»');
select pg_temp.ok((select body from public.system_message_templates where template_id='telegram.contact_ok'and locale='hy'order by version desc limit 1)
 like '%Նորեոն Հելթ։'||E'\n'||'Your number is confirmed. Go back to Noreon to continue.','a bilingual body keeps its English line');
select pg_temp.ok(not exists(select 1 from public.system_message_templates n
 join lateral(select * from public.system_message_templates p where p.template_id=n.template_id and p.locale=n.locale and p.version<n.version order by p.version desc limit 1)o on true
 where(n.approval_note like 'Brand name%'or n.approval_note like 'Unchanged copy of version%')and(n.approved or o.approved or n.free_body<>o.free_body
  or n.renderer_version is distinct from o.renderer_version or n.substitution_schema is distinct from o.substitution_schema)),
 'renamed versions supersede only unapproved ones and keep their renderer settings');

-- 2. Russian rows: native names, unapproved drafts, one per member-facing template.
select pg_temp.ok(not exists(select 1 from(select distinct on(template_id)* from public.system_message_templates where locale='ru'order by template_id,version desc)t
 where t.body ~ '(Noreon|Zoe)'),'latest Russian templates say Нореон Хелс and Зоя');
select pg_temp.ok(not exists(select 1 from public.system_message_templates where approval_note='Russian draft (WP B); awaits the copy owner.'
 and(approved or (body not like 'UNAPPROVED PLACEHOLDER. %'and template_id<>'telegram.share_contact_label'))),'Russian drafts are unapproved placeholders');
select pg_temp.ok(not exists(select 1 from(select distinct template_id from public.system_message_templates
  where template_id like 'member.%'or template_id like 'member_notice.%'or template_id like 'booking.%'
   or(template_id like 'telegram.%'and template_id not like 'telegram.staff%'))m
 where not exists(select 1 from public.system_message_templates r where r.template_id=m.template_id and r.locale='ru')),
 'every member-facing template has a Russian row');
-- Placeholders survive translation: each {name} in the English body appears in the Russian one.
select pg_temp.ok(not exists(select 1 from public.system_message_templates r
 join lateral(select body from public.system_message_templates e where e.template_id=r.template_id and e.locale='en'order by e.version desc limit 1)e on true
 cross join lateral regexp_matches(e.body,'\{[a-z_]+\}','g')p(m)
 where r.approval_note='Russian draft (WP B); awaits the copy owner.'and position(p.m[1] in r.body)=0),'Russian drafts keep every placeholder');

-- 3. The locale check accepts Russian for any template and nothing else.
insert into public.system_message_templates(template_id,version,locale,body)values('synthetic.brand_check',1,'ru','Синтетический текст.');
select pg_temp.ok(exists(select 1 from public.system_message_templates where template_id='synthetic.brand_check'),'ru is a template locale');
do $$begin
 insert into public.system_message_templates(template_id,version,locale,body)values('synthetic.brand_check',1,'fr','Texte synthétique.');
 raise exception 'FAIL: fr accepted as a template locale';
exception when check_violation then null;end$$;

-- Russian drafts sit at the template's newest version number.
select pg_temp.ok(not exists(select 1 from public.system_message_templates r where r.approval_note='Russian draft (WP B); awaits the copy owner.'
 and r.version<>(select max(x.version)from public.system_message_templates x where x.template_id=r.template_id and x.locale in('hy','en'))),
 'Russian drafts share the newest version number');

-- 4. Functions: the doctor-mode line names Զոյա/Зоя; the worker context passes Russian through.
select pg_temp.ok(pg_get_functiondef('public._zoe_mode_notify'::regproc) like '%Զոյան կրկին ձեզ հետ է։%'
 and pg_get_functiondef('public._zoe_mode_notify'::regproc) like '%Зоя снова с вами.%'
 and pg_get_functiondef('public._zoe_mode_notify'::regproc) not like '%Zoe-ն%','doctor-mode line uses the native names');
select pg_temp.ok(pg_get_functiondef('public._zoe_text_enqueue'::regproc) like '%''Զոյա՝ ''%'and pg_get_functiondef('public._zoe_text_enqueue'::regproc) like '%''Зоя: ''%'
 and pg_get_functiondef('public._zoe_mode_notify'::regproc) like '%''Զոյա՝ ''%','Telegram signature in the template language');
select pg_temp.ok(not has_function_privilege('service_role','public._zoe_text_enqueue(uuid,uuid,text,text)','execute'),'text enqueue stays internal');
select pg_temp.ok(pg_get_functiondef('public.zoe_run_context'::regproc) like '%pr.ui_locale=''ru''then ''ru''%','zoe_run_context returns ru for a Russian screen');
select pg_temp.ok(not has_function_privilege('authenticated','public._zoe_mode_notify(uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.zoe_run_context(uuid[])','execute'),'function grants unchanged');

rollback;
\echo 'check-brand-names-templates: ok'
