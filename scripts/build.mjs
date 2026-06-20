import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { distPath, entryPath, parseMetadata, platforms } from './lib.mjs';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const platform of platforms) {
  const entry = await readFile(entryPath(platform), 'utf8');
  const { header } = parseMetadata(entry);
  const body = entry.replace(header, '');
  const minimumSourceBytes = platform === 'youtube' ? 55000 : 70000;
  const minimumArtifactBytes = platform === 'youtube' ? 68000 : 80000;
  const implementation = await readFile(new URL(`../src/platforms/${platform}.js`, import.meta.url), 'utf8');
  if (Buffer.byteLength(implementation) < minimumSourceBytes) {
    throw new Error(`${platform}: platform implementation is unexpectedly truncated`);
  }
  const result = await build({
    stdin: { contents: body, loader: 'js', resolveDir: fileURLToPath(new URL('../src/entries/', import.meta.url)), sourcefile: `${platform}.user.js` },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    minify: false,
    legalComments: 'none',
    banner: { js: `${header}\n\"use strict\";\n` }
  });
  const output = result.outputFiles[0].text.replace(/\r\n/g, '\n');
  const namedFunctionCount = (output.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g) ?? []).length;
  const assertions = [
    [(output.match(/\/\/ ==UserScript==/g) ?? []).length === 1, 'one metadata header'],
    [!/^\s*(?:import|export)\s/m.test(output), 'no unresolved modules'],
    [!output.includes('@require'), 'no @require'],
    [!output.includes('sourceMappingURL'), 'no source map'],
    [output.includes('"use strict"'), 'strict bundled IIFE']
    ,[namedFunctionCount >= (platform === 'youtube' ? 100 : 120), 'full behavior function parity']
    ,[Buffer.byteLength(output) >= minimumArtifactBytes, 'full behavior artifact size']
  ];
  for (const [ok, label] of assertions) if (!ok) throw new Error(`${platform}: expected ${label}`);
  await writeFile(distPath(platform), output);
  console.log(`built ${platform}`);
}
