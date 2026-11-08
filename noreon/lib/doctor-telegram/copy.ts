import 'server-only';
/** Staging templates only. Armenian and English wording awaits the copy owner's approval. */
export const doctorTelegramTemplates={
 connected:{approved:false,placeholder:true,text:'Դուք միացված եք Noreon-ին։\nConnected to Noreon.'},
 reconnect:{approved:false,placeholder:true,text:'Կրկին միացրեք Telegram-ը հավելվածում։\nConnect Telegram again in the app.'},
 unavailable:{approved:false,placeholder:true,text:'Այս պահին կապը հասանելի չէ։ Շարունակեք հավելվածում։\nYour connection is temporarily unavailable. Continue in the app.'},
} as const;
export const doctorTelegramCopy={
 connected:doctorTelegramTemplates.connected.text,
 reconnect:doctorTelegramTemplates.reconnect.text,
 unavailable:doctorTelegramTemplates.unavailable.text,
};
