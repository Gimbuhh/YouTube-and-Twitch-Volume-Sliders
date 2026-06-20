import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distPath, platforms, sha256 } from './lib.mjs';

const before = Object.fromEntries(await Promise.all(platforms.map(async p => [p, await sha256(distPath(p))])));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build.mjs', import.meta.url))], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
for (const platform of platforms) {
  if (before[platform] !== await sha256(distPath(platform))) throw new Error(`${platform}: nondeterministic build`);
}
const temp = await mkdtemp(join(tmpdir(), 'volume-sliders-'));
await rm(temp, { recursive: true, force: true });
console.log('generated artifacts are deterministic');
