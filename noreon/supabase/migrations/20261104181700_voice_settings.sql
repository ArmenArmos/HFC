-- Voice mode settings (singleton): STT, urgent STT and TTS models, voice and style prompt; read by the server only.
create table public.voice_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  stt_model text not null default 'google/gemini-2.5-pro' check (length(stt_model) between 1 and 160),
  stt_urgent_model text not null default 'elevenlabs/scribe-v2' check (length(stt_urgent_model) between 1 and 160),
  tts_model text not null default 'google/gemini-3.8-flash-tts' check (length(tts_model) between 1 and 160),
  tts_voice text not null default 'Kore' check (length(tts_voice) between 1 and 80),
  tts_instructions text not null default 'Speak calmly, warmly and with care. Use Eastern Armenian by default and the polite Դուք form. If the text is Russian or English, speak that language. Use short, natural sentences. Say numbers naturally; blood pressure as the upper and lower number. Never read symbols, lists or codes aloud. Never rush.' check (length(tts_instructions) between 1 and 599),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.voice_settings enable row level security;
revoke all on public.voice_settings from public, anon, authenticated;
grant select, update on public.voice_settings to service_role;
-- No RLS policies: only the server service role may read this singleton.
insert into public.voice_settings (id) values (true);
