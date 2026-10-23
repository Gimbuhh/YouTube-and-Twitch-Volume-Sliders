// Site/player restores also emit volumechange. Only a gesture on the native
// volume control authorizes adopting its output as a new listening preference.
export function bindNativeVolumeInput({ window, video, player, selector, normalizer, onChange }) {
  let active = true;
  const types = ['pointerdown', 'pointermove', 'input', 'change', 'wheel', 'keydown'];
  const onInput = event => {
    if (!event.target?.closest?.(selector) || !player.contains(event.target)) return;
    if (event.type === 'pointermove' && !event.buttons) return;
    if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    // Run after the site's handler has set native volume, including handlers
    // that stop propagation. No audio tick can interleave with this gesture.
    window.queueMicrotask(() => {
      if (!active || !video.isConnected) return;
      normalizer.acceptNativeVolume(video);
      onChange();
    });
  };
  for (const type of types) window.document.addEventListener(type, onInput, true);
  return () => {
    active = false;
    for (const type of types) window.document.removeEventListener(type, onInput, true);
  };
}
