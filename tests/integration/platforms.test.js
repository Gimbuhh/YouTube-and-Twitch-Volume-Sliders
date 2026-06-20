import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, volumeKey:'tm-yt-volume', modeKey:'tm-yt-volume-slider-mode' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, volumeKey:'tm-twitch-volume', modeKey:'tm-twitch-volume-slider-mode' }
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
    assert.ok(slider); slider.value='60'; slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
    assert.equal(fixture.state.muted,false); assert.equal(fixture.state.volume,config.file==='youtube'?60:.6);
    runtime.close();
  });

  test(`${config.name}: full artifact exposes semantic controls and reattaches after detachment`,async()=>{
    const {runtime}=await loadPlatform(config);
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const mute=overlay.querySelector('button.tm-volume-icon-cell');
    assert.equal(overlay.hasAttribute('tabindex'),false); assert.equal(mute.getAttribute('aria-label'),'Mute');
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
