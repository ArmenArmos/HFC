import {z} from 'zod';

/** WP V: the shapes of the Noreon administrator's voice settings read and update (voice_settings_admin_read / _update). */
const model=z.string().trim().min(1).max(160);
export const voiceSettingsViewSchema=z.strictObject({enabled:z.boolean(),liveEnabled:z.boolean(),liveModel:z.string(),sttModel:z.string(),sttUrgentModel:z.string(),
 ttsModel:z.string(),ttsVoice:z.string(),version:z.number().int().positive(),updatedAt:z.string()});
export type VoiceSettingsView=z.infer<typeof voiceSettingsViewSchema>;
const historySchema=z.array(z.strictObject({at:z.string(),actorId:z.uuid(),fromVersion:z.number().int(),toVersion:z.number().int(),changed:z.array(z.string())}));
export type VoiceSettingsHistory=z.infer<typeof historySchema>;
export const readSchema=z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),settings:voiceSettingsViewSchema,history:historySchema}),z.strictObject({ok:z.literal(false),code:z.string()})]);
export const updateSchema=z.union([z.strictObject({ok:z.literal(true),replayed:z.boolean(),changed:z.boolean(),settings:voiceSettingsViewSchema}),
 z.strictObject({ok:z.literal(false),code:z.string(),settings:voiceSettingsViewSchema.optional()})]);
export const voiceSettingsPatchSchema=z.strictObject({enabled:z.boolean().optional(),live_enabled:z.boolean().optional(),
 live_model:z.string().trim().regex(/^(models\/)?[a-z0-9][a-z0-9.-]{2,79}$/).optional(),tts_voice:z.string().trim().min(1).max(80).optional(),
 stt_model:model.optional(),stt_urgent_model:model.optional(),tts_model:model.optional()}).refine(p=>Object.keys(p).length>0);
export type VoiceSettingsRead={status:'ok';settings:VoiceSettingsView;history:VoiceSettingsHistory}|{status:'access'|'unavailable'};
export type VoiceSettingsSave={status:'saved'|'unchanged';settings:VoiceSettingsView}|{status:'stale';settings?:VoiceSettingsView}|{status:'invalid'|'access'|'unavailable'};
