import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {AdminChatShell} from '@/components/staff/admin-chat-shell';
for(const locale of ['en','hy','ru'] as const)for(const path of ['/staff/real/admin-chat','/staff/real/members']){
 const html=renderToStaticMarkup(React.createElement(PathnameContext.Provider,{value:path},React.createElement(AdminChatShell,{locale,nav:React.createElement('nav',null,'Backoffice destinations'),actions:React.createElement('span',null,'Staff actions'),fallback:React.createElement('aside',null,'Legacy shell')},React.createElement('p',null,'Chat card'))));
 if(path.endsWith('/admin-chat')){
  assert.ok(html.includes('data-admin-chat-shell'));assert.ok(html.includes('Chat card'));
  assert.ok(html.includes('Backoffice destinations'));assert.ok(!html.includes('<details open'));
  assert.ok(!html.includes('lg:grid-cols'),'Desktop also keeps navigation in the Menu');
  assert.ok(html.includes(locale==='en'?'Menu':locale==='hy'?'Ընտրացանկ':'Меню'));
 }else assert.equal(html,'<aside>Legacy shell</aside>');
}
console.log('Admin chat shell: localized closed Menu at every size; other routes preserve their shell (static render).');
