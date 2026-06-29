import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const twitchControlsHtml = '<div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings"></button></div></div>';

const waitForTimers = (runtime, delay = 60) => new Promise(resolve=>runtime.window.setTimeout(resolve,delay));

async function readBuiltArtifact(platform) {
  return readFile(new URL(`../../dist/${platform}-volume-slider.user.js`,import.meta.url),'utf8');
}

function saveMutedTwitchState(runtime) {
  runtime.window.localStorage.setItem('tm-twitch-volume','35');
  runtime.window.localStorage.setItem('tm-twitch-muted','true');
}

function addTwitchPlayer(runtime, { controls = true } = {}) {
  runtime.document.body.innerHTML = `<div class="video-player" data-a-target="player-overlay-click-handler"><video></video>${controls ? twitchControlsHtml : ''}</div>`;
  const player=runtime.document.querySelector('.video-player');
  const video=player.querySelector('video');
  const state={volume:.5, muted:false};
  player._tmPlayerApi={
    getVolume:()=>state.volume,
    setVolume:v=>{state.volume=v;},
    isMuted:()=>state.muted,
    setMuted:v=>{state.muted=v;}
  };
  player.__reactFiber$test={return:{memoizedProps:{mediaPlayerInstance:player._tmPlayerApi},return:null}};
  return {player,video,state};
}

for (const platform of ['youtube','twitch']) test(`${platform} artifact metadata and security boundary`, async () => {
  const source=await readBuiltArtifact(platform);
  const packageData=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const updateUrl = `https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/${platform}-volume-slider.user.js`;
  assert.match(source,new RegExp(`// @version\\s+${packageData.version.replaceAll('.','\\.')}`)); assert.match(source,/\/\/ @grant\s+none/);
  assert.match(source,/\/\/ @run-at\s+document-start/);
  assert.match(source,new RegExp(`// @updateURL\\s+${updateUrl.replaceAll('.','\\.')}`));
  assert.match(source,new RegExp(`// @downloadURL\\s+${updateUrl.replaceAll('.','\\.')}`));
  assert.doesNotMatch(source,/@require|sourceMappingURL|\bfetch\s*\(|XMLHttpRequest/);
  assert.ok(Buffer.byteLength(source) > (platform === 'youtube' ? 80000 : 95000), 'artifact retains full behavior');
});

test('twitch document-start bootstrap restores saved mute before controls mount', async () => {
  const runtime=createRuntime('https://www.twitch.tv/test',{runScripts:'outside-only'});
  saveMutedTwitchState(runtime);
  const source=await readBuiltArtifact('twitch');
  runtime.window.eval(source);

  const {player,state}=addTwitchPlayer(runtime,{controls:false});

  await waitForTimers(runtime);
  assert.equal(state.muted,true);
  assert.equal(state.volume,.35);
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);

  const controls=runtime.document.createElement('div');
  controls.setAttribute('data-a-target','player-controls');
  controls.innerHTML = twitchControlsHtml.replace(/^<div[^>]*>|<\/div>$/g,'');
  player.appendChild(controls);

  await waitForTimers(runtime);
  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  assert.equal(state.muted,true);
  assert.equal(state.volume,.35);
  runtime.close();
});

test('twitch saved mute also mutes the native video element immediately', async () => {
  const runtime=createRuntime('https://www.twitch.tv/test',{runScripts:'outside-only'});
  saveMutedTwitchState(runtime);
  const source=await readBuiltArtifact('twitch');
  const {video,state}=addTwitchPlayer(runtime);

  runtime.window.eval(source);
  await waitForTimers(runtime);

  assert.equal(state.muted,true);
  assert.equal(video.muted,true);
  assert.equal(state.volume,.35);
  assert.equal(runtime.document.getElementById('tm-volume-slider-value').textContent,'Muted');
  runtime.close();
});

test('twitch startup mute guard re-mutes the native video if Twitch resets it', async () => {
  const runtime=createRuntime('https://www.twitch.tv/test',{runScripts:'outside-only'});
  saveMutedTwitchState(runtime);
  const source=await readBuiltArtifact('twitch');
  const {video,state}=addTwitchPlayer(runtime);

  runtime.window.eval(source);
  await waitForTimers(runtime);
  assert.equal(video.muted,true);

  video.muted=false;
  video.defaultMuted=false;
  video.dispatchEvent(new runtime.window.Event('playing'));
  await waitForTimers(runtime,80);

  assert.equal(state.muted,true);
  assert.equal(video.muted,true);
  assert.equal(video.defaultMuted,true);
  runtime.close();
});

for (const config of [
  { platform:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture },
  { platform:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture }
]) test(`${config.platform} built artifact starts as a standalone userscript`, async () => {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  const source=await readFile(new URL(`../../dist/${config.platform}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  assert.ok(runtime.document.getElementById('tm-volume-options-button'));
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  runtime.close();
});
