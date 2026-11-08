import assert from 'node:assert/strict';
import {newChatHome} from '@/lib/patient/member-chat-config';

const on={NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true'};
assert.equal(newChatHome({},on),true,'both switches on: a plain /patient/zoe opens the new chat');
assert.equal(newChatHome({},{NOREON_MEMBER_CHAT_V2:'true'}),false,'V3 off: the member chat page is unchanged');
assert.equal(newChatHome({},{NOREON_ZOE_APP_V3:'true'}),false,'the new chat off: nothing to open');
assert.equal(newChatHome({},{}),false,'both off');
assert.equal(newChatHome({},{NOREON_ZOE_APP_V3:'TRUE',NOREON_MEMBER_CHAT_V2:'1'}),false,'only exactly "true" counts');
assert.equal(newChatHome({view:'classic'},on),false,'?view=classic is the way back');
assert.equal(newChatHome({card:'progress'},on),false,'a deep link to a card stays on the previous page');
assert.equal(newChatHome({card:'account',section:'language'},on),false,'a deep link to a section stays too');
assert.equal(newChatHome({view:'other'},on),true,'an unknown view value does not hide the new chat');
console.log('check-chat-home: the new chat is the member chat only with both switches on; ?view=classic and card links keep the previous page');
