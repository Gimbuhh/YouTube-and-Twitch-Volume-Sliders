// Reuse YouTube's HUD markup and styling without invoking a second volume
// adjustment. Keep a separate transient node so playback/seek feedback owned
// by YouTube is never overwritten or hidden by our cleanup.
export function createYouTubeVolumeFeedback({ window, player }) {
  let popup = null;
  let timer = 0;
  const clear = () => {
    window.clearTimeout(timer);
    timer = 0;
    popup?.remove();
    popup = null;
  };
  const onKey = event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') clear();
  };
  player.addEventListener('pointerdown', clear, true);
  player.addEventListener('keydown', onKey, true);
  return {
    show(value) {
      const source = player.querySelector('.ytp-bezel-text-wrapper')?.parentElement;
      const speaker = player.querySelector('.ytp-mute-button svg');
      if (!source || !speaker) return;
      if (!popup) {
        popup = source.cloneNode(true);
        popup.dataset.tmVolumeFeedback = 'true';
        popup.style.pointerEvents = 'none';
        // Our inactivity timer owns visibility. Native forwards-filled fades
        // otherwise finish while repeated keys keep this same popup alive.
        for (const element of popup.querySelectorAll('.ytp-bezel-text-wrapper, .ytp-bezel')) {
          element.style.animation = 'none';
          element.style.opacity = '1';
        }
        player.appendChild(popup);
      }
      const icon = speaker.cloneNode(true);
      for (const use of icon.querySelectorAll('use')) use.remove();
      popup.querySelector('.ytp-bezel-icon')?.replaceChildren(icon);
      for (const element of [popup, ...popup.querySelectorAll('[id]')]) element.removeAttribute('id');
      popup.querySelector('.ytp-bezel')?.setAttribute('aria-label', `Volume ${value}%`);
      popup.querySelector('.ytp-bezel-text').textContent = `${value}%`;
      popup.classList.remove('ytp-bezel-text-hide');
      popup.style.display = '';
      window.clearTimeout(timer);
      timer = window.setTimeout(clear, 500);
    },
    dispose() {
      clear();
      player.removeEventListener('pointerdown', clear, true);
      player.removeEventListener('keydown', onKey, true);
    }
  };
}
