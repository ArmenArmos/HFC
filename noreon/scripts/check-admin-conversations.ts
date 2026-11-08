import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminConversationReadSchema,adminThread,parseAdminConversationFilter,parseBeforeCursor,type AdminConversation} from '@/lib/admin-conversations/contracts';
import {actionLabel} from '@/lib/activity-log/labels';

// Filters: only the three known values pass.
assert.equal(parseAdminConversationFilter('needs_reply'),'needs_reply');
assert.equal(parseAdminConversationFilter(['urgent_today']),null);
assert.equal(parseAdminConversationFilter("x'; drop"),null);

// The read parses; an unknown Zoe run outcome is kept as 'other' with a generic label (19 Oct), never breaking the page.
const m='ad000000-0000-4000-8000-000000000001';
const parsed=adminConversationReadSchema.parse({ok:true,memberId:m,asOf:'2026-10-18T12:00:00Z',memberName:'M',doctorName:null,conversationId:null,window:{before:null,from:null,olderBefore:null},zoeRunsTotal:1,intakesTotal:0,traceTotal:0,
 messages:[{seq:1,text:'hi',at:'2026-10-18T10:00:00Z',channel:'telegram'},{seq:2,text:'later',at:'2026-10-18T10:05:00Z',channel:'app'}],
 zoeAnswers:[{id:'ad000000-0000-4000-8000-000000000050',kind:'urgent',text:'call 103',at:'2026-10-18T10:01:00Z',messageSeq:1,telegramState:null,heldReason:null}],
 replies:[{approvalId:'ad000000-0000-4000-8000-000000000060',text:'reply',at:'2026-10-18T10:03:00Z',doctorName:'Dr X',deliveryState:'accepted_by_provider',deliveryReason:null}],
 drafts:[],intakes:[],trace:[],
 zoeRuns:[{id:'ad000000-0000-4000-8000-000000000070',messageSeq:1,outcome:'some_future_outcome',reason:null,summary:null,guardReasons:[],provider:null,model:null,draftId:null,finishedAt:'2026-10-18T10:01:00Z'}],
}) as AdminConversation;
assert.equal(parsed.zoeRuns.length,1);assert.equal(parsed.zoeRuns[0]!.outcome,'other');
assert.deepEqual(adminThread(parsed).map(i=>i.kind),['member','zoe','doctor','member'],'one thread, oldest first');
assert.equal(adminConversationReadSchema.parse({ok:false,code:'disabled'}).ok,false);
assert.equal(parseBeforeCursor('2026-10-18T13:38:00.123456+00:00'),'2026-10-18T13:38:00.123456+00:00');
assert.equal(parseBeforeCursor("2026-10-18'; drop"),null);assert.equal(parseBeforeCursor(['2026-10-18T13:38:00Z']),null);

assert.equal(actionLabel('access','conversation.read.admin'),'Read the member conversation (admin)');

// The admin branch reads through the recording RPC and never receives a doctor port or action.
const page=readFileSync('app/staff/real/(review)/conversations/[id]/page.tsx','utf8');
const branch=page.slice(page.indexOf("if(identity.role==='admin')"),page.indexOf('// CD11'));
assert.ok(branch.includes('readAdminConversation(id,before)')&&branch.includes('await adminOnly(staff)'));
for(const port of ['commandConversation','conversationActions','composeConversationReply','editConversationSummary','recoverConversationCommand','ConversationReview'])
 assert.ok(!branch.includes(port),`admin branch has no ${port}`);
const view=readFileSync('components/admin-conversations/view.tsx','utf8');
assert.ok(view.includes('Read-only (admin).')&&!/<form|<button|action=/.test(view),'read-only view: banner, no forms or buttons');
const server=readFileSync('lib/admin-conversations/server.ts','utf8');
assert.ok(server.includes("rpc('admin_conversation_read'")&&server.includes('await requireRealAdmin()'));
// The doctor actions still require a doctor on the server.
assert.ok(readFileSync('lib/conversation-persistence/server.ts','utf8').includes("if(identity.role!=='doctor')throw Error('Assigned doctor required')"));
console.log('admin conversations: ok');
