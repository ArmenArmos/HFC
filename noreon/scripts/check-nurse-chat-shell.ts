import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import {NurseChatShell} from '@/components/staff/nurse-chat-shell';
for(const locale of ['en','hy','ru'] as const){
 for(const path of ['/staff/real/nurse-chat','/staff/real/visits']){
  const html=renderToStaticMarkup(React.createElement(PathnameContext.Provider,{value:path},React.createElement(NurseChatShell,{locale,nav:React.createElement('nav',null,'Legacy destinations'),actions:React.createElement('span',null,'Staff actions'),fallback:React.createElement('aside',null,'Legacy shell')},React.createElement('p',null,'Thread card'))));
  if(path==='/staff/real/nurse-chat'){
   assert.ok(!html.includes('<aside'),'Chat has no left sidebar');
   assert.ok(html.includes('<details')&&html.includes('Legacy destinations'),'Legacy destinations stay in the small menu');
   assert.ok(html.includes('Thread card')&&html.includes('Staff actions'));
   assert.ok(html.indexOf('Staff actions')>html.indexOf('<details')&&html.indexOf('Staff actions')<html.indexOf('</details>'),'Staff actions stay inside Menu');
  }else{
   assert.ok(html.includes('Legacy shell')&&!html.includes('Thread card'),'Legacy pages retain their existing shell');
  }
 }
}
console.log('Nurse shell: chat has a small menu and no sidebar; old pages retain their shell, en/hy/ru.');
