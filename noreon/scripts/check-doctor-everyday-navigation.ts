import assert from 'node:assert/strict';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';
for(const text of ['Open conversation','Բացել զրույցը','Открыть разговор'])assert.deepEqual(workspaceIntent(text),{kind:'card',card:'conversation',query:''});
for(const text of ['Record blood pressure','Գրանցել ճնշումը','Записать давление','Record a note','Գրանցել նշում','Записать заметку'])assert.deepEqual(workspaceIntent(text),{kind:'card',card:'observations',query:''});
console.log('Everyday task shortcuts stay in doctor chat in all three languages');
