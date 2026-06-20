import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { distPath, entryPath, parseMetadata, platforms, sha256 } from './lib.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const releaseScriptPath=fileURLToPath(import.meta.url);

function runNode(script,args=[]){
  const result=spawnSync(process.execPath,[resolve(root,script),...args],{cwd:root,stdio:'inherit'});
  if(result.status!==0)throw new Error(`${script} failed`);
}

function runNodeTests(){
  const result=spawnSync(process.execPath,['--test'],{cwd:root,stdio:'inherit'});
  if(result.status!==0)throw new Error('test suite failed');
}

function gitStatus(){
  const result=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
  if(result.error?.code==='ENOENT')return null;
  if(result.status!==0)throw new Error('Unable to verify Git worktree');
  return result.stdout;
}

export function parseStatusPaths(status){
  if(status===null)return null;
  return new Set(status.split(/\r?\n/).filter(Boolean).map(line=>line.slice(3).split(' -> ').at(-1)));
}

function isExpectedReleasePath(path,version){
  return path==='package.json' ||
    path==='src/entries/youtube.user.js' ||
    path==='src/entries/twitch.user.js' ||
    path==='dist/youtube-volume-slider.user.js' ||
    path==='dist/twitch-volume-slider.user.js' ||
    path===`archive/releases/${version}/` ||
    path.startsWith(`archive/releases/${version}/`);
}

export function assertOnlyExpectedNewChanges(beforeStatus,afterStatus,version){
  const before=parseStatusPaths(beforeStatus);
  const after=parseStatusPaths(afterStatus);
  if(before===null||after===null)return;
  const unexpected=[...after].filter(path=>!before.has(path)&&!isExpectedReleasePath(path,version));
  if(unexpected.length)throw new Error(`Release changed unexpected paths: ${unexpected.join(', ')}`);
}

export async function snapshotFiles(files){
  return new Map(await Promise.all(files.map(async file=>[
    file,
    await readFile(file).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))
  ])));
}

export async function restoreReleaseState(snapshots,destination){
  await rm(destination,{recursive:true,force:true});
  for(const [file,contents] of snapshots){
    if(contents===null)await rm(file,{force:true});
    else await writeFile(file,contents);
  }
}

function updateEntryVersion(source,version){
  return source
    .replace(/^(\/\/ @name\s+.*?)(?:\s+\d+(?:\.\d+)*)?$/m,(_,name)=>name.replace(/\s+\d+(?:\.\d+)*$/,'')+` ${version}`)
    .replace(/^\/\/ @version\s+.*$/m,`// @version      ${version}`);
}

async function assertDestinationMissing(destination,version){
  try{
    await access(destination,constants.F_OK);
    throw new Error(`Release archive already exists: ${version}`);
  }catch(error){
    if(error.code!=='ENOENT')throw error;
  }
}

async function preflight(version,destination){
  await assertDestinationMissing(destination,version);
  const notesFile=resolve(root,`release-notes/${version}.md`);
  const notes=await readFile(notesFile,'utf8').catch(()=>{throw new Error(`Missing release notes: release-notes/${version}.md`);});
  const packageFile=resolve(root,'package.json');
  const packageSource=await readFile(packageFile,'utf8');
  const packageData=JSON.parse(packageSource);
  if(!/^\d+(?:\.\d+)*$/.test(packageData.version))throw new Error('package.json has a non-numeric version');

  const entries=[];
  for(const platform of platforms){
    const file=fileURLToPath(entryPath(platform));
    const source=await readFile(file,'utf8');
    const current=parseMetadata(source).fields.get('version')?.[0];
    if(current!==packageData.version)throw new Error(`${platform}: entry version does not match package.json`);
    entries.push({platform,file,source});
  }
  runNode('scripts/archive-manifest.mjs');
  return {notes,packageFile,packageSource,packageData,entries,beforeStatus:gitStatus()};
}

export async function runRelease(version){
  if(!version||!/^\d+(?:\.\d+)*$/.test(version))throw new Error('Usage: pnpm release -- <numeric-version>');
  const destination=resolve(root,'archive/releases',version);
  const state=await preflight(version,destination);
  const ownedFiles=[
    state.packageFile,
    ...state.entries.map(entry=>entry.file),
    ...platforms.map(platform=>fileURLToPath(distPath(platform)))
  ];
  const snapshots=await snapshotFiles(ownedFiles);

  try{
    state.packageData.version=version;
    await writeFile(state.packageFile,JSON.stringify(state.packageData,null,2)+'\n');
    for(const entry of state.entries)await writeFile(entry.file,updateEntryVersion(entry.source,version));

    runNode('scripts/archive-manifest.mjs');
    runNode('scripts/build.mjs');
    runNode('scripts/validate-metadata.mjs');
    runNode('scripts/check-syntax.mjs');
    runNodeTests();
    runNode('scripts/verify-generated.mjs');
    runNode('scripts/security-scan.mjs');

    const versions=[];
    for(const platform of platforms)versions.push(parseMetadata(await readFile(distPath(platform),'utf8')).fields.get('version')[0]);
    if(new Set(versions).size!==1||versions[0]!==version)throw new Error('YouTube/Twitch versions do not match requested release');

    await mkdir(destination,{recursive:false});
    const hashes={};
    for(const platform of platforms){
      const display=platform==='youtube'?'YouTube':'Twitch';
      const folder=resolve(destination,`${display} Volume Slider ${version}`);
      await mkdir(folder,{recursive:true});
      const artifact=resolve(folder,`${display} Volume Slider ${version}.user.js`);
      await cp(fileURLToPath(distPath(platform)),artifact);
      await writeFile(resolve(folder,`PATCH_NOTES_${version}.txt`),state.notes);
      hashes[platform]={dist:await sha256(distPath(platform)),archive:await sha256(artifact)};
      if(hashes[platform].dist!==hashes[platform].archive)throw new Error(`${platform}: archive hash mismatch`);
    }
    await writeFile(resolve(destination,'SHA256.json'),JSON.stringify(hashes,null,2)+'\n');
    runNode('scripts/verify-release.mjs',[version]);
    assertOnlyExpectedNewChanges(state.beforeStatus,gitStatus(),version);
    console.log(`release ${version} archived with matching hashes`);
  }catch(error){
    await restoreReleaseState(snapshots,destination);
    throw error;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(releaseScriptPath)){
  const releaseArgs=process.argv.slice(2).filter(argument=>argument!=='--');
  if(releaseArgs.length!==1)throw new Error('Usage: pnpm release -- <numeric-version>');
  await runRelease(releaseArgs[0]);
}
