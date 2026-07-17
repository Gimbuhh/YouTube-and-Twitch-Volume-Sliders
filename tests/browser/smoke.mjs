import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const projectRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const artifactRoot=resolve(process.env.VOLUME_SLIDER_SMOKE_DIST || join(projectRoot,'dist'));

async function firstExisting(paths){
  for(const path of paths.filter(Boolean)){
    try{await access(path);return path;}catch{/* keep looking */}
  }
  return null;
}

const executablePath=await firstExisting([
  process.env.VOLUME_SLIDER_CHROME,
  process.env.CHROME_PATH,
  join(process.env.ProgramFiles || 'C:\\Program Files','Google','Chrome','Application','chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)','Google','Chrome','Application','chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files','Microsoft','Edge','Application','msedge.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe')
]);

if(!executablePath){
  console.log('browser smoke skipped: set VOLUME_SLIDER_CHROME to a Chrome or Edge executable');
  process.exit(0);
}

const youtubeHtml=`<!doctype html><html><head><style>
html,body{margin:0;background:#111;color:#fff;font-family:Arial;height:100%}.spacer{height:1800px}
#movie_player{position:relative;width:900px;height:506px;background:#222}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}.ytp-left-controls{left:0}.ytp-right-controls{right:0}.ytp-volume-area,.ytp-settings-button{width:40px;height:40px}
</style></head><body><div id="movie_player" class="html5-video-player" tabindex="0"><video class="html5-main-video"></video><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">S</button></div></div><div class="spacer"></div><script>
(()=>{const player=document.getElementById('movie_player');let volume=50,muted=false;Object.assign(player,{getVolume:()=>volume,setVolume:value=>{volume=value;player.querySelector('video').dispatchEvent(new Event('volumechange'));},isMuted:()=>muted,mute:()=>{muted=true;player.querySelector('video').dispatchEvent(new Event('volumechange'));},unMute:()=>{muted=false;player.querySelector('video').dispatchEvent(new Event('volumechange'));}});window.__smoke={get volume(){return volume},get muted(){return muted}};})();
</script></body></html>`;

const twitchHtml=`<!doctype html><html><head><style>
html,body{margin:0;background:#111;color:#fff;font-family:Arial;min-height:2200px}.video-player{position:relative;width:900px;height:506px;background:#222}video{display:block;width:100%;height:466px}[data-a-target="player-controls"]{height:40px;display:flex;align-items:center;justify-content:space-between}.player-controls__left-control-group,.player-controls__right-control-group{height:40px;display:flex;align-items:center}[data-a-target="player-volume-slider"]{width:80px;height:40px}#outside{margin-top:20px;height:60px}
</style></head><body><div class="video-player" data-a-target="player-overlay-click-handler" tabindex="0"><video></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings">S</button></div></div></div><div id="outside">Outside player</div><script>
(()=>{const player=document.querySelector('.video-player');const video=player.querySelector('video');const state={volume:.5,muted:true,lastArrowPrevented:null};player._tmPlayerApi={getVolume:()=>state.volume,setVolume:value=>{state.volume=value;video.dispatchEvent(new Event('volumechange'));},isMuted:()=>state.muted,setMuted:value=>{state.muted=value;video.muted=value;video.dispatchEvent(new Event('volumechange'));}};player.__reactFiber$smoke={return:{memoizedProps:{mediaPlayerInstance:player._tmPlayerApi},return:null}};document.addEventListener('keydown',event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown')state.lastArrowPrevented=event.defaultPrevented;});window.__smoke=state;})();
</script></body></html>`;

const twitchPreviewHtml=twitchHtml
  .replace('width:900px','width:533px')
  .replace('<div data-a-target="player-volume-slider"></div>','<div class="native-volume-group"><button data-a-target="player-mute-unmute-button">M</button><div data-a-target="player-volume-slider"></div></div>');

async function preparedPage(browser,{platform,url,html,storage,expectOverlay=true}){
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
  const artifact=await readFile(join(artifactRoot,`${platform}-volume-slider.user.js`),'utf8');
  const keyEvidence=`window.__smokeKeyEvents=[];document.addEventListener('keydown',event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown')queueMicrotask(()=>window.__smokeKeyEvents.push({key:event.key,defaultPrevented:event.defaultPrevented}));},true);`;
  const storagePrelude=keyEvidence+Object.entries(storage).map(([key,value])=>`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`).join('');
  const userscript=`<script>${storagePrelude}\n${artifact.replaceAll('</script>','<\\/script>')}</script>`;
  const fixture=html.replace('<head>',`<head>${userscript}`);
  await page.route(`${new URL(url).origin}/**`,route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  if(expectOverlay){
    try{
      await page.waitForSelector('#tm-volume-slider-overlay',{state:'attached',timeout:5000});
    }catch(error){
      const evidence=await page.evaluate(()=>({href:location.href,readyState:document.readyState,body:document.body?.innerHTML.slice(0,500),nativeGuard:document.documentElement.className,optionsButton:!!document.querySelector('#tm-volume-options-button')}));
      throw new Error(`${platform} overlay did not mount: ${JSON.stringify({pageErrors,evidence})}`,{cause:error});
    }
  }else{
    await page.waitForTimeout(600);
    assert.equal(pageErrors.length,0,`${platform} preview has no page errors`);
  }
  return {context,page};
}

async function youtubeSmoke(browser){
  const {context,page}=await preparedPage(browser,{platform:'youtube',url:'https://www.youtube.com/watch?v=smoke',html:youtubeHtml,storage:{'tm-yt-volume':'50','tm-yt-muted':'false','tm-yt-volume-slider-mode':'replace-native','tm-yt-volume-slider-snap-to-5':'false'}});
  try{
    await page.mouse.move(1100,700);
    await page.locator('.tm-volume-icon-cell').hover();
    await page.waitForFunction(()=>document.querySelector('#tm-volume-slider-overlay')?.classList.contains('tm-expanded'));
    const slider=page.locator('#tm-volume-slider-range');
    const box=await slider.boundingBox();
    assert.ok(box && box.width>40,'YouTube slider has rendered geometry');
    await page.mouse.move(box.x+(box.width*.5),box.y+(box.height/2));
    await page.mouse.down();
    await page.mouse.move(box.x+(box.width*.6),box.y+(box.height/2),{steps:4});
    await page.mouse.up();
    const dragged=Number(await slider.inputValue());
    await slider.press('ArrowUp');
    const state=await page.evaluate(()=>({slider:document.querySelector('#tm-volume-slider-range').value,label:document.querySelector('#tm-volume-slider-value').textContent,arc:document.querySelector('.tm-volume-arc')?.getAttribute('stroke-dasharray'),volume:window.__smoke.volume}));
    const expected=dragged+1;
    assert.equal(Number(state.slider),expected);
    assert.equal(state.label,`${expected}%`);
    assert.match(state.arc,new RegExp(`^${expected}(?:\\.0+)? 100$`));
    assert.equal(state.volume,expected);

    const icon=page.locator('.tm-volume-icon-cell');
    await icon.click();
    assert.equal(await icon.evaluate(element=>element.matches(':focus-visible')),false);
    await page.evaluate(()=>document.activeElement?.blur());
    for(let attempt=0;attempt<12 && !(await icon.evaluate(element=>element===document.activeElement));attempt+=1)await page.keyboard.press('Tab');
    assert.equal(await icon.evaluate(element=>element===document.activeElement),true,'Tab reaches the custom mute icon');
    assert.equal(await icon.evaluate(element=>element.matches(':focus-visible')),true);
    assert.equal(await page.locator('.ytp-volume-area').evaluate(element=>getComputedStyle(element).display),'none');
    console.log('browser smoke: YouTube interaction, focus modality, and native replacement passed');
  }finally{await context.close();}
}

async function twitchSmoke(browser){
  const {context,page}=await preparedPage(browser,{platform:'twitch',url:'https://www.twitch.tv/smoke',html:twitchHtml,storage:{'tm-twitch-volume':'50','tm-twitch-muted':'true','tm-twitch-volume-slider-mode':'on'}});
  try{
    const dimensions=await page.evaluate(()=>({overlay:document.querySelector('#tm-volume-slider-overlay').getBoundingClientRect().height,panel:document.querySelector('.tm-volume-panel-bg').getBoundingClientRect().height,icon:document.querySelector('.tm-volume-icon-cell').getBoundingClientRect().height,controls:document.querySelector('[data-a-target="player-controls"]').getBoundingClientRect().height}));
    assert.equal(dimensions.overlay,32);
    assert.equal(dimensions.panel,40);
    assert.equal(dimensions.icon,40);
    assert.equal(dimensions.controls,40);

    await page.evaluate(()=>{const controls=document.querySelector('[data-a-target="player-controls"]');controls.setAttribute('data-a-visible','false');controls.setAttribute('aria-hidden','true');window.scrollTo(0,0);});
    await page.locator('video').click({position:{x:100,y:100}});
    await page.evaluate(()=>window.scrollTo(0,500));
    await page.keyboard.press('ArrowUp');
    const active=await page.evaluate(()=>({volume:window.__smoke.volume,muted:window.__smoke.muted,scrollY:window.scrollY,visible:document.querySelector('[data-a-target="player-controls"]').getAttribute('data-a-visible'),hold:document.querySelector('[data-a-target="player-controls"]').classList.contains('tm-volume-options-controls-hold')}));
    assert.equal(active.volume,.55);
    assert.equal(active.muted,true);
    assert.equal(active.scrollY,500);
    assert.equal(active.visible,'true');
    assert.equal(active.hold,true);

    await page.waitForTimeout(3150);
    assert.equal(await page.locator('[data-a-target="player-controls"]').evaluate(element=>element.classList.contains('tm-volume-options-controls-hold')),false);
    await page.locator('#outside').click();
    await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();window.scrollTo(0,0);window.__smokeKeyEvents=[];});
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const outside=await page.evaluate(()=>({volume:window.__smoke.volume,prevented:window.__smokeKeyEvents.at(-1)?.defaultPrevented,scrollY:window.scrollY}));
    assert.equal(outside.volume,.55);
    assert.equal(outside.prevented,false);
    assert.ok(outside.scrollY>0,'outside ArrowDown returns to page scrolling');
    console.log('browser smoke: Twitch dimensions, keyboard ownership, mute, visibility deadline, and scrolling passed');
  }finally{await context.close();}
}

async function twitchPreviewSmoke(browser){
  const {context,page}=await preparedPage(browser,{platform:'twitch',url:'https://www.twitch.tv/directory',html:twitchPreviewHtml,storage:{'tm-twitch-volume':'40','tm-twitch-muted':'false','tm-twitch-volume-slider-mode':'replace-native'},expectOverlay:false});
  try{
    const preview=await page.evaluate(()=>({
      overlay:!!document.querySelector('#tm-volume-slider-overlay'),
      optionsButton:!!document.querySelector('#tm-volume-options-button'),
      nativeDisplay:document.querySelector('.native-volume-group')?.style.display,
      volume:window.__smoke.volume
    }));
    assert.equal(preview.overlay,false);
    assert.equal(preview.optionsButton,false);
    assert.equal(preview.nativeDisplay,'');
    assert.equal(preview.volume,.5);
    console.log('browser smoke: Twitch compact preview remains native passed');
  }finally{await context.close();}
}

const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{
  await youtubeSmoke(browser);
  await twitchSmoke(browser);
  await twitchPreviewSmoke(browser);
  console.log(`browser smoke passed with ${executablePath}`);
}finally{
  await browser.close();
}
