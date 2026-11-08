// The switches staging runs with, and the Telegram links the journeys start from. tgLink starts unlinked: that test links it the real way.
import { fixtureId as id, sql } from "../db.mjs";
import { BOT, chatOf, telegramPeople } from "./config.mjs";

const principal = (chat) => `["telegram","${BOT.account}",${BOT.id},"user",${chat}]`;
const account = `["${BOT.account}",${BOT.id}]`;
const members = Object.entries(telegramPeople).filter(([, p]) => p[2]);
const link = ([n]) => `select public._telegram_replies_activate('${id(n)}',(public._telegram_auth_bind('${id(n)}','member','${principal(chatOf(n))}','${account}',public._auth_phone('${id(n)}'),'${chatOf(n)}',null)->>'bindingId')::uuid);`;
sql(`begin;
insert into public.telegram_channel_settings(singleton,account,bot_id,link_token_seconds,consent_version) values(true,'${BOT.account}',${BOT.id},600,'telegram-replies-draft-1')
 on conflict(singleton) do update set account=excluded.account,bot_id=excluded.bot_id,link_token_seconds=excluded.link_token_seconds,consent_version=excluded.consent_version;
update public.conversation_policy set delivery_enabled=true,synthetic_engine=false,grant_seconds=3600,intake_window_seconds=60,intake_max_messages=50 where singleton;
-- The guards want passing model evaluations from this week. Nothing here reaches a model, so this local database skips them.
alter table public.zoe_settings disable trigger user;
insert into public.zoe_settings(singleton,consent_collection_enabled,daily_spend_cap_usd,consent_wording_version,consent_wording_also_valid,staging_ai_mode,model_calls_allowed)
 values(true,true,10,'zoe-consent-draft-3','{zoe-consent-draft-2}',true,true)
 on conflict(singleton) do update set consent_collection_enabled=true,daily_spend_cap_usd=10,consent_wording_version=excluded.consent_wording_version,consent_wording_also_valid=excluded.consent_wording_also_valid,staging_ai_mode=true,model_calls_allowed=true;
update public.zoe_settings set symptom_intake_enabled=true,conversational_replies_enabled=true,health_answers_enabled=true where singleton;
alter table public.zoe_settings enable trigger user;
insert into public.care_alert_settings(singleton,enabled,telegram_delivery) values(true,true,true) on conflict(singleton) do update set enabled=true,telegram_delivery=true;
update public.system_message_templates set approved=true where not approved;
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${id(telegramPeople.tgAdmin[0])}','admin','Admin Fictional Lusine','${id(20)}');
${members.map(([, [n]]) => `insert into public.zoe_consents(member_id,kind,granted,wording_version) values('${id(n)}','zoe_reads_messages',true,'zoe-consent-draft-2');`).join("\n")}
${members.filter(([name]) => name !== "tgLink").map(([, p]) => link(p)).join("\n")}
commit;`);
console.log("Seeded the Telegram channel and links");
