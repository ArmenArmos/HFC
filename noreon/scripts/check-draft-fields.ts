import assert from 'node:assert/strict';
import {DRAFT_FIELDS} from '@/lib/ai-plan/contracts';
import {deriveDraftFields,type DraftFieldDecisions} from '@/lib/ai-plan/draft-fields';

const proposed={explanation:'Prepared explanation',instructions:'Prepared instructions',followUp:''};
// Concrete outcomes establish value precedence for every explicit-flag combination.
for(const [value,expected] of [['','rejected'],['  ','rejected'],['Doctor replacement','edited']] as const){
 for(const key of DRAFT_FIELDS)for(const accepted of [false,true])for(const rejected of [false,true]){
  const decisions:DraftFieldDecisions={[key]:{accepted,rejected}};
  const review=deriveDraftFields(proposed,{...proposed,[key]:value},decisions);
  assert.equal(review.fields[key],expected);
  assert.equal(review.values[key],expected==='rejected'?'':value);
  assert.equal(review.excludedFields.includes(key),expected==='rejected');
  assert.deepEqual(Object.keys(review.fields),[...DRAFT_FIELDS]);
 }
}
for(const [accepted,rejected,expected] of [[false,false,'not-decided'],[true,false,'accepted'],[false,true,'not-decided'],[true,true,'not-decided']] as const){
 const review=deriveDraftFields(proposed,proposed,{explanation:{accepted,rejected}});
 assert.equal(review.fields.explanation,expected);
 assert.equal(review.values.explanation,'Prepared explanation');
 assert.equal(review.fields.followUp,'rejected','An empty proposal remains excluded regardless of another field’s decision');
}
const editEmpty=deriveDraftFields(proposed,{...proposed,followUp:'Typed into an empty proposal'},{});
assert.equal(editEmpty.fields.followUp,'edited');
assert.equal(editEmpty.values.followUp,'Typed into an empty proposal');
const accepted=deriveDraftFields(proposed,proposed,{explanation:{accepted:true},instructions:{accepted:true}});
assert.deepEqual(accepted.fields,{explanation:'accepted',instructions:'accepted',followUp:'rejected'});
assert.deepEqual(accepted.excludedFields,['followUp']);
// A save cannot mutate values or flags and change a subsequent derivation.
assert.deepEqual(deriveDraftFields(proposed,proposed,{explanation:{accepted:true},instructions:{accepted:true}}),accepted);
console.log('Derived draft fields: all fields, empty and whitespace exclusion, exact proposal acceptance, edit precedence and repeatable payloads.');
