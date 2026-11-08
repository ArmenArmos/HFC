import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ClinicStoredFiles} from '@/components/clinic-portal/files';
import {clinicSnapshot as snapshot} from './fixtures/clinic-portal';
const data=structuredClone(snapshot);data.files[0].createdAt='2026-10-16T08:02:00.798724+00:00';
const server=renderToStaticMarkup(createElement(ClinicStoredFiles,{snapshot:data,locale:'hy'}));
const original=Intl.DateTimeFormat;
const limited=function(locales?:Intl.LocalesArgument,options?:Intl.DateTimeFormatOptions){return new original(locales==='hy-AM'?'en-US':locales,options);}as typeof Intl.DateTimeFormat;
try{Intl.DateTimeFormat=limited;const browser=renderToStaticMarkup(createElement(ClinicStoredFiles,{snapshot:data,locale:'hy'}));assert.equal(browser,server,'HY created-time markup must survive browser ICU fallback');assert.ok(browser.includes('16 հոկ 2026 · 12:02'),'Explicit Yerevan 24-hour record time');}finally{Intl.DateTimeFormat=original;}
console.log('Clinic created-time hydration PASS across HY ICU availability; deterministic localized Yerevan timestamp, not processing/clinical evidence.');
