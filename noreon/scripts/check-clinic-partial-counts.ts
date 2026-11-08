// Durable portal DTO regression only. Native processing is excluded from this release.
import assert from 'node:assert/strict';
import {clinicFileSchema} from '@/lib/clinic-portal/schema';
const id='c3100000-0000-4000-8000-000000000003';
const file={id,logicalKey:id,name:'Synthetic.pdf',mime:'application/pdf',declaredSizeBytes:14,sizeBytes:14,checksum:'a'.repeat(64),revision:1,createdAt:'2026-10-16T05:00:00Z',upload:{status:'stored',attemptId:id,possibleDuplicate:false,cleanup:'not_required'},processing:{status:'partial',sequence:1,segments:1,unresolvedRegions:0},association:{status:'review_required',associatedCount:0,unmatchedCount:1},recoveryCommand:null,correction:{pendingCount:0},release:{hiddenCount:1,releasedCount:0}};
const parsed=clinicFileSchema.parse(file);assert.equal(parsed.processing.status,'partial');assert.equal(parsed.processing.unresolvedRegions,0);
assert.equal(clinicFileSchema.safeParse({...file,processing:{...file.processing,status:'complete',segments:0}}).success,false);
assert.equal(clinicFileSchema.safeParse({...file,processing:{...file.processing,status:'complete',unresolvedRegions:1}}).success,false);
console.log('CP6 durable DTO preserves partial with zero unreadable regions; complete still requires segments and no unresolved regions. No native processing invoked or accepted.');
