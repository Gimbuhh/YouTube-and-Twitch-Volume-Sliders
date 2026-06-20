import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const ROOT = new URL('../', import.meta.url);
export const platforms = ['youtube', 'twitch'];
export const distPath = (platform) => new URL(`../dist/${platform}-volume-slider.user.js`, import.meta.url);
export const entryPath = (platform) => new URL(`../src/entries/${platform}.user.js`, import.meta.url);

export function parseMetadata(source) {
  const match = source.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\r?$/m);
  if (!match) throw new Error('Missing userscript metadata block');
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\/\/\s+@(\S+)\s+(.+?)\s*$/);
    if (!item) continue;
    const values = fields.get(item[1]) ?? [];
    values.push(item[2]);
    fields.set(item[1], values);
  }
  return { header: match[0], fields };
}

export async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
}
