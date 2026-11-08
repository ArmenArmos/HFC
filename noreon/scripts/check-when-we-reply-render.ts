import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WhenWeReply} from '@/components/patient/when-we-reply';

// P26 (18 Oct): members see no care-team hours and no reply time.
for (const locale of ['en', 'hy'] as const) {
  const html = renderToStaticMarkup(React.createElement(WhenWeReply, {locale}));
  assert.doesNotMatch(html, /\d{1,2}:\d{2}|hours|STAGING|աշխատաժամ/i, `${locale}: no hours shown`);
  // Khikar, 18 Oct 22:57: the header's Emergency 103 pill is the one call button; the sentence stays.
  assert.ok(!html.includes('href="tel:103"'), `${locale}: no second 103 button`);
  assert.ok(html.includes(locale === 'en' ? 'not for emergencies. If you feel unwell now, call 103.' : 'շտապ օգնության համար չեն'), `${locale}: not-for-emergencies sentence kept`);
  assert.ok(html.includes(locale === 'en' ? 'You can write to your care team any time. They reply as soon as they can.' : 'ցանկացած ժամի'), `${locale}: honest contact sentence`);
}
console.log('when-we-reply render: ok');
