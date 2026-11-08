/**
 * Gives the bot its "/menu" command, so Telegram shows the Menu button beside the message box. An operator step, once per bot,
 * on the TEST bot until go-live. It sends no message to anyone. It reads the token from the environment and never prints it:
 *   NOREON_TELEGRAM_BOT_TOKEN=... node scripts/telegram-set-commands.ts
 */
export {};
const token=process.env.NOREON_TELEGRAM_BOT_TOKEN;
if(!token)throw Error('Set NOREON_TELEGRAM_BOT_TOKEN.');
const line={hy:'Ինչ կարող եմ անել',en:'What I can do',ru:'Что я могу сделать'} as const;
for(const [code,description] of Object.entries(line)){
 const body={commands:[{command:'menu',description}],...(code==='hy'?{}:{language_code:code})};
 const r=await fetch(`https://api.telegram.org/bot${token}/setMyCommands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 console.log(code,r.status);
 if(!r.ok)process.exitCode=1;
}
