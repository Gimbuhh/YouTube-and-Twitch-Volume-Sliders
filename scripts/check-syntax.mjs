import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { distPath, platforms } from './lib.mjs';

for (const platform of platforms) {
  new vm.Script(await readFile(distPath(platform), 'utf8'), { filename: fileURLToPath(distPath(platform)) });
  console.log(`${platform}: valid JavaScript`);
}
