-- Zoe urgent text: never without "don't take any medicine" (lead 19 Oct 21:45, safety fix, fast-track). Armen's dataset (S023,
-- S029, S100) and Zoe spec v1 §9/§12: at the 103 level no medicine of any kind (aspirin is dangerous with a suspected aortic
-- dissection). The worker's urgent texts (lib/zoe/symptoms/intake.ts URGENT_TEXT, conversation.ts CRISIS_TEXT) carry the line
-- from this release; the fixed Telegram fallback template zoe.urgent gets the same line here as version 2.
-- Template versions are immutable and the newest version is the one sent, so version 2 carries over version 1's approval per
-- locale: on prod-as-staging (v1 approved by the staging step) the fallback keeps working with the new line; on a fresh
-- database (v1 unapproved) v2 stays unapproved, as v1 was. STAGING wording; Tatevik checks the Armenian.
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
select 'zoe.urgent',v1.version+1,v1.locale,
 v1.body||' '||case v1.locale when 'en'then 'Don''t take any medicine unless the ambulance team tells you to.'
  else 'Մի ընդունեք որևէ դեղ, քանի դեռ շտապօգնության բրիգադը չի ասել։'end,
 v1.free_body,v1.approved,
 case when v1.approved then 'Approval carried from version '||v1.version||' (safety line added, lead 19 Oct; STAGING wording, Tatevik HY)'
  else 'S1/S6 wording pending; safety line added 19 Oct'end
from(select distinct on(t.locale)t.* from public.system_message_templates t where t.template_id='zoe.urgent'order by t.locale,t.version desc)v1
where v1.body not like '%ambulance team tells you%'and v1.body not like '%շտապօգնության բրիգադը չի ասել%';
