/** Server opt-in only. Every other value, including an absent flag, stays off. */
export const adminChatEnabled=(env:Readonly<Record<string,string|undefined>>=process.env)=>env.NOREON_ADMIN_CHAT==='true';
