import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const roots=['src','scripts','tests','docs','dist'];
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{12,}/i,/AKIA[0-9A-Z]{16}/];
const matches=[];
async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,item.name);if(item.isDirectory())await scan(path);else{const source=await readFile(path,'utf8').catch(()=>null);if(source&&patterns.some(p=>p.test(source)))matches.push(relative(root,path));}}}
for(const dir of roots) await scan(resolve(root,dir));
if(matches.length){console.error(matches.join('\n'));process.exit(1);}
console.log('secret-pattern scan: no matching files');
