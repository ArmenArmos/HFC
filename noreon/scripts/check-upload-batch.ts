import assert from 'node:assert/strict';
import { processUploadBatch } from '@/lib/reports/upload-batch';
const completed:string[]=[];const statuses:string[]=[];
const failed=await processUploadBatch(['first','bad','last'],async item=>{if(item==='bad')throw Error('invalid_file');completed.push(item)},(index,status)=>statuses.push(`${index}:${status}`));
assert.deepEqual(completed,['first','last']);assert.deepEqual(failed,[{index:1,error:'invalid_file'}]);
assert.deepEqual(statuses,['0:processing','0:complete','1:processing','1:failed','2:processing','2:complete']);
console.log('Upload batch checks passed: ordered processing, per-file progress, partial failure and no loss of successful uploads.');
const {createElement}=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const {DemoUpload}=await import('@/components/reports/demo-upload');
for (const locale of ['en','hy'] as const) {
 const html=renderToStaticMarkup(createElement(DemoUpload,{locale,disabled:false,onReport(){},onBusy(){},remainingSlots:2,sharedPersistence:true}));
 assert.ok(html.includes('multiple=""'));assert.ok(html.includes('application/pdf,image/jpeg,image/png'));
 assert.ok(html.includes('disabled=""'));
}
console.log('Upload UI checks passed: multiple selection, accepted types and consent gating in both languages.');
