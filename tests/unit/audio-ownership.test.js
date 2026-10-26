import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudiblePlayback } from '../../src/shared/normalization-playback.js';
import { createVolumeNormalizer } from '../../src/shared/normalization.js';
import { createRuntime } from '../helpers/runtime.js';
import { mockAudioCapture } from '../helpers/audio.js';

test('enabled normalization reserves audio before samples exist and keeps that player choice until reload', t => {
  const runtime = createRuntime();
  const video = runtime.document.createElement('video');
  runtime.document.body.append(video);
  video.volume = .2;
  const audio = mockAudioCapture(runtime.window, video);
  audio.readyState = 0;
  const normalizer = createVolumeNormalizer({ window: runtime.window,
    getVolume: element => element.volume * 100, setVolume: (element, value) => { element.volume = value / 100; },
    isMuted: element => element.muted });
  t.after(() => { normalizer.setEnabled(false); runtime.close(); });
  normalizer.setEnabled(true);
  normalizer.bind(video, 20);
  assert.equal(audio.contexts.length, 0, 'priority must not need an active audio context');
  const external = new runtime.window.AudioContext();
  assert.throws(() => external.createMediaElementSource(video), { name: 'InvalidStateError' });
  assert.equal(external.sources.has(video), false);
  normalizer.setEnabled(false);
  assert.equal(video.volume, .2);
  assert.throws(() => external.createMediaElementSource(video), { name: 'InvalidStateError' }, 'switching the same player still requires a reload');
  const replacement = runtime.document.createElement('video');
  runtime.document.body.append(replacement);
  assert.doesNotThrow(() => external.createMediaElementSource(replacement), 'normalization off allows 7TV on a fresh player');
  normalizer.setEnabled(true);
  normalizer.bind(replacement, 20);
  assert.match(normalizer.getStatus(), /Another audio processor/);
});

test('an external source created during asynchronous readiness retains exclusive ownership', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.close());
  const video = runtime.document.createElement('video');
  runtime.document.body.append(video);
  const audio = mockAudioCapture(runtime.window, video), failures = [];
  const playback = createAudiblePlayback({ window: runtime.window, video, selected: .2,
    onMetrics() {}, onFailure: error => failures.push(error) });
  t.after(() => playback.dispose());
  // The native resume promise yields after acquiring the output but before
  // connecting it. Firefox's separate contexts allow this competing source.
  const external = new runtime.window.AudioContext();
  const source = external.createMediaElementSource(video);
  source.connect(external.destination);
  await playback.ready;
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, 'AudioSourceConflict');
  assert.equal(audio.contexts[0].sources.has(video), false, 'no parallel source can be created after the yield');
  assert.equal(source.connections.has(external.destination), true, 'the first processor keeps its route');
  assert.equal(external.closed, false);
});
