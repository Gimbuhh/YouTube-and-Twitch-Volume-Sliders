import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, modeKey:'tm-yt-volume-slider-mode', locationKey:'tm-yt-volume-slider-location', expandedKey:'tm-yt-volume-slider-always-expanded', sizeKey:'tm-yt-volume-slider-size', thicknessKey:'tm-yt-volume-slider-thickness' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, modeKey:'tm-twitch-volume-slider-mode', locationKey:'tm-twitch-volume-slider-location', expandedKey:'tm-twitch-volume-slider-always-expanded', sizeKey:'tm-twitch-volume-slider-size', thicknessKey:'tm-twitch-volume-slider-thickness' }
];

async function openOptions(config, mode = 'on', location = 'controls', setup = () => {}) {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  runtime.window.localStorage.setItem(config.modeKey, mode);
  runtime.window.localStorage.setItem(config.locationKey, location);
  setup(runtime.window.localStorage);
  runtime.window.eval(await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8'));
  const button=runtime.document.getElementById('tm-volume-options-button');
  button.focus(); button.click();
  const popup=runtime.document.getElementById('tm-volume-options-popup');
  return { runtime, button, popup };
}

function waitForTimers(runtime) {
  return new Promise((resolve)=>runtime.window.setTimeout(resolve,0));
}

function hideAndRevealControls(runtime, config) {
  if (config.file === 'youtube') {
    const player=runtime.document.getElementById('movie_player');
    player.classList.add('ytp-autohide');
    return waitForTimers(runtime).then(()=>{
      player.classList.remove('ytp-autohide','ytp-hide-controls');
      return waitForTimers(runtime);
    });
  }
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');
  controls.setAttribute('data-a-visible','false');
  controls.setAttribute('aria-hidden','true');
  return waitForTimers(runtime).then(()=>{
    controls.setAttribute('data-a-visible','true');
    controls.setAttribute('aria-hidden','false');
    return waitForTimers(runtime);
  });
}

for (const config of platforms) test(`${config.name}: options dialog contains focus and restores it on Escape`,async()=>{
  const {runtime,button,popup}=await openOptions(config);
  assert.equal(popup.hidden,false); assert.equal(popup.contains(runtime.document.activeElement),true);

  const hiddenOpacity=popup.querySelector('#tm-volume-options-opacity-section');
  assert.equal(hiddenOpacity.style.display,'none');
  const hiddenSize=popup.querySelector('#tm-volume-options-size-section');
  assert.equal(hiddenSize.style.display,'none');
  const thicknessSection=popup.querySelector('#tm-volume-options-thickness-section');
  assert.equal(thicknessSection.style.display,'');
  const lastVisible=popup.querySelector('#tm-volume-options-thickness-section button');
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

for (const config of platforms) test(`${config.name}: bar thickness option updates only the visual track`,async()=>{
  const {runtime,popup}=await openOptions(config);
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  assert.equal(slider.value,'75');
  slider.value='125';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const row=runtime.document.querySelector('.tm-volume-slider-row');
  const volumeSlider=runtime.document.getElementById('tm-volume-slider-range');
  assert.equal(runtime.window.localStorage.getItem(config.thicknessKey),'125');
  assert.equal(overlay.style.getPropertyValue('--tm-visual-track-h'),'13.75px');
  assert.equal(overlay.style.getPropertyValue('--tm-thumb-size'),'27.50px');
  assert.equal(row.style.getPropertyValue('--tm-visual-track-h'),'13.75px');
  assert.equal(row.style.getPropertyValue('--tm-thumb-size'),'27.50px');
  assert.equal(volumeSlider.style.height,'');
  runtime.close();
});

for (const config of platforms) test(`${config.name}: thickness drag previews expansion only when not always expanded`,async()=>{
  const {runtime,popup}=await openOptions(config);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  assert.equal(overlay.classList.contains('tm-collapsed'),true);

  slider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true}));
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: thickness input starts preview when first hold begins after controls reveal`,async()=>{
  const {runtime,popup}=await openOptions(config,'on','video');
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  await hideAndRevealControls(runtime, config);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);

  slider.value='80';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  slider.dispatchEvent(new runtime.window.Event('change',{bubbles:true}));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: thickness hold starts preview before reveal handlers can swallow it`,async()=>{
  const {runtime,popup}=await openOptions(config,'on','video');
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  await hideAndRevealControls(runtime, config);
  popup.addEventListener('pointerdown',(event)=>event.stopImmediatePropagation(),true);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);

  slider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true,composed:true}));
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: thickness drag preview works on the first hold when overlay is recreated`,async()=>{
  const {runtime,popup}=await openOptions(config);
  const originalOverlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  originalOverlay.remove();

  slider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true}));
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  assert.ok(overlay);
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: thickness drag does not collapse always-expanded slider`,async()=>{
  const {runtime,popup}=await openOptions(config,'on','controls',(storage)=>storage.setItem(config.expandedKey,'true'));
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=popup.querySelector('#tm-volume-options-thickness-section input[type="range"]');
  assert.equal(overlay.classList.contains('tm-expanded'),true);

  slider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true}));
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.close();
});

for (const config of platforms) test(`${config.name}: on-video opacity drags preview idle and active states`,async()=>{
  const {runtime,popup}=await openOptions(config,'on','video',(storage)=>storage.setItem(config.expandedKey,'true'));
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const [idleSlider, activeSlider]=popup.querySelectorAll('#tm-volume-options-opacity-section input[type="range"]');
  assert.equal(overlay.classList.contains('tm-expanded'),true);

  idleSlider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true}));
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  assert.equal(overlay.classList.contains('tm-expanded'),true);

  runtime.document.getElementById('tm-volume-options-always-expanded').click();
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);

  activeSlider.dispatchEvent(new runtime.window.Event('pointerdown',{bubbles:true}));
  assert.equal(overlay.classList.contains('tm-expanded'),true);
  runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
  await waitForTimers(runtime);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
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
