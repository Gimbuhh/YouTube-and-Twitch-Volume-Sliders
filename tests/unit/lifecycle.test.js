import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCleanupRegistry, createOverlayLifecycle, createRafCoalescer, createVideoLocator } from '../../src/shared/lifecycle.js';

test('overlay lifecycle owns and idempotently disposes detached roots',()=>{
  let cleaned=0,removed=0; const root={remove:()=>removed++}; const lifecycle=createOverlayLifecycle();
  lifecycle.set(root,()=>cleaned++); assert.equal(lifecycle.owns(root),true); lifecycle.dispose(); lifecycle.dispose();
  assert.equal(cleaned,1); assert.equal(removed,1); assert.equal(lifecycle.active,null);
});

test('cleanup registry removes owned listeners and callbacks exactly once',()=>{
  const target=new EventTarget();
  const registry=createCleanupRegistry();
  let events=0,cleanups=0;
  registry.listen(target,'owned',()=>events++);
  registry.add(()=>cleanups++);
  target.dispatchEvent(new Event('owned'));
  registry.dispose();
  registry.dispose();
  target.dispatchEvent(new Event('owned'));
  assert.equal(events,1);
  assert.equal(cleanups,1);
  assert.equal(registry.disposed,true);
});

test('RAF coalescer schedules once and invalidates queued generations',()=>{
  const callbacks=[];
  const window={requestAnimationFrame:fn=>(callbacks.push(fn),callbacks.length),cancelAnimationFrame:()=>{}};
  let runs=0; const coalescer=createRafCoalescer(window,()=>runs++);
  coalescer.schedule(); coalescer.schedule(); assert.equal(callbacks.length,1);
  coalescer.invalidate(); callbacks.shift()(); assert.equal(runs,0);
  coalescer.schedule(); callbacks.shift()(); assert.equal(runs,1);
});

test('video locator chooses the largest connected video and resets cache',()=>{
  const dom=new JSDOM('<video id="small"></video><video id="large"></video>');
  const small=dom.window.document.getElementById('small'),large=dom.window.document.getElementById('large');
  Object.defineProperties(small,{clientWidth:{value:10},clientHeight:{value:10}});
  Object.defineProperties(large,{clientWidth:{value:20},clientHeight:{value:20}});
  const locator=createVideoLocator(dom.window.document,dom.window);
  assert.equal(locator.getVideoElement(),large); locator.resetVideoElement(); large.remove(); assert.equal(locator.getVideoElement(),small);
  dom.window.close();
});
