import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// An accepted advisory covers only the version and dependency it names, and only until its date.
const dir=mkdtempSync(join(tmpdir(),'audit-gate-'));
try{
 copyFileSync('scripts/audit-gate.mjs',join(dir,'audit-gate.mjs'));
 const entry={ghsa:'GHSA-test',package:'zod',version:'3.25.76',via:'@expo/cli',lockfile:'mobile',until:'2999-01-01'};
 const expoLock=`importers:\n\n  .:\n    dependencies:\n      zod:\n        specifier: 4.6.7\n        version: 4.6.7\n\npackages:\n\n  zod@3.25.76:\n    resolution: {integrity: x}\n\nsnapshots:\n\n  '@expo/cli@57.0.28(expo@57.0.27)':\n    dependencies:\n      zod: 3.25.76\n\n  zod@3.25.76: {}\n`;
 const otherLock=expoLock.replace("  zod@3.25.76: {}","  other@1.0.0:\n    dependencies:\n      zod: 3.25.76\n\n  zod@3.25.76: {}");
 const directLock=expoLock.replace('specifier: 4.6.7\n        version: 4.6.7','specifier: 3.25.76\n        version: 3.25.76');
 // pnpm writes an npm alias as the real name and version in the value, here and in snapshots.
 const directAliasLock=expoLock.replace('      zod:\n','      zod-old:\n        specifier: npm:zod@3.25.76\n        version: zod@3.25.76\n      zod:\n');
 const devAliasLock=expoLock.replace('\npackages:','    devDependencies:\n      zod-dev:\n        specifier: npm:zod@3.25.76\n        version: zod@3.25.76\n\npackages:');
 const scopedAliasLock=expoLock.replace('      zod:\n',"      '@scoped/old':\n        specifier: npm:zod@3.25.76\n        version: zod@3.25.76\n      zod:\n");
 const consumer=(line:string)=>expoLock.replace('  zod@3.25.76: {}',`  other@1.0.0:\n    dependencies:\n      ${line}\n\n  zod@3.25.76: {}`);
 const aliasLock=consumer('zod-old: zod@3.25.76');
 const quotedAliasLock=consumer("'@scoped/old': zod@3.25.76");
 const peerAliasLock=consumer('zod-old: zod@3.25.76(typescript@5.9.3)');
 // pnpm audit reports no paths without an install, as in CI, so the fixtures carry none.
 // Records as pnpm 10.6.5 writes them: the key is the real package name however it is referenced.
 const record=(key:string,extra='')=>expoLock.replace('\nsnapshots:',`  ${key}:\n    resolution: {directory: vendor/zod, type: directory}\n${extra}\nsnapshots:`);
 const fileDirLock=record('zod@file:vendor/zod');
 const fileTgzLock=record('zod@file:vendor/zod-3.25.76.tgz','    version: 3.25.76\n').replace('      zod:\n        specifier: 4.6.7\n        version: 4.6.7','      zod:\n        specifier: file:vendor/zod-3.25.76.tgz\n        version: file:vendor/zod-3.25.76.tgz');
 const urlLock=record("'zod@https://example.invalid/zod.tgz'",'    version: 3.25.76\n');
 const gitLock=record('zod@git+https://example.invalid/zod.git#abc');
 const otherVersionLock=record('zod@4.6.7').replace('    resolution: {directory: vendor/zod, type: directory}\n\nsnapshots','    resolution: {integrity: x}\n\nsnapshots');
 // Valid YAML for the same content, whichever quoting style a tool chose.
 const quoted=(lock:string,from:string,to:string)=>{assert.ok(lock.includes(from),from);return lock.replace(from,to);};
 const dqRecordLock=quoted(fileTgzLock,'  zod@file:vendor/zod-3.25.76.tgz:','  "zod@file:vendor/zod-3.25.76.tgz":');
 const dqPeerRecordLock=quoted(expoLock,'  zod@3.25.76: {}','  "other@1.0.0(zod@file:vendor/zod)": {}\n\n  zod@3.25.76: {}');
 const dqValueLock=consumer('zod-old: "zod@3.25.76"');
 const dqKeyLock=consumer('"zod": 3.25.76');
 const dqDirectLock=quoted(directAliasLock,'version: zod@3.25.76','version: "zod@3.25.76"');
 const dqOwnerLock=quoted(expoLock,"  '@expo/cli@57.0.28(expo@57.0.27)':",'  "@expo/cli@57.0.28(expo@57.0.27)":');
 const run=(versions:string[],lock:string|null=expoLock,accepted:unknown[]=[entry],ghsa='GHSA-test',label='mobile')=>{
  writeFileSync(join(dir,'audit-accepted.json'),JSON.stringify({accepted}));
  rmSync(join(dir,'pnpm-lock.yaml'),{force:true});
  if(lock!==null)writeFileSync(join(dir,'pnpm-lock.yaml'),lock);
  const findings=versions.map(version=>({version,paths:[]}));
  const report={advisories:{1:{severity:'high',module_name:'zod',github_advisory_id:ghsa,vulnerable_versions:'<4.6.6',url:'x',findings}}};
  return spawnSync(process.execPath,[join(dir,'audit-gate.mjs'),label],{cwd:dir,input:JSON.stringify(report),encoding:'utf8'}).status;
 };
 assert.equal(run(['3.25.76']),0,'the Expo tooling copy is accepted');
 assert.equal(run(['4.6.5']),1,'a vulnerable direct zod blocks');
 assert.equal(run(['3.25.76','4.6.5']),1,'a mix of accepted and unaccepted versions blocks');
 assert.equal(run(['3.25.76'],otherLock),1,'another package needing the accepted version blocks');
 assert.equal(run(['3.25.76'],directLock),1,'the accepted version as a direct dependency blocks');
 assert.equal(run(['3.25.76'],aliasLock),1,'another package needing the version through an alias blocks');
 assert.equal(run(['3.25.76'],quotedAliasLock),1,'a scoped alias in a package blocks');
 assert.equal(run(['3.25.76'],peerAliasLock),1,'an alias with a peer suffix blocks');
 assert.equal(run(['3.25.76'],directAliasLock),1,'a direct alias blocks');
 assert.equal(run(['3.25.76'],scopedAliasLock),1,'a scoped direct alias blocks');
 assert.equal(run(['3.25.76'],devAliasLock),1,'a dev alias blocks');
 assert.equal(run(['3.25.76'],fileDirLock),1,'a file directory copy blocks');
 assert.equal(run(['3.25.76'],fileTgzLock),1,'a file tarball copy blocks');
 assert.equal(run(['3.25.76'],urlLock),1,'a tarball URL copy blocks');
 assert.equal(run(['3.25.76'],gitLock),1,'a git copy blocks');
 assert.equal(run(['3.25.76'],dqRecordLock),1,'a double-quoted record blocks');
 assert.equal(run(['3.25.76'],dqPeerRecordLock),1,'a non-registry copy named only in a peer suffix blocks');
 assert.equal(run(['3.25.76'],dqValueLock),1,'a double-quoted alias value blocks');
 assert.equal(run(['3.25.76'],dqKeyLock),1,'a double-quoted dependency name blocks');
 assert.equal(run(['3.25.76'],dqDirectLock),1,'a double-quoted direct alias blocks');
 assert.equal(run(['3.25.76'],dqOwnerLock),0,'quoting the accepted package itself changes nothing');
 assert.equal(run(['3.25.76'],otherVersionLock),0,'another registry version of the package does not void the entry');
 assert.equal(run(['3.25.76'],expoLock,[entry],'GHSA-other'),1,'another advisory on the accepted copy still blocks');
 assert.equal(run(['3.25.76'],expoLock,[entry],'GHSA-test','web'),1,'the same advisory in another lockfile still blocks');
 assert.equal(run(['3.25.76'],null),1,'no lockfile to check blocks');
 assert.equal(run([]),1,'a scoped entry with nothing to match blocks');
 assert.equal(run(['3.25.76'],expoLock,[{...entry,until:'2000-01-01'}]),1,'an expired acceptance blocks');
 const unscoped={ghsa:entry.ghsa,package:entry.package,lockfile:entry.lockfile,until:entry.until};
 assert.equal(run(['9.9.9'],expoLock,[unscoped]),0,'an entry without a scope keeps its meaning');
 console.log('Audit gate: scoped acceptance covers only its version and the named dependency, read from the lockfile, aliases included; a non-registry copy or anything else blocks.');
}finally{rmSync(dir,{recursive:true,force:true});}
