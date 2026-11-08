/** Server entry points opt in; absent and every other value stay off. */
export const nurseChatEnabled=(env:Readonly<Record<string,string|undefined>>=process.env)=>env.NOREON_NURSE_CHAT==='true';
/** The chat built from zero. Its parent flag stays required. */
export const nurseChatV2Enabled=(env:Readonly<Record<string,string|undefined>>=process.env)=>nurseChatEnabled(env)&&env.NOREON_NURSE_CHAT_V2==='true';
/** The new chat has the plain address. Any query still opens the previous screen, so existing links keep working. */
export const nurseChatNewScreen=(query:Readonly<Record<string,unknown>>,env:Readonly<Record<string,string|undefined>>=process.env)=>nurseChatV2Enabled(env)&&!Object.keys(query).length;
/** A fragment keeps Today in V2; a query would select the previous screen. */
export const nurseTodayHref=(env:Readonly<Record<string,string|undefined>>=process.env)=>nurseChatV2Enabled(env)?'/staff/real/nurse-chat#today':'/staff/real/nurse-chat';
