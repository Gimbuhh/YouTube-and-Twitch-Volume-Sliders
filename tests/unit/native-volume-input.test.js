import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../helpers/runtime.js';
import { bindNativeVolumeInput } from '../../src/shared/native-volume-input.js';

test('native input is adopted after the site setter, including propagation-stopping handlers', async t => {
  const f = createRuntime(); t.after(f.close);
  f.document.body.innerHTML = '<div id="player"><video></video><input id="native"></div><input id="outside">';
  let raw = 17, updates = 0; const adopted = [];
  const control = f.document.getElementById('native');
  control.addEventListener('input', event => { raw = 22; event.stopPropagation(); });
  const dispose = bindNativeVolumeInput({ window: f.window, video: f.document.querySelector('video'), player: f.document.getElementById('player'), selector: '#native',
    normalizer: { acceptNativeVolume() { adopted.push(raw); } }, onChange: () => updates++ });
  control.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.deepEqual(adopted, []);
  await Promise.resolve(); assert.deepEqual(adopted, [22]); assert.equal(updates, 1);
  f.document.getElementById('outside').dispatchEvent(new f.window.Event('input', { bubbles: true }));
  control.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  await Promise.resolve(); assert.equal(updates, 1);
  control.dispatchEvent(new f.window.Event('input', { bubbles: true })); dispose();
  await Promise.resolve(); assert.equal(updates, 1, 'queued adoption cannot outlive its overlay');
});

test('a mute button inside native volume controls cannot adopt processed output', async t=>{
  const f=createRuntime();t.after(f.close);
  f.document.body.innerHTML='<div id="player"><video></video><div id="native"><button id="mute">Mute</button><input></div></div>';
  let adopted=0;
  const dispose=bindNativeVolumeInput({window:f.window,video:f.document.querySelector('video'),player:f.document.getElementById('player'),
    selector:'#native',excludeSelector:'#mute',normalizer:{acceptNativeVolume(){adopted++;}},onChange(){}});
  t.after(dispose);
  f.document.getElementById('mute').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));
  await Promise.resolve();assert.equal(adopted,0);
  f.document.querySelector('input').dispatchEvent(new f.window.Event('input',{bubbles:true}));
  await Promise.resolve();assert.equal(adopted,1,'actual slider input still adopts native volume');
});
