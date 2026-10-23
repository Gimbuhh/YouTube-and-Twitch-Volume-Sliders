import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildReleasePaths, parseReleaseTag, preflightRelease } from '../../scripts/release-preflight.mjs';

async function releaseFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'volume-preflight-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = buildReleasePaths('2.7');
  const manifest = {};
  for (const platform of ['youtube', 'twitch']) {
    const file = join(root, paths[`${platform}Asset`]);
    const bytes = `${platform} archived userscript\n`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    manifest[platform] = { archive: createHash('sha256').update(bytes).digest('hex').toUpperCase() };
  }
  await mkdir(join(root, 'release-notes'));
  await writeFile(join(root, paths.notesFile), 'Release notes\n');
  const writeManifest = () => writeFile(join(root, paths.manifestFile), JSON.stringify(manifest));
  await writeManifest();
  return { root, paths, manifest, writeManifest };
}

test('release preflight accepts supported two and three component tags', () => {
  assert.equal(parseReleaseTag('v2.7'), '2.7');
  assert.equal(parseReleaseTag('v2.6.9'), '2.6.9');
});

test('release preflight rejects malformed and path-like tags', () => {
  for (const tag of ['2.7', 'v2', 'v2.7.0.1', 'v../2.7', 'v2.7/bad']) {
    assert.throws(() => parseReleaseTag(tag));
  }
});

test('release paths are canonical and contained', () => {
  const paths = buildReleasePaths('2.7');
  assert.equal(paths.notesFile, 'release-notes/2.7.md');
  assert.match(paths.youtubeAsset, /^archive\/releases\/2\.7\//);
  assert.match(paths.twitchAsset, /^archive\/releases\/2\.7\//);
});

test('release preflight verifies both archived assets and supports historical backfills', async t => {
  const { root, paths, manifest } = await releaseFixture(t);
  const current = await preflightRelease({ root, tag: 'v2.7', packageVersion: '2.7' });
  assert.equal(current.version, '2.7');
  assert.equal(current.youtubeAsset, paths.youtubeAsset);
  assert.equal(current.twitchAsset, paths.twitchAsset);
  assert.deepEqual(current.expectedHashes, { youtube: manifest.youtube.archive, twitch: manifest.twitch.archive });
  const historical = await preflightRelease({ root, tag: 'v2.7', packageVersion: '2.9', mode: 'historical' });
  assert.equal(historical.mode, 'historical');
});

test('release preflight rejects package mismatches and unsupported modes', async t => {
  const { root } = await releaseFixture(t);
  await assert.rejects(preflightRelease({ root, tag: 'v2.7', packageVersion: '2.9' }), /does not match package/);
  await assert.rejects(preflightRelease({ root, tag: 'v2.7', packageVersion: '2.7', mode: 'unknown' }), /Unsupported release mode/);
});

test('release preflight rejects tampering and malformed hashes for either platform', async t => {
  for (const platform of ['youtube', 'twitch']) await t.test(platform, async t => {
    const { root, paths, manifest, writeManifest } = await releaseFixture(t);
    const request = { root, tag: 'v2.7', packageVersion: '2.7' };
    await writeFile(join(root, paths[`${platform}Asset`]), 'tampered bytes');
    await assert.rejects(preflightRelease(request), new RegExp(`${platform} archive hash mismatch`));
    manifest[platform].archive = 'invalid';
    await writeManifest();
    await assert.rejects(preflightRelease(request), new RegExp(`Invalid ${platform} archive hash`));
  });
});

test('release preflight requires every declared file and rejects directories', async t => {
  for (const key of ['youtubeAsset', 'twitchAsset', 'notesFile', 'manifestFile']) await t.test(key, async t => {
    const { root, paths } = await releaseFixture(t);
    const request = { root, tag: 'v2.7', packageVersion: '2.7' };
    const file = join(root, paths[key]);
    await rm(file);
    await assert.rejects(preflightRelease(request), { code: 'ENOENT' });
    await mkdir(file);
    await assert.rejects(preflightRelease(request), /Expected a file/);
  });
});
