export function createOverlayLifecycle() {
  let active = null;

  return {
    get active() {
      return active;
    },

    owns(root) {
      return active?.root === root;
    },

    set(root, cleanup) {
      active = { root, cleanup };
    },

    dispose() {
      const owned = active;
      active = null;
      if (!owned) return;
      owned.cleanup();
      owned.root.remove();
    }
  };
}

export function createVideoLocator(document, window) {
  let cachedVideo = null;

  function getVideoElement() {
    if (cachedVideo?.isConnected) return cachedVideo;
    const videos = document.querySelectorAll('video');
    if (!videos.length) {
      cachedVideo = null;
      return null;
    }
    cachedVideo = [...videos].reduce((largest, video) => {
      const area = video.clientWidth * video.clientHeight;
      const largestArea = largest.clientWidth * largest.clientHeight;
      return area > largestArea ? video : largest;
    }, videos[0]);
    return cachedVideo;
  }

  function findBestVideoElement() {
    const previous = cachedVideo;
    cachedVideo = null;
    const candidate = getVideoElement();
    if (previous?.isConnected && candidate) {
      const previousArea = previous.clientWidth * previous.clientHeight;
      const candidateArea = candidate.clientWidth * candidate.clientHeight;
      if (previousArea === candidateArea) cachedVideo = previous;
    }
    return cachedVideo;
  }

  function resetVideoElement() {
    cachedVideo = null;
  }

  function ensurePlayerPositioning(player) {
    if (player && window.getComputedStyle(player).position === 'static') player.style.position = 'relative';
  }

  return { getVideoElement, findBestVideoElement, resetVideoElement, ensurePlayerPositioning };
}

export function createRafCoalescer(window, callback) {
  let frame = 0;
  let generation = 0;
  return {
    schedule() {
      if (frame) return;
      const ownedGeneration = generation;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (ownedGeneration === generation) callback();
      });
    },
    invalidate() {
      generation += 1;
      if (frame) window.cancelAnimationFrame?.(frame);
      frame = 0;
    },
    dispose() {
      this.invalidate();
    }
  };
}
