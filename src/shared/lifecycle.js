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

  function resetVideoElement() {
    cachedVideo = null;
  }

  function ensurePlayerPositioning(player) {
    if (player && window.getComputedStyle(player).position === 'static') player.style.position = 'relative';
  }

  return { getVideoElement, resetVideoElement, ensurePlayerPositioning };
}
