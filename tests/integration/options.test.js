import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, modeKey:'tm-yt-volume-slider-mode', locationKey:'tm-yt-volume-slider-location', sizeKey:'tm-yt-volume-slider-size' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, modeKey:'tm-twitch-volume-slider-mode', locationKey:'tm-twitch-volume-slider-location', sizeKey:'tm-twitch-volume-slider-size' }
];

async function openOptions(config, mode = 'on', location = 'controls') {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  runtime.window.localStorage.setItem(config.modeKey, mode);
  runtime.window.localStorage.setItem(config.locationKey, location);
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
  const hiddenSize=popup.querySelector('#tm-volume-options-size-section');
  assert.equal(hiddenSize.style.display,'none');
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

for (const config of platforms) test(`${config.name}: on-video size option is active only for video placement`,async()=>{
  const {runtime,popup}=await openOptions(config,'on','video');
  const opacitySection=popup.querySelector('#tm-volume-options-opacity-section');
  const sizeSection=popup.querySelector('#tm-volume-options-size-section');
  assert.equal(opacitySection.style.display,'');
  assert.equal(sizeSection.style.display,'');

  const slider=popup.querySelector('#tm-volume-options-size-section input[type="range"]');
  assert.equal(slider.value,'100');
  slider.value='150';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(runtime.window.localStorage.getItem(config.sizeKey),'150');
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay').style.getPropertyValue('--tm-overlay-scale'),'1.5');

  const location=popup.querySelector('#tm-volume-options-location-video');
  location.click();
  assert.equal(sizeSection.style.display,'none');
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay').style.getPropertyValue('--tm-overlay-scale'),'1');
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
