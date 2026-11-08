import assert from 'node:assert/strict';
import * as boundary from '@/lib/staff-zoe/typed-boundary';
assert.equal(typeof boundary.staffVoiceNeedsReview,'function','Staff transcripts need a conservative manual-send policy');
for(const text of ['5 mg','one tablet','take aspirin','амлодипина','пять миллиграммов','դեղաչափը','հինգ մգ','138 over 86','１２ mg','երկու հաբ','доза','paracetamol','rosuvastatin','մետֆորմին','dose','ml','two members','давление двести','пульс двенадцать','пульс девяносто','պուլսը իննը','ճնշումը հարյուր քառասուն'])assert.ok(boundary.staffVoiceNeedsReview(text),text);
for(const text of ['hello','բարև','привет','who needs me','the member has chest pain','show the latest results'])assert.equal(boundary.staffVoiceNeedsReview(text),false,text);
console.log('Staff voice review: numbers, number words, medicine and dose tokens in hy/ru/en passed');
