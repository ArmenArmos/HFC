import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { todaysDoses } from '../lib/member-medicines/model';
import { dosesForDay } from '../lib/patient-care/model';

// Executes the actual server page and schedule models with repository and UI boundaries mocked.
// This checks element placement and fallback copy, not browser layout, hydration or live data.
type Element = { type: unknown; props: { children?: unknown; dose?: { dueAt: string }; ask?: { id: string }; href?: string } };
const element = (value: unknown): value is Element => typeof value === 'object' && value !== null && 'props' in value;
const root = process.cwd();
const require = createRequire(`${root}/package.json`);

const today = '2026-10-22';
class Clock extends Date {
  constructor(value?: string | number) { super(value ?? '2026-10-22T10:00:00Z'); }
}
const due = `${today}T08:00:00+04:00`;
const instant = new Date(due).toISOString();
const medicine = { id:'shared', name:'Example', dose:'Example dose', times:['08:00','09:00'], startedOn:'2026-01-01', startDate:'2026-01-01', active:true, planId:'current', effectiveAt:'2026-01-01T00:00:00Z', endDate:null, doses:[{dueAt:instant,status:'skipped'}] };
let locale: 'en' | 'hy' = 'en';
let enabled=true;
let careAvailable=true;
const asks = [
 ['self-inline','self','shared',due], ['plan-inline','plan','shared',due],
 ['different-id','self','other',due], ['different-time','self','shared',`${today}T10:00:00+04:00`],
 ['stopped','self','stopped',due], ['future-self','self','future',due], ['future-plan','plan','future',due], ['old-plan','plan','old',due], ['past','plan','shared','2026-01-01T08:00:00+04:00']
].map(([id,source,medicineId,dueAt])=>({id,source,medicineId,dueAt,state:'open'}));
const mocks: Record<string, unknown> = {
 'next/navigation': {notFound(){throw Error('404');}}, 'next/link': 'Link',
 'lucide-react': {ArrowLeft:'ArrowLeft',Bell:'Bell',Pill:'Pill'},
 '@/components/patient/patient-shell': {PatientShell:'Shell'},
 '@/lib/patient/repository': {requireRegistered:async()=>({profile:{locale}})},
 '@/components/patient-care/common': {CareLink:'CareLink',CareSection:'Section',IconTile:'Icon',RowLink:'RowLink',Status:'Status',copy:(l: 'en' | 'hy', en: string, hy: string)=>l==='en'?en:hy},
 '@/components/patient-care/controls': {DoseButtons:'PlanButtons'},
 '@/lib/patient-care/repository': {getCareData:async()=>{if(!careAvailable)throw Error('unavailable');return {plan:{id:'current',publishedAt:'2026-01-01T00:00:00Z',medications:[medicine,{...medicine,id:'old',planId:'previous'},{...medicine,id:'future',startDate:'2026-10-23'}]},events:[{medicationId:'shared',dueAt:instant,status:'skipped'}]};}},
 '@/lib/patient-care/model': {dosesForDay}, '@/lib/member-medicines/model': {todaysDoses},
 '@/lib/member-medicines/server': {readMemberMedicines:async()=>({enabled:true,medicines:[medicine,{...medicine,id:'stopped',stoppedAt:instant},{...medicine,id:'future',startedOn:'2026-10-23'}]}),readMemberMedicineAsks:async()=>enabled?{enabled:true,asks}:{enabled:false}},
 '@/components/member-medicines/controls': {AddMedicineForm:'Add',OwnDoseButtons:'OwnButtons',StopMedicineButton:'Stop'},
 '@/components/member-medicines/ask-card': {MedicineAskCard:'Ask'}
};
const src=fs.readFileSync(`${root}/app/patient/medicines/page.tsx`,'utf8');
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const mod={exports:{}};
vm.runInNewContext(code,{exports:mod.exports,module:mod,require:(n: string)=>mocks[n]??require(n),Date: Clock,Map,Set});
const children = (node: unknown): unknown => Array.isArray(node) ? node : element(node) ? node.props.children : [];
const all = (node: unknown, predicate: (node: Element) => boolean): Element[] => {
  if (Array.isArray(node)) return Array.from(node).flatMap(child => all(child, predicate));
  if (!element(node)) return [];
  return [...(predicate(node) ? [node] : []), ...all(children(node), predicate)];
};
const page = (mod.exports as { default: () => Promise<Element> }).default;
let tree=await page();
const doseRows=all(tree,n=>n.type==='li'&&all(n,x=>['PlanButtons','OwnButtons'].includes(String(x.type))).length===1);
for(const [type,id] of [['PlanButtons','plan-inline'],['OwnButtons','self-inline']]) {
 const row=doseRows.find(n=>all(n,x=>x.type===type&&x.props.dose?.dueAt===instant).length);
 assert.deepEqual(all(row,n=>n.type==='Ask').map(n=>n.props.ask?.id),[id],`${type}: exact dose ask inline using equivalent offsets`);
 assert.ok(row);
 const rowChildren=all(row.props.children, () => true);
 assert.equal(rowChildren.findIndex(n=>n.type==='Ask'),rowChildren.findIndex(n=>n.type===type)+1,'ask directly follows dose buttons');
}
assert.equal(all(tree,n=>n.type==='Ask').length,asks.length,'all asks remain visible exactly once');
assert.ok(element(tree.props.children));
const top=tree.props.children.props.children as Element[];
const sectionsIndex=top.findIndex(n=>n?.type==='Section');
assert.equal(JSON.stringify(all(top.slice(0,sectionsIndex),n=>n.type==='Ask').map(n=>n.props.ask?.id)),JSON.stringify(asks.slice(2).map(n=>n.id)),'unmatched asks stay at top including hidden doses');
enabled=false;
tree=await page();
assert.equal(all(tree,n=>n.type==='Ask').length,0);
const fallback='Marked as skipped. If you have a question about this medicine, write to your doctor.';
assert.equal(all(tree,n=>n.type==='Link'&&n.props.href==='/patient/zoe'&&n.props.children===fallback).length,2,'skipped fallback for both sources when asks unavailable');
enabled=true;
const inlineAsks=asks.splice(0,2);
tree=await page();
assert.equal(all(tree,n=>n.type==='Link'&&n.props.href==='/patient/zoe'&&n.props.children===fallback).length,2,'skipped fallback also appears when asks are enabled but no matching open ask exists');
asks.unshift(...inlineAsks);
enabled=false;
locale='hy';
tree=await page();
assert.equal(all(tree,n=>n.type==='Link'&&n.props.href==='/patient/zoe'&&typeof n.props.children==='string'&&n.props.children!==fallback).length,2,'Armenian fallback for both sources');
enabled=true; careAvailable=false;
tree=await page();
assert.equal(all(tree,n=>n.type==='Ask').length,asks.length,'plan asks remain when care data unavailable');
const card=fs.readFileSync(`${root}/components/member-medicines/ask-card.tsx`,'utf8');
assert.doesNotMatch(card,/scrollIntoView|useEffect|useRef/,'no automatic scroll');
console.log('QA90 page rendering: source/id/instant matching, inline placement, unmatched retention, EN/HY fallback and unavailable care passed');
