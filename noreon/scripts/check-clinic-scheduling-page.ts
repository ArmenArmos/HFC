import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {ClinicSchedulingForm} from '@/components/real-review/clinic-scheduling-form';
import {ClinicDirectoryList} from '@/components/real-review/clinic-directory-list';
import type {ReactElement} from 'react';
const id='11111111-1111-4111-8111-111111111111';
let denied=false,clinicFailure=false,copyFailure=false,reads=0;
let clinics:unknown[]=[];
const modules:Record<string,unknown>={
 '@/lib/clinic-portal/result-attach-schema':{resultAttachEnabled:()=>false},
 react:React,'react/jsx-runtime':jsx,'node:crypto':await import('node:crypto'),'lucide-react':icons,
 'next/link':{default:({children,...props}:Record<string,unknown>)=>React.createElement('a',props,children as React.ReactNode)},
 '@/components/real-review/clinic-scheduling-form':{ClinicSchedulingForm},
 '@/components/real-review/clinic-directory-list':{ClinicDirectoryList},
 '@/components/real-review/admin-forms':{AddClinicForm:()=>null},
 '@/lib/staff/real-admin':{
  requireRealAdmin:async()=>{if(denied)throw Error('Admin denied');},
  getRealClinics:async()=>{reads++;if(clinicFailure)throw Error('Unavailable');return clinics;},
  getSchedulingCopySettings:async()=>{reads++;if(copyFailure)throw Error('Unavailable');return {email:null,revision:0};},
 },
};
const exports:Record<string,()=>Promise<ReactElement>>={};
const source=readFileSync('app/staff/real/(review)/clinics/page.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code+'\nexports.directory=ClinicDirectory;exports.copy=CopySchedulingSettings;',{exports,require:(name:string)=>{assert.ok(name in modules,`Unknown page dependency ${name}`);return modules[name];}});
denied=true;await assert.rejects(()=>exports.default(),/Admin denied/);assert.equal(reads,0,'Page authorizes before starting directory reads');denied=false;
let html=renderToStaticMarkup(await exports.directory());assert.ok(html.includes('No clinics yet'));
clinicFailure=true;html=renderToStaticMarkup(await exports.directory());assert.ok(html.includes('role="alert"'));assert.ok(html.includes('Clinics are unavailable'));assert.ok(!html.includes('No clinics yet'));clinicFailure=false;
copyFailure=true;html=renderToStaticMarkup(await exports.copy());assert.ok(html.includes('role="alert"'));assert.ok(html.includes('Scheduling copy settings are unavailable'));assert.ok(!html.includes('Not configured'));copyFailure=false;
html=renderToStaticMarkup(await exports.copy());assert.ok(html.includes('Not configured'));assert.ok(html.includes('not activated'));
clinics=[{id,name:'Synthetic clinic',address:'Local fixture',active:true,schedulingEmail:null,schedulingRevision:0}];html=renderToStaticMarkup(await exports.directory());assert.ok(html.includes('Synthetic clinic'));assert.ok(html.includes('Scheduling email address'));
console.log('Actual Clinics page branches passed: authorize first, empty vs unavailable, protected copy read, populated production directory and button-styled recovery. IO is mocked.');
assert.ok(html.includes(`/staff/real/clinics/${id}/access?locale=en`),'Admin directory links to guarded clinic membership management');
const plain=renderToStaticMarkup(React.createElement(ClinicDirectoryList,{clinics:clinics as Parameters<typeof ClinicDirectoryList>[0]['clinics']}));assert.ok(!plain.includes('/access?'),'Shared directory does not expose admin management by default');
