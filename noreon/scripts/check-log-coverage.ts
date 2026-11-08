import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Every route handler and every server action writes one log line (docs/operations/logging.md).
 * A new route.ts or "use server" file that exports a bare function would be silent; wrap it
 * with withRouteLogging or loggedAction from lib/observability/with-logging.
 */
const walk=(dir:string):string[]=>readdirSync(dir).flatMap(entry=>{const path=join(dir,entry);return statSync(path).isDirectory()?(entry==='node_modules'?[]:walk(path)):[path];});
const files=['app','lib','components'].flatMap(walk).filter(f=>/\.tsx?$/.test(f));
const bare:string[]=[];
let routes=0,actions=0;
for(const file of files){
  const source=readFileSync(file,'utf8');
  const isRoute=/(^|\/)route\.ts$/.test(file),isAction=/^\s*['"]use server['"]/.test(source);
  if(!isRoute&&!isAction)continue;
  if(isRoute)routes++;else actions++;
  for(const match of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)){
    if(isRoute&&!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(match[1]))continue;
    bare.push(`${file}: ${match[1]}`);
  }
  if(isAction)for(const match of source.matchAll(/^export\s+const\s+(\w+)\s*=(?!\s*loggedAction\()/gm))bare.push(`${file}: ${match[1]}`);
  // jobRoute (lib/jobs/contract.ts) wraps its handler in withRouteLogging; asserted below.
  if(isRoute)for(const match of source.matchAll(/^export\s+const\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s*=(?!\s*(?:withRouteLogging|jobRoute)\()/gm))bare.push(`${file}: ${match[1]}`);
}
assert.match(readFileSync('lib/jobs/contract.ts','utf8'),/export function jobRoute\(.*\)\{\n return withRouteLogging\(/,'jobRoute returns a withRouteLogging handler');
assert.ok(routes>20&&actions>40,'The scan found the route and action files');
assert.deepEqual(bare,[],'Route handlers and server actions must be wrapped for logging');
console.log(`All ${routes} route files and ${actions} server action files write a log line per call.`);
