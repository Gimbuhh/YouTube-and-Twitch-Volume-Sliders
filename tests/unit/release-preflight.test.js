import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleasePaths, parseReleaseTag } from '../../scripts/release-preflight.mjs';

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
