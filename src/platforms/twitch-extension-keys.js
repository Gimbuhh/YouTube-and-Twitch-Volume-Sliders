const messageType = 'tm-volume-player-key-v1';
const playerKeys = new Set(['ArrowUp', 'ArrowDown', ' ']);
const recentCommands = new WeakMap();
const extensionOrigin = origin => /^https:\/\/[a-z0-9-]+\.ext-twitch\.tv$/i.test(origin);
const interactive = 'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"], [role="combobox"]';

function validMessage(event) {
  return extensionOrigin(event.origin) && event.data?.type === messageType &&
    typeof event.data.id === 'string' && event.data.id.length > 0 && event.data.id.length <= 64 && playerKeys.has(event.data.key) &&
    !(event.data.key === ' ' && event.data.repeat);
}

// Twitch's supervisor wraps the actual extension in another cross-origin
// iframe. Relay only three unhandled player commands, never typed text or
// extension data. Neither pointer behavior nor extension-owned keys change.
export function startTwitchExtensionKeys(window) {
  if (window.parent === window || !extensionOrigin(window.location.origin)) return;
  // Run after the extension's target/document handlers have had their turn.
  window.addEventListener('keydown', event => {
    if (!playerKeys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === ' ' && event.repeat) return;
    if (event.target?.closest?.(interactive)) return;
    window.queueMicrotask(() => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({ type: messageType, id: window.crypto.randomUUID(), key: event.key, repeat: event.repeat }, '*');
    });
  });
  window.addEventListener('message', event => {
    const frame = window.document.activeElement;
    if (validMessage(event) && frame?.tagName === 'IFRAME' && frame.contentWindow === event.source) {
      window.parent.postMessage({ type: messageType, id: event.data.id, key: event.data.key, repeat: event.data.repeat === true }, '*');
    }
  });
}

export function focusedTwitchExtensionKey(event, player) {
  const frame = player?.ownerDocument.activeElement;
  if (!validMessage(event) || !frame?.matches?.('iframe.extension-view__iframe') ||
      !player.contains(frame) || frame.contentWindow !== event.source) return null;
  // Twitch's supervisor can forward the same packet alongside our relay.
  // Retain a bounded set per focused frame so duplicate or delayed copies
  // cannot apply a second volume step or toggle pause back off.
  let seen = recentCommands.get(frame);
  if (!seen) { seen = new Set(); recentCommands.set(frame, seen); }
  if (seen.has(event.data.id)) return null;
  seen.add(event.data.id);
  if (seen.size > 64) seen.delete(seen.values().next().value);
  return event.data.key;
}
