import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Release tag must start with v');
  const version = tag.slice(1);
  if (!VERSION_PATTERN.test(version)) throw new Error('Release tag has an unsupported version');
  return version;
}

export function buildReleasePaths(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error('Unsafe release version');
  const archiveRoot = path.posix.join('archive', 'releases', version);
  return {
    youtubeAsset: path.posix.join(archiveRoot, `YouTube Volume Slider ${version}`, `YouTube Volume Slider ${version}.user.js`),
    twitchAsset: path.posix.join(archiveRoot, `Twitch Volume Slider ${version}`, `Twitch Volume Slider ${version}.user.js`),
    notesFile: path.posix.join('release-notes', `${version}.md`),
    manifestFile: path.posix.join(archiveRoot, 'SHA256.json')
  };
}

export async function preflightRelease({ root, tag, packageVersion, mode = 'current' }) {
  const version = parseReleaseTag(tag);
  if (mode === 'current' && packageVersion !== version) throw new Error(`Tag ${tag} does not match package ${packageVersion}`);
  if (!['current', 'historical'].includes(mode)) throw new Error('Unsupported release mode');
  const paths = buildReleasePaths(version);
  const absolute = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, path.resolve(root, ...value.split('/'))]));
  for (const file of Object.values(absolute)) {
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`Expected a file: ${file}`);
  }
  const manifest = JSON.parse(await readFile(absolute.manifestFile, 'utf8'));
  const expectedHashes = { youtube: manifest?.youtube?.archive, twitch: manifest?.twitch?.archive };
  for (const [platform, hash] of Object.entries(expectedHashes)) {
    if (!SHA256_PATTERN.test(hash || '')) throw new Error(`Invalid ${platform} archive hash`);
    const bytes = await readFile(absolute[`${platform}Asset`]);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== hash.toLowerCase()) throw new Error(`${platform} archive hash mismatch`);
  }
  return { mode, version, tag, ...paths, expectedHashes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tag, mode = 'current'] = process.argv.slice(2);
  const root = process.cwd();
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(await preflightRelease({ root, tag, mode, packageVersion: pkg.version }))}\n`);
}
