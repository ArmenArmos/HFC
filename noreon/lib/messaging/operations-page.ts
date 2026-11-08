/** Legacy SMS/WhatsApp operations page (Noreon is Telegram-only since 17 Oct 2026). Hidden unless this flag is exactly "true". */
export const messageOperationsPageEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_MESSAGE_OPERATIONS_ENABLED==='true';
