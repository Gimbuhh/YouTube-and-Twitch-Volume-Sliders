import { JSDOM } from 'jsdom';

export function createRuntime(url = 'https://www.youtube.com/watch?v=test', options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, pretendToBeVisual: true, ...options });
  const liveObservers = new Set();
  const NativeObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); liveObservers.add(this); }
    disconnect() { liveObservers.delete(this); super.disconnect(); }
  };
  return {
    dom,
    window:dom.window,
    document:dom.window.document,
    liveObservers,
    close:()=>{
      for (const observer of [...liveObservers]) observer.disconnect();
      dom.window.close();
    }
  };
}
