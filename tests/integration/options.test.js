import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { youtubeFixture } from '../helpers/fixtures.js';

test('built YouTube artifact manages options dialog focus and Escape restoration',async()=>{
  const runtime=createRuntime('https://www.youtube.com/watch?v=test',{runScripts:'outside-only'});
  youtubeFixture(runtime.document);
  runtime.window.eval(await readFile(new URL('../../dist/youtube-volume-slider.user.js',import.meta.url),'utf8'));
  const button=runtime.document.getElementById('tm-volume-options-button');
  button.focus(); button.click();
  const popup=runtime.document.getElementById('tm-volume-options-popup');
  assert.equal(popup.hidden,false); assert.equal(popup.contains(runtime.document.activeElement),true);
  runtime.document.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(popup.hidden,true); assert.equal(runtime.document.activeElement,button);
  runtime.close();
});
