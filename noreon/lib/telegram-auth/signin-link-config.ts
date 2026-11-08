import 'server-only';
import {telegramAuthEnabled} from './runtime';

type Env=Record<string,string|undefined>;
/**
 * One-tap sign-in links from the bot (dark). The origin is the member app, set explicitly; outside production a
 * local http origin may stand in. Requires Telegram sign-in itself to be on.
 */
export function signinLinkOrigin(env:Env=process.env):string|null{
 if(env.NOREON_TELEGRAM_SIGNIN_LINKS_ENABLED!=='true'||!telegramAuthEnabled(env))return null;
 // No default: an environment never sends links to another environment's app.
 const raw=env.NOREON_MEMBER_APP_ORIGIN;if(!raw)return null;
 try{const u=new URL(raw);
  const ok=u.protocol==='https:'||(env.NODE_ENV!=='production'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));
  return ok&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username?u.origin:null;}catch{return null;}
}
