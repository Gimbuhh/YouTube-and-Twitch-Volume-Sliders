import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, volumeKey:'tm-yt-volume', modeKey:'tm-yt-volume-slider-mode', locationKey:'tm-yt-volume-slider-location' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, volumeKey:'tm-twitch-volume', modeKey:'tm-twitch-volume-slider-mode', locationKey:'tm-twitch-volume-slider-location' }
];

async function loadPlatform(config, setup = () => {}) {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  const fixture=config.fixture(runtime.document);
  setup(runtime,fixture);
  const source=await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  return {runtime,fixture};
}

for(const config of platforms){
  test(`${config.name}: full artifact restores volume without unmuting and slider input unmutes`,async()=>{
    const {runtime,fixture}=await loadPlatform(config,(current,currentFixture)=>{
      current.window.localStorage.setItem(config.volumeKey,'35');
      if(config.file==='youtube')currentFixture.player.mute();else currentFixture.player._tmPlayerApi.setMuted(true);
    });
    assert.equal(fixture.state.muted,true);
    const slider=runtime.document.getElementById('tm-volume-slider-range');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    assert.equal(label.textContent,'Muted');
    assert.ok(slider); slider.value='60'; slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
    assert.equal(fixture.state.muted,false); assert.equal(fixture.state.volume,config.file==='youtube'?60:.6);
    runtime.close();
  });

  test(`${config.name}: unrelated pointerup does not apply the saved slider value`,async()=>{
    const {runtime,fixture}=await loadPlatform(config,(current,currentFixture)=>{
      current.window.localStorage.setItem(config.volumeKey,'50');
      if(config.file==='youtube')currentFixture.player.mute();else currentFixture.player._tmPlayerApi.setMuted(true);
    });
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    assert.equal(fixture.state.muted,true);
    assert.ok(overlay.classList.contains('tm-collapsed'));
    runtime.window.dispatchEvent(new runtime.window.Event('pointerup'));
    assert.equal(fixture.state.muted,true);
    assert.ok(overlay.classList.contains('tm-collapsed'));
    runtime.close();
  });

  test(`${config.name}: full artifact exposes semantic controls and reattaches after detachment`,async()=>{
    const {runtime}=await loadPlatform(config);
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const mute=overlay.querySelector('button.tm-volume-icon-cell');
    assert.equal(overlay.hasAttribute('tabindex'),false); assert.equal(mute.getAttribute('aria-label'),'Mute');
    assert.equal(overlay.hasAttribute('title'),false); assert.equal(mute.hasAttribute('title'),false);
    overlay.remove(); await new Promise(resolve=>runtime.window.setTimeout(resolve,50));
    assert.equal(runtime.document.querySelectorAll('#tm-volume-slider-overlay').length,1);
    runtime.close();
  });

  test(`${config.name}: mode off keeps options available without an overlay`,async()=>{
    const {runtime}=await loadPlatform(config,current=>current.window.localStorage.setItem(config.modeKey,'off'));
    assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);
    assert.ok(runtime.document.getElementById('tm-volume-options-button'));
    runtime.close();
  });

  test(`${config.name}: on-video slider uses the version 2.5 centered expansion`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.locationKey,'video');
    });
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    assert.ok(overlay.classList.contains('tm-on-video'));
    assert.equal(overlay.style.left,'50%');
    assert.equal(overlay.style.transform,'translateX(-50%) scale(var(--tm-overlay-scale, 1))');
    assert.equal(overlay.style.transformOrigin,'center bottom');

    runtime.window.dispatchEvent(new runtime.window.MouseEvent('pointermove',{bubbles:true}));
    overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter'));
    assert.ok(overlay.classList.contains('tm-expanded'));
    assert.equal(overlay.style.width,'var(--tm-pill-expanded-width)');
    assert.equal(overlay.style.transform,'translateX(-50%) scale(var(--tm-overlay-scale, 1))');
    runtime.close();
  });

  test(`${config.name}: volume percentage label matches native YouTube control text sizing`,async()=>{
    const {runtime}=await loadPlatform(config);
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const style=runtime.window.getComputedStyle(label);
    assert.equal(style.fontSize,'14px');
    assert.equal(style.fontWeight,'500');
    assert.equal(style.lineHeight,'40px');
    assert.match(style.fontFamily,/YouTube Noto/);
    runtime.close();
  });

  test(`${config.name}: volume percentage label stays centered in a compact slot`,async()=>{
    const {runtime}=await loadPlatform(config);
    const row=runtime.document.querySelector('.tm-volume-top-row');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const rowStyle=runtime.window.getComputedStyle(row);
    const labelStyle=runtime.window.getComputedStyle(label);
    assert.equal(rowStyle.width,'96px');
    assert.equal(labelStyle.left,'36px');
    assert.equal(labelStyle.width,'58px');
    assert.equal(labelStyle.textAlign,'center');
    assert.equal(labelStyle.textShadow,'0 0 2px rgb(0, 0, 0)');
    assert.equal(labelStyle.transform,'translateY(-50%)');
    runtime.close();
  });
}

test('YouTube: mounting beneath a stationary pointer does not expand the slider',async()=>{
  const {runtime}=await loadPlatform(platforms[0]);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter'));
  assert.ok(overlay.classList.contains('tm-collapsed'));
  runtime.window.dispatchEvent(new runtime.window.MouseEvent('pointermove'));
  overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter'));
  assert.ok(overlay.classList.contains('tm-expanded'));
  runtime.close();
});

test('YouTube: clicking the video surface dismisses options without reaching playback',async()=>{
  const {runtime,fixture}=await loadPlatform(platforms[0]);
  runtime.document.getElementById('tm-volume-options-button').click();
  const popup=runtime.document.getElementById('tm-volume-options-popup');
  assert.equal(popup.hasAttribute('hidden'),false);

  let playbackClicks=0;
  fixture.player.addEventListener('click',()=>playbackClicks++);
  fixture.video.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));

  assert.equal(popup.hasAttribute('hidden'),true);
  assert.equal(playbackClicks,0);
  runtime.close();
});

test('YouTube: clicking the video surface collapses a held slider and reaches playback',async()=>{
  const {runtime,fixture}=await loadPlatform(platforms[0]);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=runtime.document.getElementById('tm-volume-slider-range');

  slider.value='65';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.ok(overlay.classList.contains('tm-expanded'));
  assert.equal(overlay.dataset.tmKeepExpanded,'true');

  let playbackClicks=0;
  fixture.player.addEventListener('click',()=>playbackClicks++);
  fixture.video.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));

  assert.ok(overlay.classList.contains('tm-collapsed'));
  assert.equal(overlay.dataset.tmKeepExpanded,'false');
  assert.equal(playbackClicks,1);
  runtime.close();
});

test('Twitch: hiding controls clears interaction expansion until the next slider hover',async()=>{
  const {runtime}=await loadPlatform(platforms[1]);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');

  overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter'));
  slider.value='65';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.ok(overlay.classList.contains('tm-expanded'));

  controls.setAttribute('data-a-visible','false');
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  assert.ok(overlay.classList.contains('tm-collapsed'));
  assert.equal(overlay.dataset.tmKeepExpanded,'false');

  controls.setAttribute('data-a-visible','true');
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  assert.ok(overlay.classList.contains('tm-collapsed'));
  runtime.close();
});

test('Twitch: on-video slider expands on deliberate hover while controls are hidden',async()=>{
  const {runtime}=await loadPlatform(platforms[1],current=>{
    current.window.localStorage.setItem('tm-twitch-volume-slider-location','video');
  });
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');

  assert.ok(overlay.classList.contains('tm-collapsed'));
  assert.equal(overlay.parentElement.className,'video-player');

  controls.setAttribute('data-a-visible','false');
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  assert.ok(overlay.classList.contains('tm-collapsed'));

  runtime.window.dispatchEvent(new runtime.window.MouseEvent('pointermove',{bubbles:true}));
  overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter'));
  assert.ok(overlay.classList.contains('tm-expanded'));

  controls.setAttribute('aria-hidden','true');
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  assert.ok(overlay.classList.contains('tm-expanded'));
  runtime.close();
});

test('Twitch: video click after slider interaction keeps native controls open',async()=>{
  const {runtime,fixture}=await loadPlatform(platforms[1]);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');

  slider.value='65';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.ok(overlay.classList.contains('tm-expanded'));
  assert.equal(overlay.dataset.tmKeepExpanded,'true');

  let pointerDownReachedVideo=false;
  let playbackClicks=0;
  fixture.video.addEventListener('pointerdown',()=>{
    pointerDownReachedVideo=true;
    controls.setAttribute('data-a-visible','false');
    controls.setAttribute('aria-hidden','true');
  });
  fixture.video.addEventListener('click',()=>playbackClicks++);
  fixture.video.dispatchEvent(new runtime.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  assert.equal(pointerDownReachedVideo,true);
  assert.equal(controls.getAttribute('data-a-visible'),'true');
  assert.equal(controls.getAttribute('aria-hidden'),'false');

  fixture.video.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));

  assert.ok(overlay.classList.contains('tm-collapsed'));
  assert.equal(overlay.dataset.tmKeepExpanded,'false');
  assert.equal(playbackClicks,1);
  assert.equal(controls.getAttribute('data-a-visible'),'true');
  assert.equal(controls.getAttribute('aria-hidden'),'false');

  runtime.document.body.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));
  assert.equal(controls.getAttribute('data-a-visible'),'false');
  assert.equal(controls.getAttribute('aria-hidden'),'true');
  runtime.close();
});
