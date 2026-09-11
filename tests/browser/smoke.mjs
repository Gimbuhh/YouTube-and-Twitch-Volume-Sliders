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
#movie_player{position:relative;width:900px;height:506px;background:#222}.ytp-left-controls,.ytp-right-controls{position:absolute;bottom:0;height:40px;display:flex;align-items:center}.ytp-left-controls{left:0}.ytp-right-controls{right:0}.ytp-volume-area,.ytp-settings-button{width:40px;height:40px}.ytp-settings-menu{position:absolute;right:0;bottom:48px;width:180px;height:120px;background:#333}
</style></head><body><div id="movie_player" class="html5-video-player" tabindex="0"><video class="html5-main-video"></video><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">S</button></div><div class="ytp-settings-menu" style="display:none"></div></div><div class="spacer"></div><script>
(()=>{const player=document.getElementById('movie_player');const settingsButton=player.querySelector('.ytp-settings-button');const settingsMenu=player.querySelector('.ytp-settings-menu');let volume=50,muted=false;settingsButton.addEventListener('click',()=>{settingsMenu.style.display=settingsMenu.style.display==='none'?'block':'none';});Object.assign(player,{getVolume:()=>volume,setVolume:value=>{volume=value;player.querySelector('video').dispatchEvent(new Event('volumechange'));},isMuted:()=>muted,mute:()=>{muted=true;player.querySelector('video').dispatchEvent(new Event('volumechange'));},unMute:()=>{muted=false;player.querySelector('video').dispatchEvent(new Event('volumechange'));}});window.__smoke={get volume(){return volume},get muted(){return muted}};})();
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

async function assertOptionsButtonAlignmentAtZoomLevels(page, platform){
  const zoomLevels=[0.5,0.67,0.8,0.9,1,1.1,1.25,1.5,1.75,2];
  const viewport=page.viewportSize();
  const session=await page.context().newCDPSession(page);
  try{
    for(const zoom of zoomLevels){
      await session.send('Emulation.setDeviceMetricsOverride',{
        width:Math.round(viewport.width/zoom),
        height:Math.round(viewport.height/zoom),
        deviceScaleFactor:zoom,
        mobile:false,
        screenWidth:viewport.width,
        screenHeight:viewport.height
      });
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const measurements=await page.locator('#tm-volume-options-popup button:visible').evaluateAll(buttons=>buttons.map(button=>{
        const label=button.querySelector(':scope > .tm-volume-options-button-label');
        const buttonRect=button.getBoundingClientRect();
        const labelRect=label?.getBoundingClientRect();
        const buttonStyle=getComputedStyle(button);
        const labelStyle=label?getComputedStyle(label):null;
        const horizontallyCentered=button.matches('.tm-volume-options-radio,.tm-volume-options-opacity-reset');
        return {
          id:button.id||button.className,
          hasLabel:!!labelRect,
          verticalOffset:labelRect?Math.abs((labelRect.top+(labelRect.height/2))-(buttonRect.top+(buttonRect.height/2)))*devicePixelRatio:Infinity,
          horizontalOffset:horizontallyCentered&&labelRect?Math.abs((buttonRect.left+(buttonRect.width/2))-(labelRect.left+(labelRect.width/2)))*devicePixelRatio:0,
          clipped:labelRect?labelRect.top<buttonRect.top-0.01||labelRect.bottom>buttonRect.bottom+0.01:true,
          fontSize:labelStyle?.fontSize,
          fontWeight:labelStyle?.fontWeight,
          selectedShadow:button.matches('.tm-volume-options-radio[aria-checked="true"]')?buttonStyle.textShadow:null
        };
      }));
      assert.equal(measurements.length>0,true,`${platform} exposes visible options buttons at ${zoom*100}% browser zoom`);
      assert.equal(measurements.every(item=>item.hasLabel),true,`${platform} options buttons keep dedicated labels at ${zoom*100}% browser zoom`);
      assert.equal(measurements.every(item=>item.verticalOffset<=0.51),true,`${platform} options button labels stay vertically centered at ${zoom*100}% browser zoom: ${JSON.stringify(measurements)}`);
      assert.equal(measurements.every(item=>item.horizontalOffset<=0.51),true,`${platform} centered button labels stay horizontally centered at ${zoom*100}% browser zoom: ${JSON.stringify(measurements)}`);
      assert.equal(measurements.every(item=>!item.clipped),true,`${platform} options button labels remain unclipped at ${zoom*100}% browser zoom`);
      assert.equal(measurements.every(item=>item.fontSize==='14px'&&item.fontWeight==='400'),true,`${platform} options buttons preserve the reference typography at ${zoom*100}% browser zoom`);
      assert.equal(measurements.filter(item=>item.selectedShadow!==null).every(item=>item.selectedShadow!=='none'),true,`${platform} selected buttons preserve the reference shadow at ${zoom*100}% browser zoom`);
      const behaviorOffsets=await page.locator('#tm-volume-options-popup .tm-volume-options-checklist .tm-volume-options-button-label').evaluateAll(labels=>{
        const sectionLabel=labels[0]?.closest('.tm-volume-options-section')?.querySelector('.tm-volume-options-section-label');
        const sectionLeft=sectionLabel?.getBoundingClientRect().left??0;
        return labels.map(label=>Math.abs(label.getBoundingClientRect().left-sectionLeft)*devicePixelRatio);
      });
      assert.equal(behaviorOffsets.every(offset=>offset<=0.51),true,`${platform} behavior labels align with their section heading at ${zoom*100}% browser zoom: ${JSON.stringify(behaviorOffsets)}`);
    }
  }finally{
    await session.send('Emulation.clearDeviceMetricsOverride');
  }
}

async function youtubeSmoke(browser){
  const {context,page}=await preparedPage(browser,{platform:'youtube',url:'https://www.youtube.com/watch?v=smoke',html:youtubeHtml,storage:{'tm-yt-volume':'50','tm-yt-muted':'false','tm-yt-volume-slider-mode':'replace-native','tm-yt-volume-slider-step':'10'}});
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
    const expected=Math.min(100,dragged+5);
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

    await page.locator('.ytp-settings-button').click();
    await page.locator('.ytp-settings-menu').waitFor({state:'visible'});
    await page.locator('#tm-volume-options-button').click();
    await page.locator('.ytp-settings-menu').waitFor({state:'hidden'});
    const stepGroup=page.locator('[role="radiogroup"][aria-label="Volume adjustment step"]');
    await stepGroup.waitFor({state:'visible'});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.equal(await page.locator('#tm-volume-options-popup').isVisible(),true,'YouTube volume options remain open after closing native settings');
    await assertOptionsButtonAlignmentAtZoomLevels(page,'YouTube');
    const stepLayout=await stepGroup.evaluate(group=>{
      const groupRect=group.getBoundingClientRect();
      const buttons=Array.from(group.querySelectorAll('[role="radio"]')).map(button=>button.getBoundingClientRect());
      return {groupWidth:groupRect.width,buttonWidths:buttons.map(rect=>rect.width),inside:buttons.every(rect=>rect.left>=groupRect.left&&rect.right<=groupRect.right)};
    });
    assert.ok(stepLayout.groupWidth>180,'adjustment-step group has usable width');
    assert.equal(stepLayout.buttonWidths.every(width=>width>=40),true,'adjustment-step choices keep usable hit targets');
    assert.equal(stepLayout.inside,true,'adjustment-step choices stay inside the options panel');
    await page.locator('#tm-volume-options-step-10').click();
    const stepState=await page.evaluate(()=>({
      saved:localStorage.getItem('tm-yt-volume-slider-step'),
      sliderStep:document.querySelector('#tm-volume-slider-range').step,
      behaviorStep:document.querySelector('#tm-volume-slider-range').dataset.tmVolumeStep,
      tickInterval:document.querySelector('.tm-slider-ticks').dataset.tmTickInterval,
      tickCount:document.querySelectorAll('.tm-slider-tick').length
    }));
    assert.deepEqual(stepState,{saved:'10',sliderStep:'1',behaviorStep:'10',tickInterval:'10',tickCount:9});

    await page.locator('#tm-volume-options-step-2').click();
    const twoStepState=await page.evaluate(() => ({
      saved:localStorage.getItem('tm-yt-volume-slider-step'),
      sliderStep:document.querySelector('#tm-volume-slider-range').step,
      behaviorStep:document.querySelector('#tm-volume-slider-range').dataset.tmVolumeStep,
      tickInterval:document.querySelector('.tm-slider-ticks').dataset.tmTickInterval,
      tickCount:document.querySelectorAll('.tm-slider-tick').length,
      majorTickCount:document.querySelectorAll('.tm-slider-tick-major').length
    }));
    assert.deepEqual(twoStepState,{saved:'2',sliderStep:'1',behaviorStep:'2',tickInterval:'2',tickCount:49,majorTickCount:9});
    const fineStepGeometry=await page.evaluate(()=>{
      const range=document.querySelector('#tm-volume-slider-range').getBoundingClientRect();
      const centerOf=pct=>{
        const rect=document.querySelector(`.tm-slider-tick[data-tm-tick-pct="${pct}"]`).getBoundingClientRect();
        return rect.left+(rect.width/2);
      };
      return {tick18:centerOf(18),tick46:centerOf(46),tick48:centerOf(48),tick50:centerOf(50),y:range.top+(range.height/2)};
    });
    await page.evaluate(()=>{
      const slider=document.querySelector('#tm-volume-slider-range');
      window.__smokeMajorPressWrites=[];
      document.querySelector('video').addEventListener('volumechange',()=>window.__smokeMajorPressWrites.push(window.__smoke.volume));
      slider.value='50';
      slider.dispatchEvent(new Event('input',{bubbles:true}));
      window.__smokeMajorPressWrites=[];
    });
    await page.mouse.click(fineStepGeometry.tick18,fineStepGeometry.y);
    assert.equal(Number(await slider.inputValue()),20,'major-tick magnet bypasses the nearby fine value');
    assert.deepEqual(await page.evaluate(()=>window.__smokeMajorPressWrites.every(value=>value===20)),true,'major-tick press never writes the nearby fine value');

    await slider.evaluate(control=>{control.value='48';control.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.mouse.click(fineStepGeometry.tick50,fineStepGeometry.y);
    assert.equal(Number(await slider.inputValue()),50,'two-percent direct press snaps to the nearby major tick');

    await slider.evaluate(control=>{control.value='46';control.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.mouse.move(fineStepGeometry.tick46,fineStepGeometry.y);
    await page.mouse.down();
    await page.mouse.move(fineStepGeometry.tick48,fineStepGeometry.y,{steps:3});
    await page.mouse.up();
    assert.equal(Number(await slider.inputValue()),48,'two-percent drag remains on the fine tick beside a major tick');

    await page.locator('#tm-volume-options-button').click();
    await page.locator('#tm-volume-options-step-1').waitFor({state:'visible'});
    await page.locator('#tm-volume-options-step-1').click();
    await slider.evaluate(control=>{control.value='9';control.dispatchEvent(new Event('input',{bubbles:true}));});
    const tenPercentTick=await page.locator('.tm-slider-tick[data-tm-tick-pct="10"]').boundingBox();
    await page.mouse.click(tenPercentTick.x+(tenPercentTick.width/2),fineStepGeometry.y);
    assert.equal(Number(await slider.inputValue()),10,'one-percent direct press snaps to the nearby major tick');
    await page.keyboard.press('Escape');
    console.log('browser smoke: YouTube interaction, adjustment-step layout, focus modality, and native replacement passed');
  }finally{await context.close();}
}

async function twitchSmoke(browser){
  const {context,page}=await preparedPage(browser,{platform:'twitch',url:'https://www.twitch.tv/smoke',html:twitchHtml,storage:{'tm-twitch-volume':'50','tm-twitch-muted':'true','tm-twitch-volume-slider-mode':'on','tm-twitch-volume-slider-step':'5'}});
  try{
    const dimensions=await page.evaluate(()=>({overlay:document.querySelector('#tm-volume-slider-overlay').getBoundingClientRect().height,panel:document.querySelector('.tm-volume-panel-bg').getBoundingClientRect().height,icon:document.querySelector('.tm-volume-icon-cell').getBoundingClientRect().height,controls:document.querySelector('[data-a-target="player-controls"]').getBoundingClientRect().height}));
    assert.equal(dimensions.overlay,32);
    assert.equal(dimensions.panel,40);
    assert.equal(dimensions.icon,40);
    assert.equal(dimensions.controls,40);

    await page.locator('#tm-volume-options-button').click();
    await page.locator('#tm-volume-options-popup').waitFor({state:'visible'});
    await assertOptionsButtonAlignmentAtZoomLevels(page,'Twitch');
    await page.keyboard.press('Escape');

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

async function wheelSmoke(browser, platform) {
  const youtube = platform === 'youtube';
  const prefix = youtube ? 'tm-yt' : 'tm-twitch';
  const { context, page } = await preparedPage(browser, {
    platform,
    url: youtube ? 'https://www.youtube.com/watch?v=wheel' : 'https://www.twitch.tv/wheel',
    html: youtube ? youtubeHtml : twitchHtml,
    storage: { [`${prefix}-volume`]: '50', [`${prefix}-muted`]: 'false', [`${prefix}-volume-slider-step`]: '5' }
  });
  try {
    await page.locator('.tm-volume-icon-cell').hover();
    await page.evaluate(() => {
      window.__wheelEvidence = [];
      window.addEventListener('wheel', event => {
        queueMicrotask(() => window.__wheelEvidence.push({ prevented: event.defaultPrevented }));
      }, true);
    });
    const wheel = async (delta) => {
      const count = await page.evaluate(() => window.__wheelEvidence.length);
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(previous => window.__wheelEvidence.length > previous, count);
    };
    const slider = page.locator('#tm-volume-slider-range');
    await wheel(-100);
    assert.equal(await slider.inputValue(), '55', `${platform}: discrete wheel input keeps one selected step`);
    await wheel(100);
    assert.equal(await slider.inputValue(), '50');
    for (let index = 0; index < 10; index++) {
      await wheel(-0.1);
    }
    assert.equal(await slider.inputValue(), '50', `${platform}: tiny trackpad events do not run away`);
    await wheel(-20);
    await wheel(-20);
    assert.equal(await slider.inputValue(), '55', `${platform}: smooth scrolling accumulates into a step`);
    await page.keyboard.down('Control');
    try {
      await wheel(-100);
      assert.equal(await slider.inputValue(), '55', `${platform}: Ctrl+wheel does not change volume`);
      assert.equal(await page.evaluate(() => window.__wheelEvidence.at(-1).prevented), false, `${platform}: zoom gesture is not cancelled`);
    } finally {
      await page.keyboard.up('Control');
    }
    await page.locator('#tm-volume-options-button').click();
    const thickness = page.locator('#tm-volume-options-thickness-section input');
    const startPreview = async () => {
      await thickness.scrollIntoViewIfNeeded();
      const box = await thickness.boundingBox();
      assert.ok(box, `${platform}: thickness control has rendered geometry`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForFunction(() => document.querySelector('#tm-volume-slider-overlay').dataset.tmOptionsPreview === 'thickness');
    };
    await startPreview();
    await page.mouse.move(1100, 700);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('#tm-volume-slider-overlay').dataset.tmOptionsPreview);
    await startPreview();
    await page.keyboard.press('Escape');
    await page.locator('#tm-volume-options-popup').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#tm-volume-slider-overlay').getAttribute('data-tm-options-preview'), null, `${platform}: closing options ends the preview`);
    await page.mouse.up();
    console.log(`browser smoke: ${platform} mouse wheel, smooth scrolling, and zoom pass-through passed`);
    console.log(`browser smoke: ${platform} options preview release and Escape cleanup passed`);
  } finally {
    await context.close();
  }
}

const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{
  await youtubeSmoke(browser);
  await twitchSmoke(browser);
  await twitchPreviewSmoke(browser);
  await wheelSmoke(browser, 'youtube');
  await wheelSmoke(browser, 'twitch');
  console.log(`browser smoke passed with ${executablePath}`);
}finally{
  await browser.close();
}
