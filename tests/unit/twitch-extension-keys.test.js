import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../helpers/runtime.js';
import { startTwitchExtensionKeys, focusedTwitchExtensionKey } from '../../src/platforms/twitch-extension-keys.js';

const type = 'tm-volume-player-key-v1';
test('extension frames relay only unhandled player keys and preserve interactive controls', async t => {
  const f = createRuntime('https://example.ext-twitch.tv/extension'); t.after(f.close);
  const sent = []; Object.defineProperty(f.window, 'parent', { value: { postMessage: message => sent.push(message) } });
  f.document.body.innerHTML = '<input><button>Action</button><div id="empty"></div>';
  startTwitchExtensionKeys(f.window);
  const empty = f.document.getElementById('empty');
  const key = (target, value, options = {}) => {
    const event = new f.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event); return event;
  };
  const arrow = key(empty, 'ArrowUp'); await Promise.resolve(); assert.equal(sent.at(-1).key, 'ArrowUp');
  assert.equal(arrow.defaultPrevented, true, 'forwarding owns the browser default action');
  const count = sent.length;
  key(f.document.querySelector('input'), 'ArrowDown'); key(f.document.querySelector('button'), ' ');
  key(empty, 'a'); key(empty, ' ', { repeat: true }); key(empty, 'ArrowDown', { ctrlKey: true });
  empty.addEventListener('keydown', event => event.preventDefault());
  key(empty, 'ArrowDown'); await Promise.resolve(); assert.equal(sent.length, count);
});

test('supervisor relays only the focused child and player accepts only its focused overlay frame', t => {
  const f = createRuntime('https://supervisor.ext-twitch.tv/supervisor'); t.after(f.close);
  const sent = []; Object.defineProperty(f.window, 'parent', { value: { postMessage: message => sent.push(message) } });
  f.document.body.innerHTML = '<div id="player"><iframe class="extension-view__iframe"></iframe></div><iframe id="outside"></iframe>';
  const player = f.document.getElementById('player'), frame = player.querySelector('iframe');
  const message = { origin: 'https://example.ext-twitch.tv', source: frame.contentWindow, data: { type, id: 'one-press', key: 'ArrowDown' } };
  const nativeForwarded = [];
  f.window.addEventListener('message', event => nativeForwarded.push(event.data));
  startTwitchExtensionKeys(f.window); frame.focus();
  f.window.dispatchEvent(new f.window.MessageEvent('message', message)); assert.equal(sent.length, 1);
  assert.equal(nativeForwarded.length, 1, 'native forwarding may run alongside our relay');
  f.window.dispatchEvent(new f.window.MessageEvent('message', { ...message, data: { type: 'extension-owned-message' } }));
  assert.equal(nativeForwarded.length, 2, 'ordinary extension messages remain untouched');
  assert.equal(focusedTwitchExtensionKey(message, player), 'ArrowDown');
  assert.equal(focusedTwitchExtensionKey(message, player), null, 'a second copy cannot apply another step');
  const next = { ...message, data: { ...message.data, id: 'next-press' } };
  assert.equal(focusedTwitchExtensionKey(next, player), 'ArrowDown', 'separate presses and repeats remain distinct');
  assert.equal(focusedTwitchExtensionKey(message, player), null, 'a delayed copy stays ignored after a newer key');
  const unhandled = { ...message, data: { ...message.data, id: 'unhandled' } };
  for (const origin of ['https://evil.example', 'https://example.ext-twitch.tv.evil.example', 'http://example.ext-twitch.tv']) {
    assert.equal(focusedTwitchExtensionKey({ ...unhandled, origin }, player), null);
  }
  assert.equal(focusedTwitchExtensionKey({ ...unhandled, source: f.window }, player), null);
  assert.equal(focusedTwitchExtensionKey({ ...message, data: { type, key: 'a' } }, player), null);
  for (const id of [undefined, '', 123, 'x'.repeat(65)]) {
    assert.equal(focusedTwitchExtensionKey({ ...message, data: { ...message.data, id } }, player), null);
  }
  f.document.getElementById('outside').focus();
  assert.equal(focusedTwitchExtensionKey(unhandled, player), null);
  f.window.dispatchEvent(new f.window.MessageEvent('message', message)); assert.equal(sent.length, 1);
});
