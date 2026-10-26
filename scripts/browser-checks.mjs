import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const selected = process.argv[2] || 'all';
if (!['all', 'chrome', 'firefox'].includes(selected)) throw new Error('Usage: node scripts/browser-checks.mjs [all|chrome|firefox]');
const suites = {
  chrome: ['smoke.mjs', 'normalization-icon.mjs', 'audio-ownership.mjs', 'normalization.mjs', 'native-audio-startup.mjs', 'native-gain-graph.mjs'],
  firefox: ['firefox.mjs', ['audio-ownership.mjs', '--firefox'], ['native-gain-graph.mjs', '--firefox']]
};
for (const [browser, scripts] of Object.entries(suites)) {
  if (selected !== 'all' && selected !== browser) continue;
  if (browser === 'chrome') {
    const ffmpeg = spawnSync(process.env.VOLUME_SLIDER_FFMPEG || 'ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
    if (ffmpeg.error || ffmpeg.status !== 0) throw new Error('Chrome startup tests require FFmpeg on PATH or VOLUME_SLIDER_FFMPEG pointing to its executable');
  }
  for (const script of scripts) {
    const args = Array.isArray(script) ? script : [script];
    console.log(`Browser verification: ${browser} / ${args.join(' ')}`);
    const result = spawnSync(process.execPath, [`tests/browser/${args[0]}`, ...args.slice(1)], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log('Selected browser suites passed; no browser checks were skipped');
