import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

const platforms = [
  { name:'YouTube', file:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture, volumeKey:'tm-yt-volume', modeKey:'tm-yt-volume-slider-mode', locationKey:'tm-yt-volume-slider-location', appearanceKey:'tm-yt-volume-slider-appearance' },
  { name:'Twitch', file:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture, volumeKey:'tm-twitch-volume', modeKey:'tm-twitch-volume-slider-mode', locationKey:'tm-twitch-volume-slider-location', appearanceKey:'tm-twitch-volume-slider-appearance' }
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

  test(`${config.name}: volume number moves into the arc and frees slider space`,async()=>{
    const {runtime}=await loadPlatform(config);
    const row=runtime.document.querySelector('.tm-volume-top-row');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const arc=runtime.document.querySelector('.tm-volume-arc');
    const arcTrack=runtime.document.querySelector('.tm-volume-arc-track');
    const rowStyle=runtime.window.getComputedStyle(row);
    const labelStyle=runtime.window.getComputedStyle(label);
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
    assert.equal(runtime.window.getComputedStyle(overlay).getPropertyValue('--tm-pill-expanded-width').trim(),'clamp(274px, calc(34vw - 46px), 414px)');
    assert.equal(sliderRow.style.width,'');
    assert.equal(sliderRow.style.flex,'');
    assert.equal(ticksStyle.opacity,'1');
    assert.match(sliderRowStyle.transition,/visibility 0s linear 0\.22s/);
    assert.equal(tickMarks.length,19);
    assert.equal(tickMarks[0].style.left,'5%');
    assert.equal(tickMarks[18].style.left,'95%');
    assert.match(style.textContent,/\.tm-volume-slider-row\s*{[^}]*flex:\s*0 0 calc\(var\(--tm-pill-expanded-width\) - /s);
    assert.match(style.textContent,/\.tm-volume-slider-row\s*{[^}]*width:\s*calc\(var\(--tm-pill-expanded-width\) - /s);
    assert.doesNotMatch(style.textContent,/repeating-linear-gradient/);
    assert.doesNotMatch(style.textContent,/\.tm-expanded\s+\.tm-slider-ticks/);
    runtime.close();
  });

  test(`${config.name}: muted volume indicator uses M inside the arc`,async()=>{
    const {runtime}=await loadPlatform(config,(current,currentFixture)=>{
      if(config.file==='youtube')currentFixture.player.mute();else currentFixture.player._tmPlayerApi.setMuted(true);
    });
    const percent=runtime.document.querySelector('.tm-volume-percent');
    const label=runtime.document.getElementById('tm-volume-slider-value');
    assert.equal(percent.textContent,'M');
    assert.equal(percent.getAttribute('x'),'20');
    assert.equal(percent.getAttribute('y'),'20');
    assert.equal(label.textContent,'Muted');
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
