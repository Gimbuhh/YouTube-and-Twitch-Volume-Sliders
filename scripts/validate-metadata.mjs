import { readFile } from 'node:fs/promises';
import { distPath, parseMetadata, platforms } from './lib.mjs';

const singular = ['name', 'namespace', 'version', 'description', 'author', 'icon', 'match', 'run-at', 'grant'];
let releaseVersion;
for (const platform of platforms) {
  const { fields } = parseMetadata(await readFile(distPath(platform), 'utf8'));
  for (const key of singular) {
    if ((fields.get(key) ?? []).length !== 1) throw new Error(`${platform}: expected exactly one @${key}`);
  }
  if (fields.get('run-at')[0] !== 'document-idle') throw new Error(`${platform}: invalid @run-at`);
  if (fields.get('grant')[0] !== 'none') throw new Error(`${platform}: invalid @grant`);
  if (fields.has('require')) throw new Error(`${platform}: @require is forbidden`);
  const version = fields.get('version')[0];
  if (!/^\d+(?:\.\d+)*$/.test(version)) throw new Error(`${platform}: non-numeric version`);
  releaseVersion ??= version;
  if (version !== releaseVersion) throw new Error('Platform versions differ');
  console.log(`${platform}: metadata valid (${version})`);
}
