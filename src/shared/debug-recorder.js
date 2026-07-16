const DEBUG_WINDOW_MS = 10_000;
const SAMPLE_INTERVAL_MS = 100;
const MAX_EVENTS = 600;

export function createDebugNodeIdentifier(prefix = 'node') {
  const ids = new WeakMap();
  let next = 1;
  return (node) => {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    if (!ids.has(node)) ids.set(node, `${prefix}-${next++}`);
    return ids.get(node);
  };
}

function compactValue(value, depth = 0) {
  if (depth > 3) return '[depth-limit]';
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 20).map(item => compactValue(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      try { result[key] = compactValue(item, depth + 1); } catch { result[key] = '[unavailable]'; }
    }
    return result;
  }
  return String(value);
}

export function createRollingDebugRecorder({ window, document, platform, getSnapshot }) {
  const events = [];
  let lastSample = '';
  let lastSampleAt = 0;
  const startedAt = Date.now();

  function trim(now = Date.now()) {
    const cutoff = now - DEBUG_WINDOW_MS;
    while (events.length && events[0].time < cutoff) events.shift();
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function record(type, detail = {}) {
    const now = Date.now();
    events.push({
      time: now,
      offsetMs: Math.round(window.performance?.now?.() ?? now - startedAt),
      type,
      detail: compactValue(detail)
    });
    trim(now);
  }

  function readSnapshot() {
    try { return compactValue(getSnapshot?.() ?? {}); }
    catch (error) { return { snapshotError: compactValue(error) }; }
  }

  const sampleTimer = window.setInterval(() => {
    const snapshot = readSnapshot();
    const serialized = JSON.stringify(snapshot);
    const now = Date.now();
    if (serialized !== lastSample || now - lastSampleAt >= 1000) {
      record('sample', snapshot);
      lastSample = serialized;
      lastSampleAt = now;
    }
  }, SAMPLE_INTERVAL_MS);

  function capture() {
    record('capture', readSnapshot());
    trim();
    const payload = {
      format: 'volume-slider-debug-v1',
      platform,
      capturedAt: new Date().toISOString(),
      page: { href: window.location.href, visibilityState: document.visibilityState },
      userAgent: window.navigator?.userAgent,
      windowMs: DEBUG_WINDOW_MS,
      events: [...events]
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      const blob = new window.Blob([json], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `volume-slider-${platform}-debug-${stamp}.json`;
      link.href = url;
      link.style.display = 'none';
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (error) {
      record('capture-download-error', error);
    }
    window.console?.info?.(`[Volume Slider] ${platform} debug capture`, payload);
    return payload;
  }

  const hotkeyHandler = (event) => {
    if (event.code !== 'KeyD' || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    capture();
  };
  document.addEventListener('keydown', hotkeyHandler, true);

  const recordPageEvent = (event) => record(`page:${event.type}`, { href: window.location.href });
  ['popstate', 'hashchange', 'pageshow', 'pagehide'].forEach(type => window.addEventListener(type, recordPageEvent, true));
  document.addEventListener('visibilitychange', recordPageEvent, true);
  record('start', readSnapshot());

  return {
    record,
    capture,
    dispose() {
      window.clearInterval(sampleTimer);
      document.removeEventListener('keydown', hotkeyHandler, true);
      ['popstate', 'hashchange', 'pageshow', 'pagehide'].forEach(type => window.removeEventListener(type, recordPageEvent, true));
      document.removeEventListener('visibilitychange', recordPageEvent, true);
    }
  };
}
