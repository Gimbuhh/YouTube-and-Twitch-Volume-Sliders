import { readFile } from 'node:fs/promises';
import { distPath, parseMetadata, platforms } from './lib.mjs';

const singular = ['name', 'namespace', 'version', 'description', 'author', 'icon', 'match', 'updateURL', 'downloadURL', 'run-at', 'grant'];
const repoRawBase = 'https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist';
const expectedNames = new Map([
  ['youtube', 'YouTube Volume Slider'],
  ['twitch', 'Twitch Volume Slider']
]);
const expectedRunAt = new Map([
  ['youtube', 'document-start'],
  ['twitch', 'document-start']
]);
let releaseVersion;
for (const platform of platforms) {
  const { fields } = parseMetadata(await readFile(distPath(platform), 'utf8'));
  for (const key of singular) {
    if ((fields.get(key) ?? []).length !== 1) throw new Error(`${platform}: expected exactly one @${key}`);
  }
  if (fields.get('name')[0] !== expectedNames.get(platform)) throw new Error(`${platform}: invalid @name`);
  if (fields.get('run-at')[0] !== expectedRunAt.get(platform)) throw new Error(`${platform}: invalid @run-at`);
  if (fields.get('grant')[0] !== 'none') throw new Error(`${platform}: invalid @grant`);
  const expectedUpdateUrl = `${repoRawBase}/${platform}-volume-slider.user.js`;
  if (fields.get('updateURL')[0] !== expectedUpdateUrl) throw new Error(`${platform}: invalid @updateURL`);
  if (fields.get('downloadURL')[0] !== expectedUpdateUrl) throw new Error(`${platform}: invalid @downloadURL`);
  if (fields.has('require')) throw new Error(`${platform}: @require is forbidden`);
  const version = fields.get('version')[0];
  if (!/^\d+(?:\.\d+)*$/.test(version)) throw new Error(`${platform}: non-numeric version`);
  releaseVersion ??= version;
  if (version !== releaseVersion) throw new Error('Platform versions differ');
  console.log(`${platform}: metadata valid (${version})`);
}
