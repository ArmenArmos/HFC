import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requiredLabMappingSql} from './generate-required-lab-mapping';
const mapping = await import('../lib/patient-care/required-lab-match').catch(()=>null);
assert.ok(mapping, 'Required results need a shared test-to-analyte matcher');
const {coversRequiredLabTest,requiredLabValues,labDateEligible,missingRequiredLabComponents,requiredLabAnalyte}=mapping;
assert.equal(requiredLabAnalyte('RBC'),'red_blood_cells');
assert.equal(requiredLabAnalyte('Red blood cells'),'red_blood_cells');
assert.ok(!missingRequiredLabComponents('cbc-hb',[{name:'RBC'}]).includes('red_blood_cells'));
const printedResults=[
 {name:'Total cholesterol',value:6.1,unit:'mmol/L',collectedOn:'2026-11-05'},
 {name:'HDL cholesterol',value:1.3,unit:'mmol/L',collectedOn:'2026-11-05'},
 {name:'LDL cholesterol (LDL-C)',value:4.2,unit:'mmol/L',collectedOn:'2026-11-05'},
 {name:'Triglycerides',value:1.4,unit:'mmol/L',collectedOn:'2026-11-05'},
 {name:'Fasting glucose',value:5.2,unit:'mmol/L',collectedOn:'2026-11-05'},
 {name:'HbA1c',value:5.4,unit:'%',collectedOn:'2026-11-05'},
];
for(const [name,key]of [
 ['Total cholesterol','total_cholesterol'],['HDL cholesterol','hdl_c'],
 ['LDL cholesterol (LDL-C)','ldl_c'],['Triglycerides','triglycerides'],
 ['Fasting glucose','fasting_glucose'],['HbA1c','hba1c'],
 ['LDL-cholesterol','ldl_c'],['LDL cholesterol (calculated)','ldl_c'],['cholesterol LDL','ldl_c'],
 ['HDL cholesterol (HDL-C)','hdl_c'],['HDL-cholesterol','hdl_c'],
 ['Total cholesterol (TC)','total_cholesterol'],['cholesterol total','total_cholesterol'],
]as const)assert.equal(requiredLabAnalyte(name),key,`${name} has an exact required-lab identity`);
assert.equal(coversRequiredLabTest('lipid-panel',printedResults),true,'The four printed lipid labels cover the lipid panel');
assert.deepEqual(requiredLabValues('lipid-panel',printedResults),printedResults.slice(0,4));
assert.deepEqual(missingRequiredLabComponents('lipid-panel',printedResults),[]);
const withoutLdl=printedResults.filter(v=>v.name!=='LDL cholesterol (LDL-C)');
assert.equal(coversRequiredLabTest('lipid-panel',withoutLdl),false,'The printed panel still requires LDL');
assert.deepEqual(missingRequiredLabComponents('lipid-panel',withoutLdl),['ldl_c']);
assert.equal(coversRequiredLabTest('hba1c-glucose',printedResults),true,'The printed glucose and HbA1c cover the paired test');
assert.deepEqual(requiredLabValues('hba1c-glucose',printedResults),printedResults.slice(4));
for(const name of ['LDL cholesterol (LDL-C) urine','TSH receptor antibodies'])
 assert.equal(requiredLabAnalyte(name),null,`${name} must not match an identity alias`);
assert.equal(coversRequiredLabTest('lipid-panel',[...withoutLdl,{name:'LDL cholesterol (LDL-C) urine'}]),false,'Urine LDL cannot complete a blood lipid panel');
const lipids=['Total cholesterol','HDL-C','LDL-C','Triglycerides'].map(name=>({name,collectedOn:'2026-11-05'}));
assert.equal(coversRequiredLabTest('lipid-panel',lipids),true);
for(const test of ['tsh','apob','lpa','urine-acr','urinalysis','potassium','sodium','cbc-hb','nt-probnp','hba1c','hba1c-glucose'])
 assert.equal(coversRequiredLabTest(test,lipids),false,`Lipid-only evidence cannot satisfy ${test}`);
assert.equal(coversRequiredLabTest('lipid-panel',lipids.slice(1)),false,'A partial panel is still needed');
assert.equal(coversRequiredLabTest('hba1c-glucose',[{name:'Glucose'}]),false,'Glucose cannot supply HbA1c');
assert.equal(coversRequiredLabTest('hba1c-glucose',[{name:'Glucose'},{name:'HbA1c'}]),true);
assert.equal(coversRequiredLabTest('hba1c',[{name:'Urine glucose'}]),false);
assert.deepEqual(requiredLabValues('lipid-panel',[...lipids,{name:'Magnesium'}]),lipids);
for(const [test,name] of [['tsh','ТТГ'],['apob','ApoB'],['lpa','Lp(a)'],['urine-acr','ACR'],['potassium','K+'],['potassium','Կալիում (K⁺)'],['sodium','Na+'],['sodium','Նատրիում (Na⁺)'],['nt-probnp','NT-proBNP']] as const)
 assert.equal(coversRequiredLabTest(test,[{name}]),true,`${test} uses its own catalogue row`);
// Sharing a catalogue row never makes its components alternatives.
for(const [test,names]of [
 ['cbc-hb',['WBC']],['cbc-hb',['Platelets']],
 ['cbc-hb',['Hemoglobin','WBC','Platelets']],
 ['creatinine-egfr',['Creatinine']],['creatinine-egfr',['eGFR']],
 ['insulin-homa',['Insulin']],['insulin-homa',['HOMA-IR']],
 ['urinalysis',['Urinalysis']],
]as const)assert.equal(coversRequiredLabTest(test,names.map(name=>({name}))),false,`${test}: ${names.join(', ')} is not a complete investigation`);
for(const [test,names]of [
 ['creatinine-egfr',['Creatinine','eGFR']],['insulin-homa',['Insulin','HOMA-IR']],
]as const){
 assert.equal(coversRequiredLabTest(test,names.map(name=>({name}))),true,`${test}: explicit complete panel passes`);
 for(const omitted of names)assert.equal(coversRequiredLabTest(test,names.filter(name=>name!==omitted).map(name=>({name}))),false,`${test}: omitting ${omitted} must fail`);
}
for(const unknown of ['unknown','constructor','toString','__proto__']){
 assert.equal(coversRequiredLabTest(unknown,[{name:'TSH'}]),false,'Unknown ids fail closed');
 assert.deepEqual(requiredLabValues(unknown,[{name:'TSH'}]),[]);
}
assert.equal(labDateEligible('2023-11-08','2026-11-05T10:00:00Z'),false);
assert.equal(labDateEligible('2026-11-05','2026-11-05T10:00:00Z'),true,'Same Yerevan calendar day counts');
assert.equal(labDateEligible('2026-11-05',null),false,'No questionnaire is not an eligible source');
assert.equal(labDateEligible('2999-01-01','2026-11-05T10:00:00Z'),false);

const mappingSql=readFileSync('supabase/migrations/20261104180900_required_lab_alias_ldl.sql','utf8');
assert.ok(mappingSql.includes(requiredLabMappingSql),'SQL and shared catalogue mapping cannot drift');
const sql=readFileSync('supabase/migrations/20261104175200_clinic_lab_receipt_analyte_match.sql','utf8');
// This is a source contract in addition to the executable rolled-back RPC test.
function assertRpcGuard(source:string){
 const command=source.slice(source.indexOf('create function public.command_patient_clinical_review('),source.indexOf('-- Publication rechecks'));
 assert.match(command,/perform public\._assert_required_lab_receipt\(p_user_id,test->>'id',matched\);/,'The RPC must apply the shared matcher');
 assert.match(source.slice(source.indexOf('create or replace function public.publish_patient_clinical_plan(')),/perform public\._assert_required_lab_receipt\(p_user_id,test->>'id',receipt->'values'\);/,'Publication must recheck stored receipts');
 const guard=source.slice(source.indexOf('create function public._assert_required_lab_receipt('),source.indexOf('-- One atomic command'));
 assert.match(guard,/if not public\._required_lab_test_covered\(p_test,p_values\)then raise exception 'The selected values do not cover this required test'/);
}
assertRpcGuard(sql);
assert.throws(()=>assertRpcGuard(sql.replace('perform public._assert_required_lab_receipt(p_user_id,test->>\'id\',matched);','null;')),'Loosening the actual RPC match must fail this source contract');
assert.throws(()=>assertRpcGuard(sql.replace('perform public._assert_required_lab_receipt(p_user_id,test->>\'id\',receipt->\'values\');','null;')),'Removing the legacy publication guard must fail this source contract');

for(const [test,values]of [
 ['cbc-hb',[{name:'Hemoglobin A1c'}]],['cbc-hb',[{name:'Urine leukocytes'}]],
 ['potassium',[{name:'Urine potassium'}]],['sodium',[{name:'Urine sodium'}]],
 ['tsh',[{name:'TSH receptor antibodies'}]],['hba1c-glucose',[{name:'HbA1c'},{name:'Glucose (urine)'}]],
]as const)assert.equal(coversRequiredLabTest(test,values),false,`${test} cannot use an uncertain or differently qualified analyte`);

console.log('Required laboratory mapping, dates, exact identities, SQL catalogue parity and RPC guard mutation contract pass. Executable RPC checks are in check-clinical-required-lab-match.sql.');
