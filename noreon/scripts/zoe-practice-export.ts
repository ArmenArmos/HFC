import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {exportPracticeCorrections} from '@/lib/zoe/practice/replay';
const args=process.argv.slice(2),source=args[0],destination=resolve(args[1]??'docs/reference/zoe-eval/practice-corrections.json');
const root=resolve('docs/reference/zoe-eval'),rel=relative(root,destination);
if(!source||rel.startsWith('..')||rel==='..'||rel.startsWith('/'))throw new Error('Usage: zoe-practice-export.ts <offline-marks.json> [docs/reference/zoe-eval/file.json]');
const result=exportPracticeCorrections(JSON.parse(await readFile(resolve(source),'utf8')));
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(`Exported ${result.cases.length} fictional corrections to ${destination}`);
