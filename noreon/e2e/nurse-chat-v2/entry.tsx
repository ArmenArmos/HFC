import '../staff-voice/reply';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {NurseChatV2} from '@/components/nurse-chat-v2/nurse-chat';
import {installZoeFetch} from './zoe';
installZoeFetch();
createRoot(document.getElementById('root')!).render(<NurseChatV2 locale={new URL(location.href).searchParams.get('locale')==='hy'?'hy':new URL(location.href).searchParams.get('locale')==='ru'?'ru':'en'} voiceAvailable={new URL(location.href).searchParams.has('voice')} nurseId="aa220000-0000-4000-8000-000000002001" nurseName="Narine Example"/>);
