import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {EXPORT_LIMIT,filterQuery,parseFilters,rpcArgs,toCsv,withDefaultWindow,type ActivityRow} from '@/lib/activity-log/contracts';
import {actionLabel} from '@/lib/activity-log/labels';

// Filters: malformed values are dropped, never passed on.
const id='ac000000-0000-4000-8000-000000000001';
const f=parseFilters({actor:id,member:'not-a-uuid',category:'everything',from:'2026-02-31',to:'2026-10-18',cursor:"x'; drop"});
assert.deepEqual(f,{actor:id,member:null,category:null,from:null,to:'2026-10-18',cursor:null,memberInvalid:'not-a-uuid'});
assert.equal(parseFilters({member:id}).memberInvalid,null);
assert.equal(parseFilters({member:'  '}).memberInvalid,null);

// Default window (F3): 7 Yerevan days ending today, or ending at the chosen end date; a chosen start wins.
const at=Date.parse('2026-10-17T21:30:00Z'); // 18 Oct 01:30 in Yerevan
assert.equal(withDefaultWindow(parseFilters({}),at).from,'2026-10-12');
assert.equal(withDefaultWindow(parseFilters({to:'2026-10-05'}),at).from,'2026-09-29');
assert.equal(withDefaultWindow(parseFilters({from:'2026-01-01'}),at).from,'2026-01-01');
assert.equal(parseFilters({category:['record_access','sign_in']}).category,'record_access');
const ok=parseFilters({cursor:'2026-10-17T20:27:23.388437Z|access:12'});
assert.equal(ok.cursor,'2026-10-17T20:27:23.388437Z|access:12');

// Days are Yerevan days: "to" includes the whole of that day.
const a=rpcArgs(parseFilters({from:'2026-10-17',to:'2026-10-17'}));
assert.equal(a.p_from,'2026-10-17T00:00:00+04:00');
assert.equal(a.p_to,'2026-10-17T20:00:00.000Z');
assert.equal(rpcArgs(parseFilters({})).p_actor,undefined);
assert.equal(filterQuery({actor:id,member:null,cursor:null}),`actor=${id}`);

// CSV: every cell quoted, quotes doubled, formulas neutralised, CRLF rows.
const row:ActivityRow={key:'access:1',at:'2026-10-17T20:00:00.000000Z',category:'record_access',source:'access',action:'member_file',
 actorId:id,actorName:'=HYPERLINK("http://x")',actorRole:'doctor',memberId:null,memberName:'Ann "A" Smith',ref:'-2+3'};
const csv=toCsv([row]);
const lines=csv.split('\r\n');
assert.equal(lines.length,3);
assert.ok(lines[1].includes(`"'=HYPERLINK(""http://x"")"`));
assert.ok(lines[1].includes('"Ann ""A"" Smith"'));
assert.ok(lines[1].includes(`"'-2+3"`));
assert.ok(lines[1].includes('""'),'empty cells stay quoted');

assert.equal(actionLabel('access','member_file'),'Opened the member file');
assert.equal(actionLabel('auth','login'),'Signed in');
assert.equal(actionLabel('config','update:zoe_settings'),'Setting: update zoe settings');

// The page and the export stay behind the admin gate; the export goes through the recording RPC.
const page=readFileSync('app/staff/real/(review)/activity/page.tsx','utf8');
const route=readFileSync('app/staff/real/(review)/activity/export/route.ts','utf8');
assert.ok(page.includes('await requireRealAdmin()')&&route.includes('await requireRealAdmin()'));
assert.ok(route.includes("rpc('admin_audit_log_export'")&&!route.includes("rpc('admin_audit_log'"));
assert.ok(page.includes('withDefaultWindow(asked)')&&route.includes('withDefaultWindow(asked)'),'page and export share the default window');
// Review item 14: more matching rows than one file holds refuse the export; never a silently cut list.
assert.ok(/if\(page\.next\)return new Response\([^;]*status:400/.test(route)&&route.indexOf('if(page.next)')<route.indexOf('toCsv(page.rows)'),'a truncated export answers 400 before any CSV is written');
const exportSql=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n');
const exportBody=exportSql.slice(Math.max(exportSql.lastIndexOf('create function public.admin_audit_log_export('),exportSql.lastIndexOf('create or replace function public.admin_audit_log_export(')));
assert.match(exportBody.slice(0,exportBody.indexOf('end$$')),new RegExp(`_audit_page\\([^)]*,null,${EXPORT_LIMIT}\\)`),'EXPORT_LIMIT matches the rows admin_audit_log_export returns');
assert.ok(page.includes('EXPORT_LIMIT'),'the page says how many rows a download holds');
assert.ok(route.includes('asked.memberInvalid')&&page.includes('is not a member reference'),'invalid member reference is reported, not dropped');
// Rows are reads fetched for the person's session (the member file loads its parts in parallel, #241):
// the page says so, and the RLS-served readers record only after their rows came back.
assert.ok(page.includes('fetched that part of the record for the person')&&page.includes('they may not have seen it'),'page defines an Opened row');
const history=readFileSync('lib/member-history/server.ts','utf8');
const staffRead=history.slice(history.indexOf('export async function readMemberHistoryForStaff'),history.indexOf('export type AddValueResult'));
assert.ok(staffRead.includes('rpc("staff_member_history"')&&!staffRead.includes('readRows('),'staff history is read and recorded in one RPC, never through RLS');
const bytes=history.slice(history.indexOf('export async function documentBytesResponse'));
assert.ok(bytes.indexOf('rpc("staff_member_history_document"')>0&&bytes.indexOf('rpc("staff_member_history_document"')<bytes.indexOf('.download('),'upload open recorded by the RPC before the bytes');
// Only the staff open is recorded: the RPC refuses non-staff, so the member's own download must not call it (aA-1).
// Behaviour of both paths: scripts/check-member-document-download.ts.
assert.ok(bytes.includes('record === "staff"\n    ? await (client as Client).rpc("staff_member_history_document"'),'access recording is staff-only');
assert.ok(bytes.includes('documentBytesResponse(m.client, m.userId, documentId, "member")'),'the member route reads as the member');
assert.ok(readFileSync('app/staff/real/(review)/members/[id]/member-uploads/[docId]/route.ts','utf8').includes('documentBytesResponse(client, id, docId, "staff")'),'the doctor route records the open');
console.log('Activity log contracts: ok');
