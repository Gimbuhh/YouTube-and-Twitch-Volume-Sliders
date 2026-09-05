export function createTwitchControlsVisibilityManager({
  window,
  MutationObserver,
  getTargets,
  areControlsHidden
}) {
  const owners = new Map();
  let observer = null;
  let observedTargets = [];
  let disposed = false;
  const touchedElements = new Set();

  function reveal() {
    if (disposed || owners.size === 0) return;
    const { root, shell, controls } = getTargets();
    [root, shell, controls].filter(Boolean).forEach(element => touchedElements.add(element));
    if (shell) {
      shell.classList.add('tm-volume-options-controls-shell-hold');
      shell.setAttribute('aria-hidden', 'false');
      shell.style.opacity = '1';
      shell.style.visibility = 'visible';
    }
    if (root) {
      root.classList.add('tm-volume-options-controls-hold');
      root.setAttribute('data-a-visible', 'true');
      root.setAttribute('aria-hidden', 'false');
      root.style.opacity = '1';
      root.style.visibility = 'visible';
    }
    if (controls) {
      controls.setAttribute('aria-hidden', 'false');
      controls.style.opacity = '1';
      controls.style.visibility = 'visible';
    }
    observeTargets();
  }

  function releaseStyles() {
    const { root, shell, controls } = getTargets();
    [root, shell, controls].filter(Boolean).forEach(element => touchedElements.add(element));
    for (const element of touchedElements) {
      element?.classList?.remove('tm-volume-options-controls-shell-hold');
      element?.classList?.remove('tm-volume-options-controls-hold');
      element?.style?.removeProperty('opacity');
      element?.style?.removeProperty('visibility');
      element?.style?.removeProperty('pointer-events');
    }
    touchedElements.clear();
  }

  function disconnectObserver() {
    observer?.disconnect();
    observer = null;
    observedTargets = [];
  }

  function observeTargets() {
    if (disposed || owners.size === 0 || !MutationObserver) return;
    const { root, shell, controls } = getTargets();
    const nextTargets = [shell, root, controls].filter(Boolean);
    if (nextTargets.length === observedTargets.length && nextTargets.every((target, index) => target === observedTargets[index])) return;
    disconnectObserver();
    if (!nextTargets.length) return;
    observedTargets = nextTargets;
    observer = new MutationObserver(() => {
      if (owners.size && areControlsHidden()) reveal();
    });
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['aria-hidden', 'style', 'class'] });
    if (root) observer.observe(root, { attributes: true, attributeFilter: ['data-a-visible', 'aria-hidden', 'style', 'class'] });
    if (controls) observer.observe(controls, { attributes: true, attributeFilter: ['aria-hidden', 'style', 'class'] });
  }

  function clearOwnerTimer(owner) {
    const entry = owners.get(owner);
    if (entry?.timer) window.clearTimeout(entry.timer);
  }

  function hold(owner, duration = 0, onExpire) {
    if (disposed || !owner) return;
    clearOwnerTimer(owner);
    const entry = { timer: 0 };
    owners.set(owner, entry);
    reveal();
    if (duration > 0) {
      entry.timer = window.setTimeout(() => {
        entry.timer = 0;
        release(owner);
        onExpire?.();
      }, duration);
    }
  }

  function release(owner) {
    if (!owners.has(owner)) return;
    clearOwnerTimer(owner);
    owners.delete(owner);
    if (owners.size) {
      reveal();
      return;
    }
    disconnectObserver();
    releaseStyles();
  }

  function has(owner) {
    return owners.has(owner);
  }

  function dispose() {
    if (disposed) return;
    for (const owner of owners.keys()) clearOwnerTimer(owner);
    owners.clear();
    disconnectObserver();
    releaseStyles();
    disposed = true;
  }

  return { hold, release, has, reveal, dispose, get size() { return owners.size; } };
}
