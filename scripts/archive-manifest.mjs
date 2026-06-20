import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacy = resolve(root, 'archive/legacy');
const manifestFile = resolve(root, 'archive/legacy-sha256.json');
async function files(dir) {
  const result=[];
  for (const item of await readdir(dir,{withFileTypes:true})) {
    const path=resolve(dir,item.name);
    if(item.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
const actual={};
for(const file of (await files(legacy)).sort()) actual[relative(legacy,file).replaceAll('\\','/')]=await sha256(file);
if(process.argv.includes('--write')) {
  await writeFile(manifestFile,JSON.stringify(actual,null,2)+'\n');
  console.log(`recorded ${Object.keys(actual).length} legacy files`);
} else {
  const expected=JSON.parse(await readFile(manifestFile,'utf8'));
  if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error('archive/legacy differs from its SHA-256 manifest');
  console.log(`archive/legacy verified (${Object.keys(actual).length} files)`);
}
