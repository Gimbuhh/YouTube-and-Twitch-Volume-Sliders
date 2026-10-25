import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const missing = join(tmpdir(), `missing-browser-${randomUUID()}`);
function run(args, env) {
  return spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000 });
}

test('missing Chrome fails UI verification instead of reporting a successful skip', () => {
  const result = run(['tests/browser/smoke.mjs'], { VOLUME_SLIDER_CHROME: join(missing, 'chrome.exe') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /[Ee]xecutable.*(?:exist|found)/);
  assert.doesNotMatch(result.stdout, /skipped|passed/);
});

test('missing Firefox fails the runner and prevents later suites from reporting success', () => {
  const result = run(['scripts/browser-checks.mjs', 'firefox'], { PLAYWRIGHT_BROWSERS_PATH: missing });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /[Ee]xecutable.*(?:exist|found)/);
  assert.doesNotMatch(result.stdout, /native-gain-graph|suites passed/);
});

test('missing waveform decoder fails Chrome verification before running browser suites', () => {
  const result = run(['scripts/browser-checks.mjs', 'chrome'], { VOLUME_SLIDER_FFMPEG: join(missing, 'ffmpeg.exe') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require FFmpeg/);
  assert.doesNotMatch(result.stdout, /Browser verification|suites passed/);
});
