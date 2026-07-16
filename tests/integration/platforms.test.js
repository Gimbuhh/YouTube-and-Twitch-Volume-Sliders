import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, volumeKey:'tm-yt-volume', muteKey:'tm-yt-muted', modeKey:'tm-yt-volume-slider-mode', locationKey:'tm-yt-volume-slider-location', expandedKey:'tm-yt-volume-slider-always-expanded', appearanceKey:'tm-yt-volume-slider-appearance' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, volumeKey:'tm-twitch-volume', muteKey:'tm-twitch-muted', modeKey:'tm-twitch-volume-slider-mode', locationKey:'tm-twitch-volume-slider-location', expandedKey:'tm-twitch-volume-slider-always-expanded', appearanceKey:'tm-twitch-volume-slider-appearance' }
];

const waitForTimers = (runtime, delay = 0) => new Promise(resolve=>runtime.window.setTimeout(resolve,delay));

async function startBuiltArtifact(config) {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  const source=await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  return runtime;
}

async function loadPlatform(config, setup = () => {}) {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  const fixture=config.fixture(runtime.document);
  setup(runtime,fixture);
  const source=await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  await waitForTimers(runtime);
  return {runtime,fixture};
}

function addYouTubeVideoToEarlyControls(runtime) {
  const player=runtime.document.getElementById('movie_player');
  const video=runtime.document.createElement('video');
  video.className='html5-main-video';
  let volume=50, muted=false;
  Object.assign(player,{getVolume:()=>volume,setVolume:v=>{volume=v;},isMuted:()=>muted,mute:()=>{muted=true;},unMute:()=>{muted=false;}});
  player.insertBefore(video,player.firstChild);
}

function addTwitchVideoToEarlyControls(runtime) {
  const player=runtime.document.querySelector('.video-player');
  const video=runtime.document.createElement('video');
  let volume=.5, muted=false;
  player._tmPlayerApi={getVolume:()=>volume,setVolume:v=>{volume=v;},isMuted:()=>muted,setMuted:v=>{muted=v;}};
  player.__reactFiber$test={return:{memoizedProps:{mediaPlayerInstance:player._tmPlayerApi},return:null}};
  player.insertBefore(video,player.firstChild);
}

test('YouTube: replace-native guard hides native volume areas as soon as they appear',async()=>{
  const config=platforms[0];
  const {runtime}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.modeKey,'replace-native');
  });
  assert.ok(runtime.document.documentElement.classList.contains('tm-yt-volume-native-replacement-active'));

  const lateNativeArea=runtime.document.createElement('div');
  lateNativeArea.className='ytp-volume-area';
  runtime.document.body.appendChild(lateNativeArea);
  assert.equal(runtime.window.getComputedStyle(lateNativeArea).display,'none');
  runtime.close();
});

test('YouTube: replace-native guard activates immediately when history enters a watch page',async()=>{
  const config=platforms[0];
  const runtime=createRuntime('https://www.youtube.com/',{runScripts:'outside-only'});
  const fixture=config.fixture(runtime.document);
  const nativeArea=fixture.player.querySelector('.ytp-volume-area');
  runtime.window.localStorage.setItem(config.modeKey,'replace-native');
  const source=await readFile(new URL('../../dist/youtube-volume-slider.user.js',import.meta.url),'utf8');
  runtime.window.eval(source);
  await waitForTimers(runtime);

  assert.equal(runtime.document.documentElement.classList.contains('tm-yt-volume-native-replacement-active'),false);
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);

  runtime.window.history.pushState({},'', '/watch?v=next');

  assert.equal(runtime.document.documentElement.classList.contains('tm-yt-volume-native-replacement-active'),true);
  assert.equal(runtime.window.getComputedStyle(nativeArea).display,'none');
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);
  runtime.close();
});

test('YouTube: document-start bootstrap mounts the slider when the player arrives',async()=>{
  const config=platforms[0];
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  runtime.window.localStorage.setItem(config.modeKey,'replace-native');
  const source=await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);

  const fixture=config.fixture(runtime.document);
  fixture.player.hideControls=()=>fixture.player.classList.add('ytp-autohide');
  await waitForTimers(runtime,60);

  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  assert.ok(runtime.document.getElementById('tm-volume-options-button'));
  assert.equal(runtime.window.getComputedStyle(fixture.player.querySelector('.ytp-volume-area')).display,'none');
  runtime.close();
});

test('YouTube: always-expanded slider starts expanded when inserted',async()=>{
  const config=platforms[0];
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  runtime.window.localStorage.setItem(config.expandedKey,'true');

  const appendRecords=[];
  const originalAppendChild=runtime.window.Element.prototype.appendChild;
  runtime.window.Element.prototype.appendChild=function(child){
    if(child?.id==='tm-volume-slider-overlay'){
      appendRecords.push({className:child.className,width:child.style.width});
    }
    return originalAppendChild.call(this,child);
  };

  try{
    const source=await readFile(new URL(`../../dist/${config.file}-volume-slider.user.js`,import.meta.url),'utf8');
    runtime.window.eval(source);
    await waitForTimers(runtime);

    assert.ok(appendRecords.length>0);
    assert.match(appendRecords[0].className,/\btm-expanded\b/);
    assert.doesNotMatch(appendRecords[0].className,/\btm-collapsed\b/);
    assert.equal(appendRecords[0].width,'var(--tm-pill-expanded-width)');
    assert.ok(runtime.document.getElementById('tm-volume-slider-overlay').classList.contains('tm-expanded'));
  } finally {
    runtime.window.Element.prototype.appendChild=originalAppendChild;
    runtime.close();
  }
});

test('YouTube: options button mounts when native controls appear before video',async()=>{
  const config=platforms[0];
  const runtime=await startBuiltArtifact(config);
  assert.equal(runtime.document.getElementById('tm-volume-options-button'),null);

  runtime.document.body.innerHTML = '<div id="movie_player"><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button"></button></div></div>';
  await waitForTimers(runtime);

  assert.ok(runtime.document.getElementById('tm-volume-options-button'));
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);

  addYouTubeVideoToEarlyControls(runtime);
  await waitForTimers(runtime,60);

  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  runtime.close();
});

test('YouTube: saved mute state restores and icon changes persist',async()=>{
  const config=platforms[0];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'35');
    current.window.localStorage.setItem(config.muteKey,'true');
  });
  const label=runtime.document.getElementById('tm-volume-slider-value');
  const icon=runtime.document.querySelector('button.tm-volume-icon-cell');
  assert.equal(fixture.state.muted,true);
  assert.equal(label.textContent,'Muted');

  icon.click();
  assert.equal(fixture.state.muted,false);
  assert.equal(runtime.window.localStorage.getItem(config.muteKey),'false');

  icon.click();
  assert.equal(fixture.state.muted,true);
  assert.equal(runtime.window.localStorage.getItem(config.muteKey),'true');
  runtime.close();
});

test('YouTube: native mute volumechange persists mute state',async()=>{
  const config=platforms[0];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'35');
  });
  fixture.player.mute();
  fixture.video.dispatchEvent(new runtime.window.Event('volumechange'));
  assert.equal(runtime.window.localStorage.getItem(config.muteKey),'true');

  fixture.player.unMute();
  fixture.video.dispatchEvent(new runtime.window.Event('volumechange'));
  assert.equal(runtime.window.localStorage.getItem(config.muteKey),'false');
  runtime.close();
});

test('YouTube: mouse mute interaction does not move focus to the icon',async()=>{
  const config=platforms[0];
  const {runtime}=await loadPlatform(config);
  const icon=runtime.document.querySelector('button.tm-volume-icon-cell');
  runtime.document.body.tabIndex=-1;
  runtime.document.body.focus();
  const mouseDown=new runtime.window.MouseEvent('mousedown',{bubbles:true,cancelable:true});
  icon.dispatchEvent(mouseDown);
  assert.equal(mouseDown.defaultPrevented,true);
  assert.equal(runtime.document.activeElement,runtime.document.body);

  icon.focus();
  assert.equal(runtime.document.activeElement,icon);
  runtime.close();
});

test('YouTube: unsupported routes leave preview videos and native controls untouched',async()=>{
  const config=platforms[0];
  const runtime=createRuntime('https://www.youtube.com/shorts/test',{runScripts:'outside-only'});
  const fixture=config.fixture(runtime.document);
  const nativeArea=fixture.player.querySelector('.ytp-volume-area');
  nativeArea.style.display='inline-flex';
  runtime.window.localStorage.setItem(config.modeKey,'replace-native');
  const source=await readFile(new URL('../../dist/youtube-volume-slider.user.js',import.meta.url),'utf8');
  runtime.window.eval(source); await waitForTimers(runtime,60);
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);
  assert.equal(runtime.document.getElementById('tm-volume-options-button'),null);
  assert.equal(nativeArea.style.display,'inline-flex');
  assert.equal(fixture.state.volume,50);
  runtime.close();
});

test('YouTube: keyboard input preserves exact steps when snapping is disabled',async()=>{
  const config=platforms[0];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'52');
    current.window.localStorage.setItem('tm-yt-volume-slider-snap-to-5','false');
  });
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  slider.value='53';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(slider.value,'53');
  assert.equal(fixture.state.volume,53);
  runtime.close();
});

test('YouTube: arrow volume updates remain responsive immediately after slider input',async()=>{
  const config=platforms[0];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'50');
  });
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  slider.value='60';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(fixture.state.volume,60);

  slider.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  fixture.player.setVolume(65);
  fixture.video.dispatchEvent(new runtime.window.Event('volumechange'));

  assert.equal(slider.value,'65');
  assert.equal(runtime.document.getElementById('tm-volume-slider-value').textContent,'65%');
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay').getAttribute('aria-label'),'Volume 65%');
  runtime.close();
});

test('Twitch: arrow keys adjust by five percent while preserving mute and saved volume',async()=>{
  const config=platforms[1];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'50');
    current.window.localStorage.setItem(config.muteKey,'true');
  });
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  const label=runtime.document.getElementById('tm-volume-slider-value');
  for(const [key,expected] of [['ArrowUp',55],['ArrowDown',50]]){
    const event=new runtime.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
    slider.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);
    assert.equal(Number(slider.value),expected);
    assert.equal(fixture.state.volume,expected/100);
    assert.equal(fixture.state.muted,true);
    assert.equal(label.textContent,'Muted');
    assert.equal(runtime.window.localStorage.getItem(config.muteKey),'true');
  }
  for(const key of ['ArrowLeft','ArrowRight']){
    const event=new runtime.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
    slider.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);
    assert.equal(slider.value,'50');
    assert.equal(fixture.state.volume,.5);
  }
  slider.value='100';
  slider.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  assert.equal(slider.value,'100');
  await waitForTimers(runtime,180);
  assert.equal(runtime.window.localStorage.getItem(config.volumeKey),'50');
  runtime.close();
});

test('Twitch: replace-native mode restores unmarked player volume resets',async()=>{
  const config=platforms[1];
  let now=10_000;
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.Date.now=()=>now;
    current.window.localStorage.setItem(config.volumeKey,'40');
    current.window.localStorage.setItem(config.modeKey,'replace-native');
  });
  now=20_000;

  fixture.player._tmPlayerApi.setVolume(.15);
  fixture.video.dispatchEvent(new runtime.window.Event('volumechange'));

  assert.equal(fixture.state.volume,.4);
  assert.equal(runtime.document.getElementById('tm-volume-slider-range').value,'40');
  await waitForTimers(runtime,180);
  assert.equal(runtime.window.localStorage.getItem(config.volumeKey),'40');
  runtime.close();
});

test('Twitch: native-visible mode still persists external player volume changes',async()=>{
  const config=platforms[1];
  let now=10_000;
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.Date.now=()=>now;
    current.window.localStorage.setItem(config.volumeKey,'40');
    current.window.localStorage.setItem(config.modeKey,'on');
  });
  now=20_000;

  fixture.player._tmPlayerApi.setVolume(.15);
  fixture.video.dispatchEvent(new runtime.window.Event('volumechange'));

  assert.equal(runtime.document.getElementById('tm-volume-slider-range').value,'15');
  await waitForTimers(runtime,180);
  assert.equal(runtime.window.localStorage.getItem(config.volumeKey),'15');
  runtime.close();
});

test('Twitch: player-level arrows require the player to be the last pressed area',async()=>{
  const config=platforms[1];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'50');
  });
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');
  let keyboardHoldCallback=null;
  const originalSetTimeout=runtime.window.setTimeout;
  runtime.window.setTimeout=(callback,delay,...args)=>{
    if(delay===3000){
      keyboardHoldCallback=callback;
      return 3000;
    }
    return originalSetTimeout(callback,delay,...args);
  };
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  const unfocusedArrow=new runtime.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true});
  runtime.document.body.dispatchEvent(unfocusedArrow);
  assert.equal(unfocusedArrow.defaultPrevented,false);
  assert.equal(slider.value,'50');

  fixture.player.dispatchEvent(new runtime.window.MouseEvent('pointerdown',{bubbles:true}));
  runtime.document.body.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  assert.equal(slider.value,'55');
  assert.equal(fixture.state.volume,.55);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  assert.equal(controls.style.opacity,'1');
  assert.ok(keyboardHoldCallback);
  runtime.document.body.dispatchEvent(new runtime.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(slider.value,'50');
  assert.equal(fixture.state.volume,.5);
  assert.equal(overlay.classList.contains('tm-collapsed'),true);
  assert.equal(controls.style.opacity,'1');

  const outside=runtime.document.createElement('div');
  runtime.document.body.appendChild(outside);
  outside.dispatchEvent(new runtime.window.MouseEvent('pointerdown',{bubbles:true}));
  const outsideArrow=new runtime.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true});
  runtime.document.body.dispatchEvent(outsideArrow);
  assert.equal(outsideArrow.defaultPrevented,false);
  assert.equal(slider.value,'50');
  keyboardHoldCallback();
  assert.equal(controls.style.opacity,'');
  runtime.window.setTimeout=originalSetTimeout;
  runtime.close();
});

test('Twitch: in-controls slider keeps 40px visuals on a native-height footprint',async()=>{
  const config=platforms[1];
  const {runtime}=await loadPlatform(config);
  const style=runtime.document.getElementById('tm-volume-slider-style').textContent;
  assert.match(style,/#tm-volume-slider-overlay\.tm-in-controls\s*{[^}]*height:\s*32px\s*!important;[^}]*min-height:\s*32px\s*!important;[^}]*overflow:\s*clip\s*!important;[^}]*overflow-clip-margin:\s*4px;[^}]*translateY\(0\)/s);
  assert.match(style,/#tm-volume-slider-overlay\.tm-in-controls \.tm-volume-panel-bg\s*{[^}]*top:\s*-4px;[^}]*height:\s*40px/s);
  assert.match(style,/#tm-volume-slider-overlay\.tm-in-controls \.tm-volume-icon-cell\s*{[^}]*top:\s*-4px/s);
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const icon=overlay.querySelector('.tm-volume-icon-cell');
  const indicator=overlay.querySelector('.tm-volume-indicator');
  assert.equal(overlay.style.width,'40px');
  assert.equal(icon.style.width,'');
  assert.equal(indicator.querySelector('svg').getAttribute('width'),'40');
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  slider.focus();
  assert.equal(runtime.document.activeElement,slider);
  runtime.close();
});

test('Twitch: volume API remains usable when optional mute methods are missing',async()=>{
  const config=platforms[1];
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  const fixture=config.fixture(runtime.document);
  let calls=0;
  fixture.player._tmPlayerApi={getVolume:()=>.5,setVolume:value=>{calls++; assert.equal(value,.6);},isMuted:()=>true};
  fixture.player.__reactFiber$test={return:{memoizedProps:{mediaPlayerInstance:fixture.player._tmPlayerApi},return:null}};
  const source=await readFile(new URL('../../dist/twitch-volume-slider.user.js',import.meta.url),'utf8');
  runtime.window.eval(source); await waitForTimers(runtime);
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  slider.value='60'; slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(calls,1);
  runtime.close();
});

test('Twitch: options button mounts when native controls appear before video',async()=>{
  const config=platforms[1];
  const runtime=await startBuiltArtifact(config);
  assert.equal(runtime.document.getElementById('tm-volume-options-button'),null);

  runtime.document.body.innerHTML = '<div class="video-player" data-a-target="player-overlay-click-handler"><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings"></button></div></div></div>';
  await waitForTimers(runtime);

  assert.ok(runtime.document.getElementById('tm-volume-options-button'));
  assert.equal(runtime.document.getElementById('tm-volume-slider-overlay'),null);

  addTwitchVideoToEarlyControls(runtime);
  await waitForTimers(runtime,60);

  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  runtime.close();
});

test('Twitch: preview player mounts slider and options in its own controls',async()=>{
  const config=platforms[1];
  const runtime=await startBuiltArtifact(config);
  runtime.window.localStorage.setItem(config.locationKey,'video');
  const inactive=runtime.document.createElement('div');
  inactive.className='video-player';
  inactive.setAttribute('data-a-target','video-player');
  inactive.innerHTML='<div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings"></button></div></div>';
  runtime.document.body.appendChild(inactive);

  const preview=runtime.document.createElement('div');
  preview.className='video-player';
  preview.setAttribute('data-a-target','video-player');
  preview.innerHTML='<div class="video-player__container"><div class="video-ref" data-a-target="video-ref"><video aria-label="Twitch video player"></video><section id="channel-player" aria-label="Player Controls"><div data-a-target="player-controls" class="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings"></button></div></div></section></div></div>';
  runtime.document.body.appendChild(preview);
  const previewContainer=preview.querySelector('.video-player__container');
  preview.getBoundingClientRect=()=>({left:100,top:100,right:633,bottom:400,width:533,height:300});
  previewContainer.getBoundingClientRect=()=>({left:100,top:100,right:633,bottom:400,width:533,height:300});
  const video=preview.querySelector('video');
  Object.defineProperty(video,'clientWidth',{value:533,configurable:true});
  Object.defineProperty(video,'clientHeight',{value:300,configurable:true});
  let volume=.5, muted=false;
  preview._tmPlayerApi={getVolume:()=>volume,setVolume:v=>{volume=v;},isMuted:()=>muted,setMuted:v=>{muted=v;}};
  preview.__reactFiber$test={return:{memoizedProps:{mediaPlayerInstance:preview._tmPlayerApi},return:null}};

  await waitForTimers(runtime,60);

  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const options=runtime.document.getElementById('tm-volume-options-button');
  assert.ok(overlay);
  assert.ok(options);
  assert.equal(preview.querySelector('#tm-volume-slider-overlay'),overlay);
  assert.equal(preview.querySelector('#tm-volume-options-button'),options);
  assert.equal(overlay.parentElement,previewContainer);
  assert.equal(overlay.classList.contains('tm-twitch-preview-player'),true);
  assert.equal(overlay.style.getPropertyValue('--tm-twitch-preview-player-width'),'533.00px');
  assert.match(runtime.document.getElementById('tm-volume-slider-style').textContent,/\.tm-twitch-preview-player\s*{[^}]*--tm-pill-min-width:\s*184px/s);
  assert.match(runtime.document.getElementById('tm-volume-slider-style').textContent,/\.tm-twitch-preview-player\s*{[^}]*--tm-pill-zoom-adaptive-width:\s*calc\(var\(--tm-twitch-preview-player-width,\s*520px\) \* 0\.48\)/s);
  options.click();
  await waitForTimers(runtime);
  assert.equal(runtime.document.getElementById('tm-volume-options-popup')?.parentElement,previewContainer);
  assert.equal(inactive.querySelector('#tm-volume-slider-overlay'),null);
  assert.equal(inactive.querySelector('#tm-volume-options-button'),null);
  runtime.close();
});

test('Twitch: volume mouse interactions do not keep keyboard focus',async()=>{
  const config=platforms[1];
  const {runtime}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'50');
  });
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const icon=overlay.querySelector('button.tm-volume-icon-cell');
  const slider=runtime.document.getElementById('tm-volume-slider-range');

  icon.focus();
  assert.equal(runtime.document.activeElement,icon);
  const mouseDown=new runtime.window.MouseEvent('mousedown',{bubbles:true,cancelable:true});
  icon.dispatchEvent(mouseDown);
  assert.equal(mouseDown.defaultPrevented,true);
  icon.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));
  await waitForTimers(runtime);
  assert.notEqual(runtime.document.activeElement,icon);

  icon.focus();
  assert.equal(runtime.document.activeElement,icon);
  runtime.window.dispatchEvent(new runtime.window.MouseEvent('pointermove',{bubbles:true,cancelable:true}));
  overlay.dispatchEvent(new runtime.window.MouseEvent('mouseenter',{bubbles:true,cancelable:true}));
  await waitForTimers(runtime);
  assert.notEqual(runtime.document.activeElement,icon);

  slider.focus();
  assert.equal(runtime.document.activeElement,slider);
  slider.dispatchEvent(new runtime.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,clientX:10,clientY:10}));
  slider.value='60';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  slider.dispatchEvent(new runtime.window.MouseEvent('pointerup',{bubbles:true,cancelable:true,clientX:10,clientY:10}));
  await waitForTimers(runtime);
  assert.notEqual(runtime.document.activeElement,slider);
  runtime.close();
});

test('Twitch: compact controls layout protects preview-sized control bars',async()=>{
  const config=platforms[1];
  const {runtime}=await loadPlatform(config,current=>{
    const controls=current.document.querySelector('[data-a-target="player-controls"]');
    controls.getBoundingClientRect=()=>({left:0,top:0,right:600,bottom:40,width:600,height:40});
  });
  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const style=runtime.document.getElementById('tm-volume-slider-style');
  assert.ok(overlay.classList.contains('tm-volume-compact-layout'));
  assert.match(style.textContent,/#tm-volume-slider-overlay\.tm-volume-compact-layout\s*{[\s\S]*--tm-pill-min-width:\s*208px/);
  assert.match(style.textContent,/#tm-volume-slider-overlay\.tm-volume-compact-layout\s*{[\s\S]*--tm-pill-zoom-adaptive-width:\s*min\(252px,\s*calc\(64vw - 14px\)\)/);
  assert.match(style.textContent,/@media \(max-width:\s*320px\)[\s\S]*#tm-volume-slider-overlay\.tm-volume-compact-layout\s*{[\s\S]*--tm-pill-min-width:\s*176px/);
  assert.match(style.textContent,/#tm-volume-slider-overlay\.tm-volume-compact-layout \.tm-volume-slider-row\s*{[\s\S]*--tm-thumb-size:\s*18px/);
  runtime.close();
});

test('Twitch: discovery preview video switch rebinds the custom slider',async()=>{
  const config=platforms[1];
  const {runtime,fixture}=await loadPlatform(config,current=>{
    current.window.localStorage.setItem(config.volumeKey,'40');
  });
  const firstOverlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const controls=runtime.document.querySelector('[data-a-target="player-controls"]');
  const secondVideo=runtime.document.createElement('video');
  let secondVolume=.8, secondMuted=false;
  const secondPlayer=runtime.document.createElement('div');
  secondPlayer.className='video-player';
  secondPlayer.dataset.aTarget='player-overlay-click-handler';
  secondPlayer._tmPlayerApi={getVolume:()=>secondVolume,setVolume:v=>{secondVolume=v;},isMuted:()=>secondMuted,setMuted:v=>{secondMuted=v;}};
  secondPlayer.__reactFiber$test={return:{memoizedProps:{mediaPlayerInstance:secondPlayer._tmPlayerApi},return:null}};
  Object.defineProperties(fixture.video,{clientWidth:{value:160},clientHeight:{value:90}});
  Object.defineProperties(secondVideo,{clientWidth:{value:640},clientHeight:{value:360}});
  secondPlayer.appendChild(secondVideo);
  secondPlayer.appendChild(controls);
  runtime.document.body.appendChild(secondPlayer);
  await waitForTimers(runtime,80);

  const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
  const slider=runtime.document.getElementById('tm-volume-slider-range');
  assert.notEqual(overlay,firstOverlay);
  assert.equal(overlay._tmVolumeVideo,secondVideo);
  const firstVolumeBeforeInput=fixture.state.volume;
  slider.value='25';
  slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
  assert.equal(secondVolume,.25);
  assert.equal(fixture.state.volume,firstVolumeBeforeInput);
  runtime.close();
});

test('YouTube: closing a scrolled options menu outside the player hides controls without forcing autohide',async()=>{
  const config=platforms[0];
  const {runtime,fixture}=await loadPlatform(config);
  let hideCalls=0;
  fixture.player.hideControls=()=>{
    hideCalls+=1;
    fixture.player.classList.add('ytp-autohide');
  };
  const bottom=runtime.document.createElement('div');
  bottom.className='ytp-chrome-bottom';
  fixture.player.appendChild(bottom);
  const btn=runtime.document.getElementById('tm-volume-options-button');
  btn.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));
  assert.ok(fixture.player.classList.contains('tm-volume-options-controls-hold'));

  const popup=runtime.document.getElementById('tm-volume-options-popup');
  const body=popup.querySelector('.tm-volume-options-body');
  body.scrollTop=200;
  runtime.document.body.dispatchEvent(new runtime.window.MouseEvent('click',{bubbles:true,cancelable:true}));

  assert.ok(popup.hasAttribute('hidden'));
  assert.equal(fixture.player.classList.contains('tm-volume-options-controls-hold'),false);
  assert.equal(fixture.player.classList.contains('ytp-autohide'),false);
  assert.equal(hideCalls,0);
  assert.equal(fixture.player.classList.contains('tm-volume-options-close-hide-controls'),true);
  assert.equal(runtime.window.getComputedStyle(bottom).pointerEvents,'none');
  assert.equal(runtime.window.getComputedStyle(bottom).opacity,'0');

  fixture.player.dispatchEvent(new runtime.window.MouseEvent('pointermove',{bubbles:true,cancelable:true}));
  assert.equal(fixture.player.classList.contains('tm-volume-options-close-hide-controls'),false);
  assert.equal(runtime.window.getComputedStyle(bottom).pointerEvents,'auto');
  runtime.close();
});

for(const config of platforms){
  test(`${config.name}: initial volume indicator matches saved volume before the first visible sync`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.volumeKey,'35');
    });
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const slider=runtime.document.getElementById('tm-volume-slider-range');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const arc=overlay.querySelector('.tm-volume-arc');
    assert.equal(slider.value,'35');
    assert.equal(label.textContent,'35%');
    assert.equal(arc.style.strokeDasharray,'35 100');
    assert.equal(arc.getAttribute('stroke-dasharray'),'35 100');
    assert.equal(arc.style.visibility,'visible');
    assert.notEqual(runtime.window.getComputedStyle(arc).transitionProperty,'stroke-dasharray');
    runtime.close();
  });

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

  test(`${config.name}: on-video slider uses centered expansion`,async()=>{
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

  test(`${config.name}: volume number moves into the arc and shortens the pill`,async()=>{
    const {runtime}=await loadPlatform(config);
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const row=runtime.document.querySelector('.tm-volume-top-row');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const arc=runtime.document.querySelector('.tm-volume-arc');
    const arcTrack=runtime.document.querySelector('.tm-volume-arc-track');
    const rowStyle=runtime.window.getComputedStyle(row);
    const labelStyle=runtime.window.getComputedStyle(label);
    assert.equal(overlay.dataset.tmAppearance,'new');
    const overlayStyle=runtime.window.getComputedStyle(overlay);
    const style=runtime.document.getElementById('tm-volume-slider-style');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-min-width').trim(),'228px');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-zoom-adaptive-width').trim(),'calc(34vw - 92px)');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-max-width').trim(),'368px');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-expanded-width').trim(),'clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width))');
    assert.match(style.textContent,/Browser zoom reduces the CSS viewport width/);
    assert.match(style.textContent,/@media \(max-width:\s*320px\)\s*{[^}]*--tm-pill-min-width:\s*176px/s);
    assert.match(style.textContent,/@media \(max-width:\s*320px\)[\s\S]*--tm-pill-zoom-adaptive-width:\s*min\(216px,\s*calc\(64vw - 14px\)\)/);
    assert.match(style.textContent,/@media \(max-width:\s*320px\)[\s\S]*\.tm-volume-slider-row\s*{[\s\S]*--tm-thumb-size:\s*18px/);
    assert.equal(runtime.window.getComputedStyle(overlay).getPropertyValue('--tm-slider-row-offset').trim(),'62px');
    assert.equal(rowStyle.width,'50px');
    assert.equal(labelStyle.width,'1px');
    assert.equal(labelStyle.height,'1px');
    assert.equal(labelStyle.overflow,'hidden');
    assert.equal(percent.textContent,'50');
    assert.equal(percent.getAttribute('text-anchor'),'middle');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('y'),'20');
    assert.equal(percent.getAttribute('dominant-baseline'),'central');
    assert.equal(percent.getAttribute('alignment-baseline'),'central');
    assert.equal(arc.getAttribute('r'),'14.5');
    assert.equal(arc.getAttribute('stroke-width'),'3');
    assert.equal(runtime.window.getComputedStyle(arc).vectorEffect,'non-scaling-stroke');
    assert.equal(arcTrack.hasAttribute('stroke-dasharray'),false);
    assert.equal(arcTrack.getAttribute('r'),'14.5');
    assert.equal(arcTrack.getAttribute('stroke-width'),'3');
    assert.equal(runtime.window.getComputedStyle(arcTrack).vectorEffect,'non-scaling-stroke');
    assert.equal(percent.getAttribute('font-family'),'Arial, Helvetica, sans-serif');
    assert.equal(percent.getAttribute('font-size'),'15');
    assert.equal(percent.getAttribute('font-weight'),'700');
    assert.equal(runtime.window.getComputedStyle(percent).fontSize,'15px');
    assert.equal(runtime.window.getComputedStyle(percent).fontWeight,'700');
    assert.doesNotMatch(runtime.window.getComputedStyle(percent).fontFamily,/YouTube Noto/);
    assert.equal(runtime.window.getComputedStyle(percent).fontVariantNumeric,'tabular-nums');
    runtime.close();
  });

  test(`${config.name}: classic appearance restores speaker icon and side percent`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.appearanceKey,'classic');
    });
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const row=runtime.document.querySelector('.tm-volume-top-row');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const indicator=runtime.document.querySelector('.tm-volume-indicator');
    const highIcon=runtime.document.querySelector('.tm-volume-speaker-high');
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const arc=runtime.document.querySelector('.tm-volume-arc');
    const arcTrack=runtime.document.querySelector('.tm-volume-arc-track');
    const rowStyle=runtime.window.getComputedStyle(row);
    const labelStyle=runtime.window.getComputedStyle(label);
    assert.equal(overlay.dataset.tmAppearance,'classic');
    const overlayStyle=runtime.window.getComputedStyle(overlay);
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-min-width').trim(),'274px');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-zoom-adaptive-width').trim(),'calc(34vw - 46px)');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-max-width').trim(),'414px');
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-expanded-width').trim(),'clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width))');
    assert.match(runtime.document.getElementById('tm-volume-slider-style').textContent,/@media \(max-width:\s*320px\)[\s\S]*tm-volume-appearance-classic[\s\S]*--tm-pill-min-width:\s*196px/);
    assert.match(runtime.document.getElementById('tm-volume-slider-style').textContent,/@media \(max-width:\s*320px\)[\s\S]*tm-volume-appearance-classic[\s\S]*--tm-pill-zoom-adaptive-width:\s*min\(262px,\s*calc\(64vw \+ 6px\)\)/);
    assert.equal(runtime.window.getComputedStyle(overlay).getPropertyValue('--tm-slider-row-offset').trim(),'108px');
    assert.equal(indicator.dataset.volumeIcon,'high');
    assert.ok(highIcon);
    assert.equal(rowStyle.width,'96px');
    assert.equal(labelStyle.left,'36px');
    assert.equal(labelStyle.width,'58px');
    assert.equal(labelStyle.overflow,'visible');
    assert.equal(labelStyle.clipPath,'none');
    assert.equal(label.textContent,'50%');
    assert.equal(percent.textContent,'50');
    assert.equal(arc.getAttribute('r'),'13');
    assert.equal(arc.getAttribute('stroke-width'),'4');
    assert.equal(arcTrack.getAttribute('r'),'13');
    assert.equal(arcTrack.getAttribute('stroke-width'),'4');
    assert.equal(arcTrack.getAttribute('stroke-dasharray'),'100 100');
    runtime.close();
  });

  test(`${config.name}: max volume number uses fitted compact text`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.volumeKey,'100');
    });
    const percent=runtime.document.querySelector('.tm-volume-percent');
    assert.equal(percent.textContent,'100');
    assert.equal(percent.getAttribute('textLength'),'22.5');
    assert.equal(percent.getAttribute('lengthAdjust'),'spacingAndGlyphs');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('y'),'20');
    assert.equal(runtime.window.getComputedStyle(percent).fontSize,'15px');
    runtime.close();
  });

  test(`${config.name}: volume number uses rendered bounds for optical centering`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.volumeKey,'14');
      current.window.SVGElement.prototype.getBBox=function(){
        if(this.classList?.contains('tm-volume-percent')&&this.textContent==='14'){
          return {x:14.8,y:10,width:12,height:14};
        }
        return {x:14,y:10,width:12,height:14};
      };
    });
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const slider=runtime.document.getElementById('tm-volume-slider-range');
    assert.equal(percent.textContent,'14');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('transform'),'translate(-0.80 0)');

    slider.value='50';
    slider.dispatchEvent(new runtime.window.Event('input',{bubbles:true}));
    assert.equal(percent.textContent,'50');
    assert.equal(percent.hasAttribute('transform'),false);
    runtime.close();
  });

  test(`${config.name}: zero volume hides the active arc seam`,async()=>{
    const {runtime}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.volumeKey,'0');
    });
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const arc=runtime.document.querySelector('.tm-volume-arc');
    assert.equal(percent.textContent,'0');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('y'),'20');
    assert.equal(arc.style.visibility,'hidden');
    assert.equal(arc.style.strokeDasharray,'0 100');
    runtime.close();
  });

  test(`${config.name}: collapsed slider clips hidden controls`,async()=>{
    const {runtime}=await loadPlatform(config);
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const sliderRow=runtime.document.querySelector('.tm-volume-slider-row');
    const overlayStyle=runtime.window.getComputedStyle(overlay);
    assert.ok(overlay.classList.contains('tm-collapsed'));
    assert.equal(overlayStyle.width,'40px');
    assert.equal(overlayStyle.paddingRight,'0px');
    assert.equal(overlayStyle.overflow,'hidden');
    const sliderRowStyle=runtime.window.getComputedStyle(sliderRow);
    assert.equal(sliderRowStyle.opacity,'0');
    assert.equal(sliderRowStyle.pointerEvents,'none');
    assert.equal(sliderRowStyle.visibility,'hidden');
    runtime.close();
  });

  test(`${config.name}: slider row keeps full-width geometry while the pill animates`,async()=>{
    const {runtime}=await loadPlatform(config);
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const sliderRow=runtime.document.querySelector('.tm-volume-slider-row');
    const ticks=runtime.document.querySelector('.tm-slider-ticks');
    const tickMarks=runtime.document.querySelectorAll('.tm-slider-tick');
    const style=runtime.document.getElementById('tm-volume-slider-style');
    const sliderRowStyle=runtime.window.getComputedStyle(sliderRow);
    const ticksStyle=runtime.window.getComputedStyle(ticks);
    const overlayStyle=runtime.window.getComputedStyle(overlay);
    assert.equal(overlayStyle.getPropertyValue('--tm-pill-expanded-width').trim(),'clamp(var(--tm-pill-min-width), var(--tm-pill-zoom-adaptive-width), var(--tm-pill-max-width))');
    assert.equal(sliderRow.style.width,'');
    assert.equal(sliderRow.style.flex,'');
    assert.equal(ticksStyle.opacity,'1');
    assert.match(sliderRowStyle.transition,/visibility 0s linear 0\.22s/);
    assert.equal(runtime.document.querySelector('.tm-slider-ticks-svg'),null);
    assert.equal(tickMarks.length,19);
    assert.equal(tickMarks[0].tagName.toLowerCase(),'span');
    assert.equal(tickMarks[0].dataset.tmTickPct,'5');
    assert.equal(tickMarks[18].dataset.tmTickPct,'95');
    assert.match(style.textContent,/\.tm-slider-tick\s*{[^}]*position:\s*absolute/s);
    assert.match(style.textContent,/\.tm-slider-tick\s*{[^}]*width:\s*var\(--tm-slider-tick-width,\s*1px\)/s);
    assert.match(style.textContent,/\.tm-slider-tick\s*{[^}]*background:\s*rgba\(255,255,255,0\.25\)/s);
    assert.doesNotMatch(style.textContent,/\.tm-slider-tick\s*{[^}]*vector-effect:\s*non-scaling-stroke/s);
    Object.defineProperty(runtime.window,'devicePixelRatio',{value:4/3,configurable:true});
    ticks.getBoundingClientRect=()=>({left:0,top:0,right:242.34375,bottom:8.25,width:242.34375,height:8.25});
    ticks._tmSliderTicksSync?.();
    assert.equal(ticks.style.visibility,'');
    assert.equal(ticks.style.getPropertyValue('--tm-slider-tick-width'),'0.75px');
    assert.equal(tickMarks[5].style.left,'72px');
    assert.equal(tickMarks[6].style.left,'84.75px');
    overlay.classList.add('tm-on-video');
    overlay.style.setProperty('--tm-overlay-scale','2');
    Object.defineProperty(runtime.window,'devicePixelRatio',{value:1,configurable:true});
    ticks.getBoundingClientRect=()=>({left:.25,top:0,right:200.25,bottom:8,width:200,height:8});
    ticks._tmSliderTicksSync?.();
    await waitForTimers(runtime,20);
    assert.equal(ticks.style.getPropertyValue('--tm-slider-tick-width'),'0.5px');
    assert.equal(tickMarks[9].style.left,'49.875px');
    assert.equal(tickMarks[18].style.left,'94.875px');
    assert.match(style.textContent,/\.tm-volume-slider-row\s*{[^}]*flex:\s*0 0 calc\(var\(--tm-pill-expanded-width\) - /s);
    assert.match(style.textContent,/\.tm-volume-slider-row\s*{[^}]*width:\s*calc\(var\(--tm-pill-expanded-width\) - /s);
    assert.doesNotMatch(style.textContent,/repeating-linear-gradient/);
    assert.doesNotMatch(style.textContent,/\.tm-expanded\s+\.tm-slider-ticks/);
    runtime.close();
  });

  test(`${config.name}: muted volume indicator uses M inside the arc`,async()=>{
    const {runtime}=await loadPlatform(config,(current,currentFixture)=>{
      current.window.localStorage.setItem(config.volumeKey,'35');
      if(config.file==='youtube')currentFixture.player.mute();else currentFixture.player._tmPlayerApi.setMuted(true);
    });
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const indicator=runtime.document.querySelector('.tm-volume-indicator');
    const arc=runtime.document.querySelector('.tm-volume-arc');
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    assert.equal(percent.textContent,'M');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('y'),'20');
    assert.equal(label.textContent,'Muted');
    assert.equal(arc.style.visibility,'visible');
    assert.equal(arc.style.strokeDasharray,'35 100');
    assert.equal(indicator.classList.contains('muted'),true);
    assert.equal(runtime.window.getComputedStyle(indicator).opacity,'0.78');
    assert.equal(overlay.getAttribute('aria-label'),'Muted, volume 35%');
    runtime.close();
  });

  test(`${config.name}: scrolling the arc changes volume in five point steps`,async()=>{
    const {runtime,fixture}=await loadPlatform(config,current=>{
      current.window.localStorage.setItem(config.volumeKey,'50');
    });
    const overlay=runtime.document.getElementById('tm-volume-slider-overlay');
    const icon=overlay.querySelector('button.tm-volume-icon-cell');
    const slider=runtime.document.getElementById('tm-volume-slider-range');
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const wheelUp=new runtime.window.Event('wheel',{bubbles:true,cancelable:true});
    Object.defineProperty(wheelUp,'deltaY',{value:-100});
    icon.dispatchEvent(wheelUp);
    assert.equal(wheelUp.defaultPrevented,true);
    assert.equal(slider.value,'55');
    assert.equal(percent.textContent,'55');
    assert.equal(fixture.state.volume,config.file==='youtube'?55:.55);

    const wheelDown=new runtime.window.Event('wheel',{bubbles:true,cancelable:true});
    Object.defineProperty(wheelDown,'deltaY',{value:100});
    icon.dispatchEvent(wheelDown);
    assert.equal(wheelDown.defaultPrevented,true);
    assert.equal(slider.value,'50');
    assert.equal(percent.textContent,'50');
    assert.equal(fixture.state.volume,config.file==='youtube'?50:.5);
    runtime.close();
  });

  test(`${config.name}: scrolling up from muted arc unmutes at five percent`,async()=>{
    const {runtime,fixture}=await loadPlatform(config,(current,currentFixture)=>{
      current.window.localStorage.setItem(config.volumeKey,'0');
      if(config.file==='youtube')currentFixture.player.mute();else currentFixture.player._tmPlayerApi.setMuted(true);
    });
    const icon=runtime.document.querySelector('button.tm-volume-icon-cell');
    const slider=runtime.document.getElementById('tm-volume-slider-range');
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const wheelUp=new runtime.window.Event('wheel',{bubbles:true,cancelable:true});
    Object.defineProperty(wheelUp,'deltaY',{value:-100});
    icon.dispatchEvent(wheelUp);
    assert.equal(slider.value,'5');
    assert.equal(percent.textContent,'5');
    assert.equal(fixture.state.muted,false);
    assert.equal(fixture.state.volume,config.file==='youtube'?5:.05);
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
