import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distPath, platforms, sha256 } from './lib.mjs';

const version=process.argv[2];
if(!version||!/^\d+(?:\.\d+)*$/.test(version))throw new Error('Usage: node scripts/verify-release.mjs <version>');
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(resolve(root,'archive/releases',version,'SHA256.json'),'utf8'));
for(const platform of platforms){const display=platform==='youtube'?'YouTube':'Twitch';const archive=resolve(root,'archive/releases',version,`${display} Volume Slider ${version}`,`${display} Volume Slider ${version}.user.js`);const distHash=await sha256(distPath(platform));const archiveHash=await sha256(archive);if(distHash!==archiveHash||manifest[platform].dist!==distHash||manifest[platform].archive!==archiveHash)throw new Error(`${platform}: release hashes do not match`);console.log(`${platform}: ${distHash}`);}
console.log(`release ${version} verified`);
