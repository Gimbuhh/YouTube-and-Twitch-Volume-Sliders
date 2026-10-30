import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumeNormalizer } from '../../src/shared/normalization.js';
import { createRuntime } from '../helpers/runtime.js';
import { mockAudioCapture } from '../helpers/audio.js';

function fixture(t) {
  const runtime = createRuntime('https://www.youtube.com/watch?v=normalization');
  const { window, document } = runtime;
  const video = document.createElement('video'); document.body.append(video); video.volume = .5;
  const audio = mockAudioCapture(window, video), timers = new Map(), errors = {};
  let now = 0, timerId = 0, raw = 50, reads = 0;
  Object.defineProperty(window.performance, 'now', { value: () => now });
  window.setInterval = (callback, delay) => { timers.set(++timerId, { callback, delay, next: now + delay }); return timerId; };
  window.clearInterval = id => timers.delete(id);
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay, next: now + delay, once: true }); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  const normalizer = createVolumeNormalizer({window,
    getVolume: () => { reads++; return raw; }, isMuted: () => video.muted,
    setVolume: (_video, value) => { if(errors.write) throw errors.write; raw=value; }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const advance = async (seconds=.2) => { await flush(); for(let i=0;i<Math.ceil(seconds*100);i++){now+=10;await flush();for(const [id,timer] of [...timers])if(timers.has(id)&&now>=timer.next){if(timer.once)timers.delete(id);else timer.next+=timer.delay;timer.callback();}}await flush(); };
  t.after(() => { errors.write=null;normalizer.setEnabled(false);runtime.close(); });
  return {window,document,video,audio,normalizer,timers,errors,advance,
    async start(){normalizer.setEnabled(true);normalizer.bind(video,50);await advance();},
    get reads(){return reads;}, get raw(){return raw;}, get output(){return JSON.parse(document.documentElement.dataset.tmAudioNormalization||'{}').output;},
    native(value){raw=value;normalizer.acceptNativeVolume(video);}, passive(value){raw=value;video.volume=value/100;video.dispatchEvent(new window.Event('volumechange'));}
  };
}

test('default off allocates nothing; enabled output keeps selected volume distinct', async t=>{
  const f=fixture(t);f.normalizer.bind(f.video);assert.equal(f.audio.captures,0);assert.equal(f.raw,50);
  await f.start();assert.equal(f.normalizer.getStatus(),'Active');assert.equal(f.raw,100);assert.ok(f.output<20);
  assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),50);
  assert.match(f.normalizer.getDetails(),/^Reducing loud audio\nOutput \d+% · Selected 50%$/);
  assert.doesNotMatch(f.normalizer.getDetails(),/local|graph|lookahead/i);
});

test('disable releases analysis and restores ordinary output through the retained source',async t=>{
  const f=fixture(t);await f.start();const context=f.audio.contexts[0],source=context.sources.get(f.video);
  f.normalizer.setEnabled(false);await f.advance(.15);assert.equal(f.raw,50);assert.equal(f.video.volume,.5);assert.equal(f.normalizer.getStatus(),'Off');
  assert.ok(f.audio.streams.every(s=>s.getTracks().every(track=>track.readyState==='ended')));
  assert.ok(f.audio.nodes.every(node=>node.port.closed));assert.equal(f.timers.size,0);
  assert.equal(context.closed,false);
  const [ordinary]=source.connections;
  assert.equal(ordinary.gain.value,1);assert.ok(ordinary.connections.has(context.destination));
});

test('custom and native controls set absolute intent; passive restoration never adopts it',async t=>{
  const f=fixture(t);await f.start();f.normalizer.setPreferredVolume(f.video,30);await f.advance();
  assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),30);assert.equal(f.raw,100);
  f.native(45);await f.advance();assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),45);assert.equal(f.raw,100);
  f.passive(17);await f.advance();assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),45);assert.equal(f.video.volume,1);
  f.normalizer.setEnabled(false);await f.advance(.15);assert.equal(f.raw,45);
});

test('same-element resets and enable cycles reuse one document context and source',async t=>{
  const f=fixture(t);await f.start();f.normalizer.bind(f.video,80);assert.equal(f.audio.captures,1);
  for(let i=0;i<3;i++){f.video.dispatchEvent(new f.window.Event('loadstart'));await f.advance();assert.equal(f.normalizer.getStatus(),'Active');}
  f.normalizer.setEnabled(false);f.normalizer.setEnabled(true);f.normalizer.bind(f.video,50);await f.advance();
  assert.equal(f.audio.contexts.length,1);assert.equal(f.audio.contexts[0].sources.size,1);assert.equal(f.normalizer.getStatus(),'Active');
});

test('rapid disable and re-enable cannot restore an outgoing selection over the new session',async t=>{
  const f=fixture(t);await f.start();
  f.normalizer.setEnabled(false);
  f.normalizer.setEnabled(true);f.normalizer.bind(f.video,30);
  await f.advance(.3);
  assert.equal(f.normalizer.getStatus(),'Active');
  assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),30);
  assert.equal(f.raw,100);
  assert.equal(f.audio.contexts[0].sources.size,1);
  f.normalizer.setEnabled(false);await f.advance(.15);
  assert.equal(f.raw,30);
  assert.equal(f.video.volume,.3);
});

test('volume input during a disable fade uses and restores the selected level',async t=>{
  const f=fixture(t);await f.start();f.normalizer.setPreferredVolume(f.video,30);
  f.normalizer.setEnabled(false);
  assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),30);
  f.normalizer.setPreferredVolume(f.video,35);
  assert.equal(f.normalizer.getPreferredVolume(f.video,f.raw),35);
  await f.advance(.15);
  assert.equal(f.raw,35);assert.equal(f.video.volume,.35);
});

test('pause, mute, zero volume and healthy silence retain the current session',async t=>{
  const f=fixture(t);await f.start();f.audio.paused=true;await f.advance(5);assert.equal(f.normalizer.getStatus(),'Waiting for playback');
  f.audio.paused=false;f.video.dispatchEvent(new f.window.Event('play'));f.video.muted=true;await f.advance();assert.equal(f.normalizer.getStatus(),'Waiting for audio');
  f.video.muted=false;f.normalizer.setPreferredVolume(f.video,0);await f.advance();assert.equal(f.output,0);
  f.normalizer.setPreferredVolume(f.video,50);f.audio.amplitude=0;await f.advance(5);assert.equal(f.normalizer.getStatus(),'Active');
  assert.equal(f.audio.captures,1);f.normalizer.setEnabled(false);assert.equal(f.video.muted,false);
});

test('healthy and paused lifecycle checks slow down and unchanged diagnostics are not rewritten', async t => {
  const f = fixture(t); await f.start();
  let reads = f.reads;
  await f.advance(1);
  assert.ok(f.reads - reads <= 4, 'healthy playback needs at most four watchdog reads per second');
  f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause'));
  await f.advance(1);
  assert.equal(f.audio.contexts[0].state, 'suspended');
  let writes = 0;
  const observer = new f.window.MutationObserver(records => { writes += records.length; });
  observer.observe(f.document.documentElement, { attributes: true, attributeFilter: ['data-tm-audio-normalization'] });
  t.after(() => observer.disconnect());
  reads = f.reads;
  await f.advance(2);
  assert.ok(f.reads - reads <= 4, 'paused playback needs at most two watchdog reads per second');
  assert.equal(writes, 0, 'unchanged paused status must not cause DOM mutations');
  f.audio.paused = false; f.video.dispatchEvent(new f.window.Event('play'));
  await f.advance(.1);
  assert.equal(f.audio.contexts[0].state, 'running');
  assert.equal(f.normalizer.getStatus(), 'Active', 'play events resume without waiting for a watchdog');
  assert.equal(f.audio.captures, 1);
});

test('paused startup stays protected without capturing before playback',async t=>{
  const f=fixture(t);f.audio.paused=true;await f.start();assert.equal(f.raw,0);assert.equal(f.audio.captures,0);
  f.audio.paused=false;f.video.dispatchEvent(new f.window.Event('playing'));await f.advance();assert.equal(f.normalizer.getStatus(),'Active');
});

test('resuming an established session waits for its context without asking for activation', async t => {
  const f = fixture(t); await f.start();
  const context = f.audio.contexts[0], resume = context.resume;
  f.audio.paused = true; f.video.dispatchEvent(new f.window.Event('pause'));
  await f.advance(.2);
  let finish;
  context.resume = () => new Promise(resolve => { finish = () => { resume.call(context); resolve(); }; });
  f.audio.paused = false; f.video.dispatchEvent(new f.window.Event('play'));
  await f.advance(.05);
  assert.equal(f.normalizer.getStatus(), 'Waiting for playback', 'a pending resume must not look like blocked activation');
  context.resume = resume; finish(); await f.advance(.2);
  assert.equal(f.normalizer.getStatus(), 'Active');
});

test('capture starts after the protected output route and native volume are ready', async t => {
  const f = fixture(t), capture = f.video.captureStream;
  f.video.captureStream = () => {
    const context = f.audio.contexts[0], source = context?.sources.get(f.video);
    assert.ok(source?.connections.size, 'capture must not precede the protected media route');
    assert.equal(f.raw, 100, 'capture must see the initialized player audio output');
    return capture();
  };
  await f.start();
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.audio.captures, 1);
});

test('source restart finishes retiring the old route before capturing the new one', async t => {
  const f = fixture(t); await f.start();
  const previous = f.audio.streams[0], capture = f.video.captureStream;
  f.video.captureStream = () => {
    assert.ok(previous.getTracks().every(track => track.readyState === 'ended'), 'the old capture must finish retiring first');
    return capture();
  };
  f.video.dispatchEvent(new f.window.Event('loadstart'));
  await f.advance(.3);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.audio.captures, 2);
  assert.equal(f.audio.contexts[0].sources.size, 1);
});

test('a late audio track starts on the protected route without recapturing', async t => {
  const f = fixture(t), capture = f.video.captureStream;
  let pending;
  f.video.captureStream = () => {
    const stream = capture();
    pending = stream.getAudioTracks()[0];
    stream.tracks = stream.tracks.filter(track => track !== pending);
    return stream;
  };
  await f.start();
  assert.equal(f.audio.captures, 1);
  assert.equal(f.audio.nodes.length, 0);
  assert.equal(f.raw, 100);
  f.audio.streams[0].tracks.push(pending);
  await f.advance(.2);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.audio.captures, 1);
});

test('initial audio priming retains protection and its first capture beyond the running watchdog', async t => {
  const f = fixture(t); f.audio.stalled = true;
  await f.start(); await f.advance(1.8);
  assert.equal(f.audio.captures, 1);
  assert.equal(f.audio.streams[0].getAudioTracks()[0].readyState, 'live');
  assert.doesNotMatch(f.normalizer.getStatus(), /unavailable/);
  assert.equal(f.output, 0, 'unmeasured audio remains protected');
  f.audio.stalled = false; await f.advance(.15);
  assert.equal(f.normalizer.getStatus(), 'Active');
  assert.equal(f.audio.captures, 1, 'priming must not require an input restart');
});

test('missing first measurements still fail within the bounded startup allowance', async t => {
  const f = fixture(t); f.audio.stalled = true;
  await f.start(); await f.advance(3.1);
  assert.match(f.normalizer.getStatus(), /unavailable/);
  await f.advance(.15);
  assert.equal(f.raw, 50);
  assert.equal(f.audio.captures, 1);
  assert.ok(f.audio.streams[0].getTracks().every(track => track.readyState === 'ended'));
});

test('capture failures back off and recover without toggling the option',async t=>{
  const f=fixture(t);f.audio.captureError=Error('Not ready');await f.start();assert.match(f.normalizer.getStatus(),/unavailable/);assert.equal(f.raw,50);
  const count=f.audio.captures;await f.advance(.5);assert.equal(f.audio.captures,count);
  f.audio.captureError=null;await f.advance(1);assert.equal(f.normalizer.getStatus(),'Active');assert.equal(f.audio.captures,count+1);
});

test('repeated failures back off to thirty seconds and pause prevents retries',async t=>{
  const f=fixture(t);f.audio.captureError=Error('Unavailable');await f.start();
  for(const delay of [1,2,4,8,16,30]){const count=f.audio.captures;await f.advance(Math.max(0,delay-.3));assert.equal(f.audio.captures,count);await f.advance(.3);assert.equal(f.audio.captures,count+1);}
  f.audio.paused=true;const count=f.audio.captures;await f.advance(35);assert.equal(f.audio.captures,count);
});

test('processor and stalled-frame errors restore volume, dispose analysis and retry',async t=>{
  for(const kind of ['processorError','stalled']){
    const f=fixture(t);await f.start();f.audio[kind]=true;await f.advance(kind==='stalled'?1.7:.1);
    assert.match(f.normalizer.getStatus(),/unavailable/);await f.advance(.15);assert.equal(f.raw,50);assert.ok(f.audio.nodes[0].port.closed);
    f.audio[kind]=false;await f.advance(1.3);assert.equal(f.normalizer.getStatus(),'Active');
  }
});

test('inaccessible captured tracks restore ordinary volume and recover when accessible',async t=>{
  const f=fixture(t);await f.start();f.audio.captureMuted=true;f.audio.streams[0].getAudioTracks()[0].muted=true;
  await f.advance(1.7);assert.match(f.normalizer.getStatus(),/unavailable/);await f.advance(.15);assert.equal(f.raw,50);
  f.audio.captureMuted=false;await f.advance(1.3);assert.equal(f.normalizer.getStatus(),'Active');
});

test('blocked activation never diverts the media element and startup timeout restores volume',async t=>{
  const f=fixture(t),Context=f.window.AudioContext;
  f.window.AudioContext=class extends Context{constructor(){super();this.state='suspended';}resume(){return new Promise(()=>{});}};
  await f.start();assert.equal(f.raw,0);assert.equal(f.audio.contexts[0].sources.size,0);
  f.video.volume=.3;f.video.dispatchEvent(new f.window.Event('volumechange'));await f.advance(.1);
  assert.equal(f.video.volume,0,'startup protection reaches the element even when the site API already reports zero');
  await f.advance(3.1);assert.match(f.normalizer.getStatus(),/unavailable/);assert.equal(f.raw,50);assert.equal(f.audio.contexts[0].sources.size,0);
});

test('source-change hold rejects outgoing measurements and remains bounded',async t=>{
  const f=fixture(t);await f.start();const receive=f.audio.nodes[0].port.onmessage;
  f.normalizer.setSourceChanging(true);await f.advance(.15);assert.equal(f.raw,0);
  receive({data:{power:.001,rawPower:.001,duration:.05}});assert.equal(f.output,0);
  await f.advance(3.1);assert.match(f.normalizer.getStatus(),/unavailable/);assert.equal(f.raw,50);
  f.normalizer.setSourceChanging(false);await f.advance(1.3);assert.equal(f.normalizer.getStatus(),'Active');
});

test('unsupported capture, protected media and blocked analysis leave selected playback available',async t=>{
  for(const kind of ['missing','protected','module']){const f=fixture(t);
    if(kind==='missing')delete f.video.captureStream;else if(kind==='protected')Object.defineProperty(f.video,'mediaKeys',{value:{}});else f.audio.loadError=true;
    await f.start();assert.match(f.normalizer.getStatus(),/unavailable/);assert.equal(f.raw,50);assert.equal(f.video.volume,.5);
  }
});

test('write failures and detachment still release analysis resources',async t=>{
  const f=fixture(t);await f.start();f.errors.write=Error('Site API failed');f.passive(20);await f.advance();
  assert.match(f.normalizer.getStatus(),/unavailable/);assert.ok(f.audio.nodes[0].port.closed);
  f.errors.write=null;await f.advance(1.3);assert.equal(f.normalizer.getStatus(),'Active');
  f.video.remove();await f.advance();assert.equal(f.normalizer.isBoundTo(f.video),false);assert.equal(f.timers.size,0);
  assert.ok(f.audio.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
});
