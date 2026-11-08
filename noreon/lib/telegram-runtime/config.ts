import 'server-only';
import type {TelegramWebhookConfig} from '@/lib/telegram-channel/ingress';
import type {TelegramOutboundConfig} from '@/lib/telegram-channel/outbound';
import type {TelegramBot} from '@/lib/telegram-channel/protocol';

type Env=Record<string,string|undefined>;

/**
 * Kill switch. Everything Telegram is off unless NOREON_TELEGRAM_ENABLED is exactly
 * "true": the webhook answers 503 without reading a body, the dispatcher sends
 * nothing and the member card is hidden. The database is separately fail-closed
 * (no channel settings row, conversation_policy.delivery_enabled, unapproved text).
 */
export const telegramEnabled=(env:Env=process.env)=>env.NOREON_TELEGRAM_ENABLED==='true';

/** Nurse details require this gate and the independent, default-off database switch. */
export const nurseTelegramEnabled=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_NURSE_TELEGRAM_ENABLED==='true';

/** The configured bot namespace, or null. Renaming account or bot ID orphans existing links (G6). */
export function telegramBot(env:Env=process.env):TelegramBot|null{
 const account=env.NOREON_TELEGRAM_ACCOUNT,botId=Number(env.NOREON_TELEGRAM_BOT_ID);
 if(!account||!/^[A-Za-z0-9_-]{1,64}$/.test(account)||!Number.isSafeInteger(botId)||botId<1)return null;
 return Object.freeze({account,botId});
}
export const telegramAccountRef=(bot:TelegramBot)=>JSON.stringify([bot.account,bot.botId]);

/** Public bot username for the t.me deep link; not a secret. */
export function telegramBotUsername(env:Env=process.env){
 const name=env.NOREON_TELEGRAM_BOT_USERNAME;
 return name&&/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)?name:null;
}

export function webhookConfig(env:Env=process.env):TelegramWebhookConfig|undefined{
 const bot=telegramBot(env);
 if(!telegramEnabled(env)||!bot)return undefined;
 return {...bot,enabled:true,webhookSecret:env.NOREON_TELEGRAM_WEBHOOK_SECRET??'',maxBodyBytes:262_144,readTimeoutMs:5_000,commitTimeoutMs:8_000};
}

export function outboundConfig(env:Env=process.env):TelegramOutboundConfig|undefined{
 const bot=telegramBot(env);
 if(!telegramEnabled(env)||!bot)return undefined;
 return {...bot,enabled:true,botToken:env.NOREON_TELEGRAM_BOT_TOKEN??'',timeoutMs:10_000,maxResponseBytes:262_144};
}
