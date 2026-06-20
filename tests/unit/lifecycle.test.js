import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOverlayLifecycle, createVideoLocator } from '../../src/shared/lifecycle.js';

test('overlay lifecycle owns and idempotently disposes detached roots',()=>{
  let cleaned=0,removed=0; const root={remove:()=>removed++}; const lifecycle=createOverlayLifecycle();
  lifecycle.set(root,()=>cleaned++); assert.equal(lifecycle.owns(root),true); lifecycle.dispose(); lifecycle.dispose();
  assert.equal(cleaned,1); assert.equal(removed,1); assert.equal(lifecycle.active,null);
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
