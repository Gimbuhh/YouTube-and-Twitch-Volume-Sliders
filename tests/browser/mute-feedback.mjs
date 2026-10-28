import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchChrome, launchFirefox } from '../helpers/browser.js';
import { mockAudioCapture } from '../helpers/audio.js';

const browser=await (process.argv.includes('--firefox') ? launchFirefox() : launchChrome());
try {
  for(const platform of ['youtube','twitch']) for(const normalize of [false,true]) {
    const youtube=platform==='youtube', prefix=youtube?'yt':'twitch';
    const page=await browser.newPage({viewport:{width:1100,height:760}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const controls=youtube
      ? '<div class="ytp-left-controls"><div class="ytp-volume-area"><button class="ytp-mute-button">Native mute</button></div></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button></div>'
      : '<div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"><button data-a-target="player-mute-unmute-button">Native mute</button></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button">Settings</button></div></div>';
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>
      body{margin:0;background:#111;color:white}#movie_player,.video-player{position:relative;width:900px;height:500px}video{display:block;width:900px;height:450px}
      .ytp-left-controls,.ytp-right-controls,[data-a-target="player-controls"],.player-controls__left-control-group,.player-controls__right-control-group{display:flex;align-items:center;height:40px}
      [data-a-target="player-controls"]{justify-content:space-between}
      body>input{display:block;margin-top:80px}
      </style><div ${youtube?'id="movie_player"':'class="video-player" data-a-target="player-overlay-click-handler"'} tabindex="0"><video></video>${controls}<div id="native-mute-feedback" hidden>Mute (0%)</div></div><input aria-label="Chat input"><button id="outside">Outside player</button>` }));
    try {
      await page.goto(youtube?'https://www.youtube.com/watch?v=mute-feedback':'https://www.twitch.tv/mute-feedback');
      await page.evaluate(({youtube,prefix,normalize,mock})=>{
        const video=document.querySelector('video'), player=video.parentElement;
        (0,eval)(`(${mock})`)(window,video);
        video.volume=.3;
        window.__muteApiWrites=0;
        const api={getVolume:()=>video.volume*(youtube?100:1),setVolume:value=>{video.volume=value/(youtube?100:1)},isMuted:()=>video.muted,
          mute:()=>{window.__muteApiWrites++;video.muted=true},unMute:()=>{window.__muteApiWrites++;video.muted=false},setMuted:value=>{video.muted=value}};
        if(youtube) Object.assign(player,api);
        else player.__reactFiber$mute={return:{memoizedProps:{mediaPlayerInstance:api},return:null}};
        localStorage.setItem(`tm-${prefix}-volume`,'30');localStorage.setItem(`tm-${prefix}-muted`,'false');
        localStorage.setItem(`tm-${prefix}-volume-slider-normalization`,String(normalize));
        window.__nativeMuteKeys=0;
        (youtube?player:document).addEventListener('keydown',event=>{
          if(event.key.toLowerCase()!=='m'||event.target.closest('input,textarea'))return;
          if(youtube) document.querySelector('#native-mute-feedback').hidden=false;
          window.__nativeMuteKeys++;video.muted=!video.muted;event.preventDefault();
        });
        document.querySelector(youtube?'.ytp-mute-button':'[data-a-target="player-mute-unmute-button"]').onclick=()=>{video.muted=!video.muted};
      },{youtube,prefix,normalize,mock:mockAudioCapture.toString()});
      await page.addScriptTag({content:await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`,import.meta.url),'utf8')});
      const player=page.locator('#movie_player,.video-player'),popup=page.locator('[data-tm-volume-feedback]');
      const assertFeedback=async muted=>{
        const label=muted?'Muted':'Unmuted';
        await page.waitForFunction(label=>document.querySelector('[data-tm-volume-feedback]')?.textContent===label,label,{timeout:1500});
        assert.equal(await popup.getAttribute('data-volume-icon'),muted?'muted':'low');
        assert.equal(await popup.getAttribute('aria-label'),`${label}, volume 30%`);
        assert.equal(await page.locator('video').evaluate(video=>video.muted),muted);
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(),'30');
      };
      const muteWritesBefore=await page.evaluate(()=>window.__muteApiWrites);
      await player.press('m');await assertFeedback(true);
      await player.press('m');await assertFeedback(false);
      assert.equal(await page.evaluate(()=>window.__nativeMuteKeys),youtube?0:2,'YouTube shortcuts cannot reach the native bezel handler');
      if(youtube){
        assert.equal(await page.evaluate(()=>window.__muteApiWrites)-muteWritesBefore,2,'each M press toggles mute exactly once');
        assert.equal(await page.locator('#native-mute-feedback').isHidden(),true,'only custom keyboard feedback appears');
      }
      await page.getByRole('button',{name:'Outside player'}).click();
      await page.keyboard.press('m');await assertFeedback(true);
      await page.keyboard.press('m');await assertFeedback(false);
      await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});
      await page.keyboard.press('m');await assertFeedback(true);
      await page.keyboard.press('m');await assertFeedback(false);
      const assertSilentAction=async muted=>{
        await page.waitForTimeout(40);
        assert.equal(await popup.count(),0,'buttons do not create keyboard mute feedback');
        assert.equal(await page.locator('video').evaluate(video=>video.muted),muted);
        assert.equal(await page.locator('#tm-volume-slider-range').inputValue(),'30');
      };
      const native=page.locator(youtube?'.ytp-mute-button':'[data-a-target="player-mute-unmute-button"]');
      await native.click();await assertSilentAction(true);await native.click();await assertSilentAction(false);
      const custom=page.locator('.tm-volume-icon-cell');
      await custom.click();await assertSilentAction(true);await custom.click();await assertSilentAction(false);
      await custom.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
      assert.equal(await custom.evaluate(element=>element===document.activeElement&&element.matches(':focus-visible')),true);
      await page.keyboard.press('Space');await assertSilentAction(true);
      await page.keyboard.press('Space');await assertSilentAction(false);
      await page.evaluate(()=>{document.querySelector('video').muted=true;});
      await page.waitForTimeout(100);
      assert.equal(await popup.count(),0,'automatic mute changes do not create feedback');
      await page.getByRole('textbox',{name:'Chat input'}).click();await page.keyboard.press('m');
      assert.equal(await page.locator('video').evaluate(video=>video.muted),true);
      assert.equal(await popup.count(),0,'typing does not create player feedback');
      assert.deepEqual(errors,[]);
      console.log(`${platform}/normalization-${normalize}: M-only feedback, no mouse/Space popup, selected level, native bezel suppression and automatic mute isolation passed`);
    }finally{await page.close();}
  }
}finally{await browser.close();}
