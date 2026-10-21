import { clampVolume } from './volume.js';
import { createSpeakerIconGroup, getSpeakerIconMode } from './speaker-icon.js';

// Own the whole display: host artwork and animations can reflect corrected
// output or stale player state instead of the user's selected listening level.
export function createVolumeFeedback({ window, player }) {
  const document = player.ownerDocument;
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
    show(value, muted = false) {
      const percent = Math.round(clampVolume(value));
      if (!popup) {
        popup = document.createElement('div');
        popup.dataset.tmVolumeFeedback = 'true';
        popup.setAttribute('role', 'status');
        popup.setAttribute('aria-live', 'polite');
        popup.setAttribute('aria-atomic', 'true');
        Object.assign(popup.style, {
          all: 'initial',
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxSizing: 'border-box',
          maxWidth: 'calc(100% - 24px)',
          padding: '8px 12px',
          borderRadius: '6px',
          background: 'rgba(0,0,0,.7)',
          color: '#fff',
          font: '600 20px/1.2 Arial,Helvetica,sans-serif',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: '20'
        });
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('focusable', 'false');
        Object.assign(icon.style, { display: 'block', flex: 'none', width: '24px', height: '24px', color: 'inherit' });
        popup.append(icon, document.createTextNode(''));
        player.appendChild(popup);
      }
      const mode = getSpeakerIconMode(percent, muted);
      if (popup.dataset.volumeIcon !== mode) {
        popup.firstElementChild.replaceChildren(createSpeakerIconGroup(document, mode));
        popup.dataset.volumeIcon = mode;
      }
      popup.setAttribute('aria-label', `${muted ? 'Muted, volume' : 'Volume'} ${percent}%`);
      popup.lastChild.nodeValue = `${percent}%`;
      window.clearTimeout(timer);
      timer = window.setTimeout(clear, 500);
    },
    clear,
    dispose() {
      clear();
      player.removeEventListener('pointerdown', clear, true);
      player.removeEventListener('keydown', onKey, true);
    }
  };
}
