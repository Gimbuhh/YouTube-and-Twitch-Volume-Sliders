import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { distPath, entryPath, parseMetadata, platforms, sha256 } from './lib.mjs';

const releaseArgs=process.argv.slice(2).filter(argument=>argument!=='--');
const version=releaseArgs[0];
if(releaseArgs.length!==1 || !/^\d+(?:\.\d+)*$/.test(version)) throw new Error('Usage: pnpm release -- <numeric-version>');
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(root,'archive/releases',version);
try { await access(destination,constants.F_OK); throw new Error(`Release archive already exists: ${version}`); } catch(error) { if(error.code!=='ENOENT') throw error; }
const notesFile=resolve(root,`release-notes/${version}.md`);
const notes=await readFile(notesFile,'utf8').catch(()=>{throw new Error(`Missing release notes: release-notes/${version}.md`);});

for(const platform of platforms){
  const file=entryPath(platform); const source=await readFile(file,'utf8'); const metadata=parseMetadata(source);
  const current=metadata.fields.get('version')?.[0];
  if(!current || !/^\d+(?:\.\d+)*$/.test(current)) throw new Error(`${platform}: non-numeric version`);
  const updated=source.replace(/^(\/\/ @name\s+.*?)(?:\s+\d+(?:\.\d+)*)?$/m,(_,name)=>name.replace(/\s+\d+(?:\.\d+)*$/,'')+` ${version}`).replace(/^\/\/ @version\s+.*$/m,`// @version      ${version}`);
  await writeFile(file,updated);
}
const run=(script,args=[])=>{const result=spawnSync(process.execPath,[resolve(root,script),...args],{stdio:'inherit'});if(result.status!==0)throw new Error(`${script} failed`);};
run('scripts/archive-manifest.mjs'); run('scripts/build.mjs'); run('scripts/validate-metadata.mjs'); run('scripts/check-syntax.mjs'); run('scripts/security-scan.mjs');
const versions=[];
for(const platform of platforms) versions.push(parseMetadata(await readFile(distPath(platform),'utf8')).fields.get('version')[0]);
if(new Set(versions).size!==1 || versions[0]!==version) throw new Error('YouTube/Twitch versions do not match requested release');
const git=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
if(git.error?.code==='ENOENT') console.warn('warning: Git unavailable; relying on immutable SHA-256 manifests');
else if(git.status!==0) throw new Error('Unable to verify Git worktree');
else if(git.stdout.trim()) throw new Error('Git worktree is dirty');

await mkdir(destination,{recursive:true});
const hashes={};
for(const platform of platforms){
  const display=platform==='youtube'?'YouTube':'Twitch'; const folder=resolve(destination,`${display} Volume Slider ${version}`);
  await mkdir(folder,{recursive:true}); const artifact=resolve(folder,`${display} Volume Slider ${version}.user.js`);
  await cp(fileURLToPath(distPath(platform)),artifact); await writeFile(resolve(folder,`PATCH_NOTES_${version}.txt`),notes);
  hashes[platform]={dist:await sha256(distPath(platform)),archive:await sha256(artifact)};
  if(hashes[platform].dist!==hashes[platform].archive) throw new Error(`${platform}: archive hash mismatch`);
}
await writeFile(resolve(destination,'SHA256.json'),JSON.stringify(hashes,null,2)+'\n');
console.log(`release ${version} archived with matching hashes`);
