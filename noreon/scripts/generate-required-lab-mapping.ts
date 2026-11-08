/** SQL receives the exact shared catalogue mapping, with no second hand-maintained list. */
import {readFileSync,writeFileSync} from 'node:fs';
import {requiredLabMapping} from '../lib/patient-care/required-lab-match';
const path='supabase/migrations/20261104180900_required_lab_alias_ldl.sql';
export const requiredLabMappingSql=`-- BEGIN generated required lab mapping\ncreate or replace function public._required_lab_mapping() returns jsonb\nlanguage sql immutable set search_path='' as $mapping$\n select $json$${JSON.stringify(requiredLabMapping)}$json$::jsonb\n$mapping$;\n-- END generated required lab mapping`;
if(process.argv.includes('--write')){
 const source=readFileSync(path,'utf8');
 writeFileSync(path,source.replace(/-- BEGIN generated required lab mapping[\s\S]*?-- END generated required lab mapping/,requiredLabMappingSql));
}
