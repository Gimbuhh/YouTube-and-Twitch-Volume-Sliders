import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacyRoot = resolve(root, 'archive/legacy');
const archivedBy = '2026-03-29';
const platforms = [
  { directory: 'YouTube Volume Slider Versions', display: 'YouTube' },
  { directory: 'Twitch Volume Slider Versions', display: 'Twitch' },
];

const releases = new Map();
for (const platform of platforms) {
  const platformRoot = join(legacyRoot, platform.directory);
  for (const entry of await readdir(platformRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const version = entry.name.match(/(\d+(?:\.\d+)*)$/)?.[1];
    if (!version) throw new Error(`Cannot parse version from ${entry.name}`);
    const directory = join(platformRoot, entry.name);
    const files = await readdir(directory);
    const script = files.find(file => file.endsWith('.txt') && !file.startsWith('PATCH_NOTES_'));
    const notes = files.find(file => file.startsWith('PATCH_NOTES_'));
    if (!script) throw new Error(`Missing script in ${directory}`);
    const release = releases.get(version) ?? { version, platforms: [] };
    release.platforms.push({ ...platform, script: join(directory, script), notes: notes ? join(directory, notes) : null });
    releases.set(version, release);
  }
}

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

const stripTitle = text => text.replace(/^.*Patch Notes\s*-\s*Version[^\n]*\r?\n+/iu, '').trim();
const versions = [...releases.keys()].sort(compareVersions);
await mkdir(resolve(root, 'release-notes'), { recursive: true });

for (const version of versions) {
  const release = releases.get(version);
  const sections = [
    `# Volume Sliders ${version}`,
    '',
    `> Historical release. The exact original release date was not recorded; this version was archived by ${archivedBy}.`,
  ];
  for (const platform of release.platforms) {
    sections.push('', `## ${platform.display}`);
    if (platform.notes) sections.push('', stripTitle(await readFile(platform.notes, 'utf8')));
    else sections.push('', 'Original patch notes were not available for this build.');
  }
  await writeFile(resolve(root, 'release-notes', `${version}.md`), `${sections.join('\n').trim()}\n`);
}

const rows = versions.toReversed().map(version => {
  const release = releases.get(version);
  const available = platforms
    .filter(platform => release.platforms.some(item => item.display === platform.display))
    .map(platform => platform.display)
    .join(', ');
  return `| ${version} | Unknown; archived by ${archivedBy} | ${available} | [Notes](../release-notes/${version}.md) |`;
});

const history = [
  '# Version History',
  '',
  'Dates are reported only when supported by repository evidence. GitHub displays the date a historical Release was published to GitHub, which is not necessarily its original release date.',
  '',
  '| Version | Original release date | Available scripts | Details |',
  '| --- | --- | --- | --- |',
  '| 2.4.1 | 2026-06-20 | YouTube, Twitch | [Notes](../release-notes/2.4.1.md) |',
  '| 2.4 | 2026-06-19 | YouTube, Twitch | [Notes](../release-notes/2.4.md) |',
  ...rows,
  '',
];
await writeFile(resolve(root, 'docs/version-history.md'), history.join('\n'));

const manifest = versions.map(version => ({
  version,
  archivedBy,
  platforms: releases.get(version).platforms.map(platform => ({
    name: platform.display.toLowerCase(),
    script: relative(root, platform.script),
  })),
}));
await writeFile(resolve(root, 'archive/historical-releases.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`generated ${versions.length} historical release notes and archive/historical-releases.json`);
