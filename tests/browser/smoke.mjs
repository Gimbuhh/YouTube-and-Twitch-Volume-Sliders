import assert from 'node:assert/strict';
import { access, mkdir, readFile } from 'node:fs/promises';
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
(()=>{const player=document.querySelector('.video-player');const video=player.querySelector('video');const state={volume:.5,muted:true};player._tmPlayerApi={getVolume:()=>state.volume,setVolume:value=>{state.volume=value;video.dispatchEvent(new Event('volumechange'));},isMuted:()=>state.muted,setMuted:value=>{state.muted=value;video.muted=value;video.dispatchEvent(new Event('volumechange'));}};player.__reactFiber$smoke={return:{memoizedProps:{mediaPlayerInstance:player._tmPlayerApi},return:null}};window.__smoke=state;})();
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
  return {context,page,pageErrors};
}

async function assertModeDropdown(page, platform) {
  // A native light menu must not leave inherited white text unreadable.
  await page.addStyleTag({ content: 'select option { background-color: #fff; }' });
  const initial = await page.locator('#tm-volume-options-mode').evaluate(select => {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      .map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return {
      focused: select === document.activeElement,
      outlined: getComputedStyle(select).outlineStyle !== 'none',
      borderless: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].every(side => getComputedStyle(select)[side] === '0px'),
      labels: [...select.options].map(option => option.textContent),
      readable: [...select.options].every(option => {
        const style = getComputedStyle(option), text = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) >= 4.5;
      })
    };
  });
  assert.deepEqual(initial, { focused: false, outlined: false, borderless: true, labels: ['On', 'Off', 'Replace native'], readable: true }, `${platform}: opening Options leaves Mode borderless and every dropdown choice readable`);
  const mode = page.locator('#tm-volume-options-mode');
  const closed = await mode.evaluate(element => ({ arrow: getComputedStyle(element).backgroundImage, background: getComputedStyle(element).backgroundColor }));
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#tm-volume-options-always-expanded').evaluate(element => element === document.activeElement), true, `${platform}: reverse Tab enters the last setting from the dialog`);
  await page.keyboard.press('Tab');
  const focused = await mode.evaluate(element => ({ focused: element === document.activeElement && element.matches(':focus-visible'), background: getComputedStyle(element).backgroundColor, outlined: getComputedStyle(element).outlineStyle !== 'none' }));
  assert.equal(focused.focused, true, `${platform}: Tab focuses Mode`);
  assert.notEqual(focused.background, closed.background, `${platform}: background indicates keyboard focus`);
  assert.equal(focused.outlined, false, `${platform}: keyboard focus adds no border`);
  for (const close of ['Escape', 'Enter', 'outside']) {
    if (close === 'Enter') await mode.press('Space');
    else await mode.click();
    await page.waitForFunction(() => document.querySelector('#tm-volume-options-mode').matches(':open'));
    assert.notEqual(await mode.evaluate(element => getComputedStyle(element).backgroundImage), closed.arrow, `${platform}: open picker shows the up arrow`);
    if (close === 'Escape' && process.env.VOLUME_SLIDER_SCREENSHOTS) {
      await mkdir(process.env.VOLUME_SLIDER_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.VOLUME_SLIDER_SCREENSHOTS, `${platform}-mode-open.png`) });
    }
    if (close === 'outside') await page.locator('.tm-volume-options-title').click();
    else await page.keyboard.press(close);
    await page.waitForFunction(() => !document.querySelector('#tm-volume-options-mode').matches(':open'));
    assert.equal(await mode.evaluate(element => getComputedStyle(element).backgroundImage), closed.arrow, `${platform}: ${close} restores the down arrow`);
    assert.equal(await page.locator('#tm-volume-options-popup').isVisible(), true, `${platform}: dismissing the picker keeps Options open`);
  }
}

async function modeDropdownSmoke(browser, platform) {
  const youtube = platform === 'youtube';
  const { context, page, pageErrors } = await preparedPage(browser, {
    platform,
    url: youtube ? 'https://www.youtube.com/watch?v=mode' : 'https://www.twitch.tv/mode',
    html: youtube ? youtubeHtml : twitchHtml,
    storage: { [`tm-${youtube ? 'yt' : 'twitch'}-volume-slider-mode`]: 'replace-native' }
  });
  try {
    await page.locator('#tm-volume-options-button').click();
    await assertModeDropdown(page, platform);
    assert.deepEqual(pageErrors, [], `${platform}: Mode smoke has no page errors`);
    console.log(`browser smoke: ${platform} borderless Mode, option contrast, keyboard focus and native picker arrow on open/Escape/Enter/outside click passed`);
  } finally { await context.close(); }
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
      const behaviorOffsets=await page.locator('#tm-volume-options-popup .tm-volume-options-checklist:visible .tm-volume-options-button-label').evaluateAll(labels=>{
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
  const {context,page,pageErrors}=await preparedPage(browser,{platform:'youtube',url:'https://www.youtube.com/watch?v=smoke',html:youtubeHtml,storage:{'tm-yt-volume':'50','tm-yt-muted':'false','tm-yt-volume-slider-mode':'replace-native','tm-yt-volume-slider-step':'10'}});
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
    await page.locator('#tm-volume-options-tab-appearance').click();
    await assertOptionsButtonAlignmentAtZoomLevels(page,'YouTube Appearance');
    await page.locator('#tm-volume-options-tab-general').click();
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
    assert.deepEqual(pageErrors, [], 'YouTube interaction smoke has no page errors');
    console.log('browser smoke: YouTube interaction, adjustment-step layout, focus modality, and native replacement passed');
  }finally{await context.close();}
}

async function twitchSmoke(browser){
  const {context,page,pageErrors}=await preparedPage(browser,{platform:'twitch',url:'https://www.twitch.tv/smoke',html:twitchHtml,storage:{'tm-twitch-volume':'50','tm-twitch-muted':'true','tm-twitch-volume-slider-mode':'on','tm-twitch-volume-slider-step':'5'}});
  try{
    const dimensions=await page.evaluate(()=>({overlay:document.querySelector('#tm-volume-slider-overlay').getBoundingClientRect().height,panel:document.querySelector('.tm-volume-panel-bg').getBoundingClientRect().height,icon:document.querySelector('.tm-volume-icon-cell').getBoundingClientRect().height,controls:document.querySelector('[data-a-target="player-controls"]').getBoundingClientRect().height}));
    assert.equal(dimensions.overlay,32);
    assert.equal(dimensions.panel,40);
    assert.equal(dimensions.icon,40);
    assert.equal(dimensions.controls,40);

    await page.locator('#tm-volume-options-button').click();
    await page.locator('#tm-volume-options-popup').waitFor({state:'visible'});
    await assertOptionsButtonAlignmentAtZoomLevels(page,'Twitch');
    await page.locator('#tm-volume-options-tab-appearance').click();
    await assertOptionsButtonAlignmentAtZoomLevels(page,'Twitch Appearance');
    await page.locator('#tm-volume-options-tab-general').click();
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
    assert.deepEqual(pageErrors, [], 'Twitch interaction smoke has no page errors');
    console.log('browser smoke: Twitch dimensions, keyboard ownership, mute, visibility deadline, and scrolling passed');
  }finally{await context.close();}
}

async function nativeVolumeInputSmoke(browser){
  const context=await browser.newContext();
  const page=await context.newPage();
  const helper=await readFile(join(projectRoot,'src/shared/native-volume-input.js'),'utf8');
  const html=`<!doctype html><div id="player"><video></video><input type="range" id="native" min="0" max="100" step="5" value="20"></div><script>${helper.replace('export function','function')}
    window.__raw=20;window.__adopted=[];
    document.querySelector('#native').addEventListener('input',event=>{window.__raw=Number(event.target.value);event.stopPropagation()});
    bindNativeVolumeInput({window,video:document.querySelector('video'),player:document.querySelector('#player'),selector:'#native',normalizer:{acceptNativeVolume(){window.__adopted.push(window.__raw)}},onChange(){}});
  </script>`;
  try{
    await context.route('https://volume-input.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('https://volume-input.test/');
    await page.locator('#native').focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(()=>window.__raw),25);
    assert.equal(await page.evaluate(()=>window.__adopted.at(-1)),25,'native gestures adopt the value after the site setter');
    console.log('browser smoke: native volume gestures adopt the completed site setter');
  }finally{await context.close();}
}

async function twitchExtensionSmoke(browser){
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage(), errors=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  const artifact=await readFile(join(artifactRoot,'twitch-volume-slider.user.js'),'utf8');
  const script=`<script>${artifact.replaceAll('</script>','<\\/script>')}</script>`;
  const storage=`<script>localStorage.setItem('tm-twitch-volume','25');localStorage.setItem('tm-twitch-muted','false');window.__commands=[];window.addEventListener('message',e=>{if(e.data?.type==='tm-volume-player-key-v1')window.__commands.push(e.data.key)});</script>`;
  const main=twitchHtml.replace('<head>',`<head>${storage}${script}`)
    .replace('<video></video>','<video></video><iframe class="extension-view__iframe" src="https://supervisor.ext-twitch.tv/supervisor" style="position:absolute;top:0;left:0;width:900px;height:466px;border:0"></iframe>')
    .replace('</body>',`<script>window.__smoke.paused=false;const v=document.querySelector('video');Object.defineProperty(v,'paused',{get:()=>window.__smoke.paused});v.pause=()=>{window.__smoke.paused=true};v.play=()=>{window.__smoke.paused=false;return Promise.resolve()};</script></body>`);
  const supervisor=`<!doctype html><html><head><script>window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe')?.contentWindow)parent.postMessage(event.data,'*')});</script>${script}<style>body{margin:0}iframe{width:900px;height:466px;border:0}</style></head><body><iframe src="https://keyboard-test.ext-twitch.tv/player"></iframe></body></html>`;
  const extension=`<!doctype html><html><head>${script}<style>body{min-height:1800px}</style></head><body><div id="blank" style="height:260px">Extension background</div><input aria-label="Extension input"><button>Extension action</button><script>window.__clicks=0;document.querySelector('button').onclick=()=>window.__clicks++;document.addEventListener('keydown',e=>{window.__lastKey=e},true);document.addEventListener('keydown',e=>{if(window.__handleKeys && e.key==='ArrowDown')e.preventDefault()});</script></body></html>`;
  try{
    await context.route('https://www.twitch.tv/**',route=>route.fulfill({contentType:'text/html',body:main}));
    await context.route('https://supervisor.ext-twitch.tv/**',route=>route.fulfill({contentType:'text/html',body:supervisor}));
    await context.route('https://keyboard-test.ext-twitch.tv/**',route=>route.fulfill({contentType:'text/html',body:extension}));
    await page.goto('https://www.twitch.tv/extension-test');
    await page.waitForSelector('#tm-volume-slider-range',{state:'attached'});
    const frame=page.frameLocator('.extension-view__iframe').frameLocator('iframe');
    await frame.locator('#blank').click();
    for(const [key,value] of [['ArrowUp','30'],['ArrowDown','25']]){
      await page.keyboard.press(key);
      await page.waitForFunction(value=>document.querySelector('#tm-volume-slider-range').value===value,value);
      assert.equal(await page.locator('[data-tm-volume-feedback]').textContent(),`${value}%`,'extension arrows show selected volume on the player');
      assert.equal(await frame.locator('body').evaluate(()=>window.__lastKey.defaultPrevented),true,'relayed arrows prevent native scrolling');
    }
    await page.keyboard.press('Space'); await page.waitForFunction(()=>window.__smoke.paused);
    assert.equal(await page.locator('[data-tm-volume-feedback]').count(),0,'extension pause clears volume feedback');
    await page.keyboard.press('Space'); await page.waitForFunction(()=>!window.__smoke.paused);
    assert.equal(await frame.locator('body').evaluate(()=>window.__lastKey.defaultPrevented),true,'relayed Space prevents native scrolling');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(()=>window.__commands),['ArrowUp','ArrowUp','ArrowDown','ArrowDown',' ',' ',' ',' '],'both relay copies arrive while each key changes the player only once');
    assert.equal(await frame.locator('body').evaluate(()=>window.scrollY),0,'extension key handling does not scroll');
    assert.equal(await page.evaluate(()=>window.scrollY),0,'player page does not scroll');
    await frame.getByLabel('Extension input').fill('hello');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
    assert.equal(await page.locator('#tm-volume-slider-range').inputValue(),'25');
    assert.equal(await page.evaluate(()=>window.__smoke.paused),false);
    await frame.getByRole('button').click(); await page.keyboard.press('Space');
    assert.equal(await frame.locator('body').evaluate(()=>window.__clicks),2,'mouse and Space still activate extension buttons');
    assert.equal(await page.evaluate(()=>window.__smoke.paused),false);
    await frame.locator('#blank').click(); await frame.locator('body').evaluate(()=>{window.__handleKeys=true;});
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#tm-volume-slider-range').inputValue(),'25','extension-owned keys are not forwarded');
    assert.deepEqual(errors,[]);
    console.log('browser smoke: nested cross-origin Twitch extension preserves Space/volume keys, text input, buttons and extension-owned keys');
  }finally{await context.close();}
}

async function twitchZoomSmoke(browser) {
  const html = twitchPreviewHtml.replace('width:533px', 'width:calc(100vw - 390px)');
  const {context, page, pageErrors} = await preparedPage(browser, {
    platform: 'twitch', url: 'https://www.twitch.tv/test', html,
    storage: {'tm-twitch-volume-slider-mode':'replace-native'}
  });
  try {
    await page.locator('#tm-volume-options-button').click();
    const session = await context.newCDPSession(page);
    for (const zoom of [1, 1.333333, 1.4, 1.5, 1.75, 2, 1]) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: Math.round(1530 / zoom), height: Math.round(1220 / zoom), deviceScaleFactor: zoom, mobile: false
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Chat and other page updates also trigger native-volume visibility checks.
      await page.evaluate(() => { const update = document.createElement('span'); document.querySelector('#outside').appendChild(update); update.remove(); });
      const state = await page.evaluate(() => {
        const overlay = document.getElementById('tm-volume-slider-overlay');
        const button = document.getElementById('tm-volume-options-button');
        const popup = document.getElementById('tm-volume-options-popup');
        const rect = popup?.getBoundingClientRect();
        return {
          overlay: !!overlay, button: !!button,
          nativeDisplay: getComputedStyle(document.querySelector('.native-volume-group')).display,
          popupOpen: !!popup && !popup.hidden,
          popupHit: !!rect && popup.contains(document.elementFromPoint(rect.left + 20, rect.top + 20))
        };
      });
      assert.equal(state.overlay, true, `Twitch ${zoom}: zoom keeps the custom slider`);
      assert.equal(state.button, true, `Twitch ${zoom}: zoom keeps the options button`);
      assert.equal(state.nativeDisplay, 'none', `Twitch ${zoom}: native volume stays replaced`);
      assert.equal(state.popupOpen, true, `Twitch ${zoom}: options remain open`);
      assert.equal(state.popupHit, true, `Twitch ${zoom}: options remain visible and receive pointer input`);
    }
    await session.send('Emulation.clearDeviceMetricsOverride');
    await page.keyboard.press('Escape');
    await page.locator('#tm-volume-options-popup').waitFor({state:'hidden'});
    await page.locator('#tm-volume-options-button').click();
    await page.locator('#tm-volume-options-popup').waitFor({state:'visible'});
    assert.deepEqual(pageErrors, [], 'Twitch zoom smoke has no page errors');
    console.log('browser smoke: Twitch zoom preserves replacement controls and usable settings from 100% through 200%');
  } finally {
    await context.close();
  }
}

async function twitchPreviewSmoke(browser){
  const {context,page,pageErrors}=await preparedPage(browser,{platform:'twitch',url:'https://www.twitch.tv/directory',html:twitchPreviewHtml,storage:{'tm-twitch-volume':'40','tm-twitch-muted':'false','tm-twitch-volume-slider-mode':'replace-native'},expectOverlay:false});
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
    assert.deepEqual(pageErrors, [], 'Twitch preview smoke has no page errors');
    console.log('browser smoke: Twitch compact preview remains native passed');
  }finally{await context.close();}
}

async function wheelSmoke(browser, platform) {
  const youtube = platform === 'youtube';
  const prefix = youtube ? 'tm-yt' : 'tm-twitch';
  const { context, page, pageErrors } = await preparedPage(browser, {
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
    await page.locator('#tm-volume-options-tab-appearance').click();
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
    assert.deepEqual(pageErrors, [], `${platform}: wheel and preview smoke has no page errors`);
    console.log(`browser smoke: ${platform} mouse wheel, smooth scrolling, and zoom pass-through passed`);
    console.log(`browser smoke: ${platform} options preview release and Escape cleanup passed`);
  } finally {
    await context.close();
  }
}

async function youtubeOptionsPositionSmoke(browser) {
  const hiddenBar = '<div style="display:none"><div class="ytp-progress-bar"><div class="ytp-progress-bar-padding"></div></div></div>';
  const visibleBar = '<div class="ytp-progress-bar" style="position:absolute;left:12px;right:12px;bottom:40px;height:6px"><div class="ytp-progress-bar-padding"></div></div>';
  const unrelatedBar = '<div class="ytp-progress-bar" style="position:absolute;top:0;height:6px;width:500px"><div class="ytp-progress-bar-padding"></div></div>';
  for (const [label, bars, outside] of [
    ['hidden duplicate', hiddenBar + visibleBar, ''],
    ['hidden bars only', hiddenBar, ''],
    ['unrelated player', visibleBar, unrelatedBar]
  ]) {
    const html = youtubeHtml.replace('<body>', `<body>${outside}`)
      .replace('<video class="html5-main-video">', `${bars}<video class="html5-main-video">`);
    const { context, page, pageErrors } = await preparedPage(browser, {
      platform: 'youtube', url: 'https://www.youtube.com/watch?v=smoke', html,
      storage: { 'tm-yt-volume-slider-mode': 'replace-native' }
    });
    try {
      for (const width of [1280, 1100]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator('#tm-volume-options-button').click();
        const geometry = await page.locator('#tm-volume-options-popup').evaluate(popup => {
          const player = document.getElementById('movie_player');
          const bars = Array.from(player.querySelectorAll('.ytp-progress-bar')).map(bar => bar.getBoundingClientRect());
          const anchor = bars.find(rect => rect.width > 0 && rect.height > 0)
            || document.getElementById('tm-volume-options-button').getBoundingClientRect();
          const rect = popup.getBoundingClientRect();
          const playerRect = player.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + 20;
          return {
            top: rect.top, bottom: rect.bottom, expectedBottom: anchor.top - 8,
            playerTop: playerRect.top, hit: popup.contains(document.elementFromPoint(x, y))
          };
        });
        assert.ok(geometry.top >= geometry.playerTop, `YouTube ${label}: options stay inside the player: ${JSON.stringify(geometry)}`);
        assert.ok(Math.abs(geometry.bottom - geometry.expectedBottom) < 1, `YouTube ${label}: options use the rendered player anchor`);
        assert.equal(geometry.hit, true, `YouTube ${label}: options are visible and receive pointer input`);
        await page.keyboard.press('Escape');
        await page.locator('#tm-volume-options-popup').waitFor({ state: 'hidden' });
      }
      assert.deepEqual(pageErrors, [], `YouTube ${label}: options positioning smoke has no page errors`);
    } finally {
      await context.close();
    }
  }
  console.log('browser smoke: YouTube options ignore hidden and unrelated progress bars, with button fallback');
}

const browser=await chromium.launch({headless:true,executablePath,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
try{
  await youtubeOptionsPositionSmoke(browser);
  await twitchZoomSmoke(browser);
  await modeDropdownSmoke(browser, 'youtube');
  await modeDropdownSmoke(browser, 'twitch');
  await youtubeSmoke(browser);
  await twitchSmoke(browser);
  await nativeVolumeInputSmoke(browser);
  await twitchExtensionSmoke(browser);
  await twitchPreviewSmoke(browser);
  await wheelSmoke(browser, 'youtube');
  await wheelSmoke(browser, 'twitch');
  console.log(`browser smoke passed with ${executablePath}`);
}finally{
  await browser.close();
}
