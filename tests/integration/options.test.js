import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, modeKey:'tm-yt-volume-slider-mode' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, modeKey:'tm-twitch-volume-slider-mode' }
];

async function openOptions(config, mode = 'on') {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  runtime.window.localStorage.setItem(config.modeKey, mode);
  runtime.window.eval(await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8'));
  const button=runtime.document.getElementById('tm-volume-options-button');
  button.focus(); button.click();
  const popup=runtime.document.getElementById('tm-volume-options-popup');
  return { runtime, button, popup };
}

for (const config of platforms) test(`${config.name}: options dialog contains focus and restores it on Escape`,async()=>{
  const {runtime,button,popup}=await openOptions(config);
  assert.equal(popup.hidden,false); assert.equal(popup.contains(runtime.document.activeElement),true);

  const hiddenOpacity=popup.querySelector('#tm-volume-options-opacity-section');
  assert.equal(hiddenOpacity.style.display,'none');
  const lastVisible=popup.querySelector('#tm-volume-options-location-video');
  lastVisible.focus();
  const forward=new runtime.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  runtime.document.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented,true);
  assert.equal(runtime.document.activeElement.id,'tm-volume-options-mode-on');

  const backward=new runtime.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});
  runtime.document.dispatchEvent(backward);
  assert.equal(backward.defaultPrevented,true);
  assert.equal(runtime.document.activeElement,lastVisible);

  runtime.document.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(popup.hidden,true); assert.equal(runtime.document.activeElement,button);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: selected radio receives focus and arrow keys select within its group`,async()=>{
  const {runtime,popup}=await openOptions(config,'off');
  const off=popup.querySelector('#tm-volume-options-mode-off');
  const replace=popup.querySelector('#tm-volume-options-mode-replace-native');
  const on=popup.querySelector('#tm-volume-options-mode-on');
  assert.equal(runtime.document.activeElement,off);
  assert.deepEqual([on.tabIndex,off.tabIndex,replace.tabIndex],[-1,0,-1]);

  off.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(runtime.document.activeElement,replace);
  assert.equal(replace.getAttribute('aria-checked'),'true');
  assert.deepEqual([on.tabIndex,off.tabIndex,replace.tabIndex],[-1,-1,0]);

  replace.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(runtime.document.activeElement,on);
  assert.equal(on.getAttribute('aria-checked'),'true');
  assert.deepEqual([on.tabIndex,off.tabIndex,replace.tabIndex],[0,-1,-1]);
  runtime.close();
});
