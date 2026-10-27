import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {launchChrome,launchFirefox} from '../helpers/browser.js';
const useFirefox=process.argv.includes('--firefox');
const directory=process.argv.slice(2).find(arg=>arg!=='--firefox')||(useFirefox?process.env.VOLUME_SLIDER_FIREFOX_RESULTS:process.env.VOLUME_SLIDER_NORMALIZATION_RESULTS)||join(tmpdir(),useFirefox?'volume-slider-firefox-checks':'volume-slider-native-checks');await mkdir(directory,{recursive:true});
const browser=useFirefox?await launchFirefox():await launchChrome(['--disable-background-networking','--mute-audio']),results=[];
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Native gain kernel checks</title>'}));await page.goto('http://native-kernel.test/');const code=(await build({stdin:{contents:"import {createNativeGainGraph} from './src/shared/normalization-graph.js';window.createNativeGraph=createNativeGainGraph;",resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'iife'})).outputFiles[0].text;await page.addScriptTag({content:code});
 for(const rate of [44100,48000,96000])for(const kind of ['impulses','boosted','surround','tone','stereo','silence','zero','recovery']){
  const info=await page.evaluate(async({rate,kind})=>{
   const phases=kind==='impulses'?[0,1,31,63,127,128,239]:[0],rows=[];
   for(const phase of phases){
    const seconds=kind==='recovery'?3:1,count=Math.round(rate*seconds),context=new OfflineAudioContext(2,count+Math.ceil(rate*.1),rate),source=context.createBufferSource(),buffer=context.createBuffer(kind==='surround'?6:2,count,rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1),selected=kind==='zero'?0:.3,graph=window.createNativeGraph(context,{selected});
    if(kind==='impulses'||kind==='boosted'||kind==='surround')for(let c=0;c<buffer.numberOfChannels;c++)buffer.getChannelData(c)[Math.round(rate*.1)+phase]=kind==='boosted'?2.4:1;
    else if(kind!=='silence')for(let i=0;i<count;i++){const t=i/rate,level=kind==='tone'?.03:kind==='recovery'?(t>=.5&&t<.8?.95:.05):.8,value=level*Math.sin(2*Math.PI*997*t);left[i]=value;right[i]=kind==='stereo'?-value:value;}
    graph.setGain(kind==='boosted'||kind==='surround'?10**(6/20):1,0);source.buffer=buffer;source.connect(graph.input);graph.output.connect(context.destination);source.start();const rendered=await context.startRendering(),l=rendered.getChannelData(0),r=rendered.getChannelData(1),delay=Math.round(graph.lookaheadMs*rate/1000);
    // Firefox detaches channel views when playback acquires a buffer's content.
    const referenceLeft=buffer.getChannelData(0),referenceRight=buffer.getChannelData(1);
    let peak=0,nonfinite=0,error=0,phaseError=0,baselineEnergy=0,recoveryEnergy=0,baselineCount=0,recoveryCount=0;
    for(let i=0;i<l.length;i++){for(const x of [l[i],r[i]]){if(!Number.isFinite(x))nonfinite++;else peak=Math.max(peak,Math.abs(x))}if(kind==='stereo')phaseError=Math.max(phaseError,Math.abs(l[i]+r[i]));}
    for(let i=Math.round(rate*.2);i<Math.round(rate*.8);i++)error=Math.max(error,Math.abs(l[i+delay]-referenceLeft[i]*selected),Math.abs(r[i+delay]-referenceRight[i]*selected));
    for(let i=Math.round(rate*.3);i<Math.round(rate*.4);i++){baselineEnergy+=l[i+delay]**2;baselineCount++;}
    if(kind==='recovery')for(let i=Math.round(rate*1.8);i<Math.round(rate*2);i++){recoveryEnergy+=l[i+delay]**2;recoveryCount++;}
    rows.push({phase,peak,nonfinite,error,phaseError,recoveryDb:kind==='recovery'?10*Math.log10((recoveryEnergy/recoveryCount)/(baselineEnergy/baselineCount)):null,lookaheadMs:graph.lookaheadMs,nodeCount:graph.nodeCount});graph.dispose();
   }return rows;
  },{rate,kind});
  for(const row of info){results.push({rate,kind,...row});assert.equal(row.nonfinite,0);assert.ok(row.peak<=.3*10**(-10/20)+.00001,'sample ceiling exceeded');if(['impulses','boosted','surround'].includes(kind))assert.ok(row.peak>.09,'impulse disappeared');if(kind==='tone')assert.ok(row.error<.00001,'quiet tone changed');if(kind==='stereo'){assert.ok(row.peak>.001);assert.ok(row.phaseError<.000001)}if(kind==='silence'||kind==='zero')assert.equal(row.peak,0);if(kind==='recovery')assert.ok(row.recoveryDb>-.35&&row.recoveryDb<.1,'gain failed to recover');}
  console.log(JSON.stringify({rate,kind,results:info}));
 }
 for(const rate of [44100,48000,96000]){
  const row=await page.evaluate(async rate=>{
   const context=new OfflineAudioContext(2,Math.round(rate*.1),rate),source=context.createConstantSource(),graph=window.createNativeGraph(context,{selected:.2});
   source.offset.value=.01;source.connect(graph.input);graph.output.connect(context.destination);graph.setGain(1,0);source.start();
   const programme=[{time:0,target:1}],selected=[],targets=[.5,1,.3,.8,.1,.7],levels=[.3,.8,.2,.4,.6,.1];
   const times=[.0027,.0054,.0107,.0161,.0241,.0321].map(time=>Math.ceil(time*rate/128)*128/rate);
   for(let i=0;i<times.length;i++){
    const time=times[i];programme.push({time,target:targets[i]});selected.push({time,target:levels[i]});
    graph.setGain(targets[i],time);graph.setSelected(levels[i],time);
   }
   const output=(await context.startRendering()).getChannelData(0),delay=Math.round(graph.lookaheadMs*rate/1000);
   function reference(events,time,initial,tau){
    let value=initial,target=initial,start=0;
    for(const event of events){if(event.time>time)break;value=target+(value-target)*Math.exp(-(event.time-start)/tau);target=event.target;start=event.time}
    return target+(value-target)*Math.exp(-(time-start)/tau);
   }
   let maxError=0;
   for(let i=delay;i<output.length;i++){
    const expected=.01*reference(programme,(i-delay)/rate,0,.003)*reference(selected,i/rate,.2,.005);
    maxError=Math.max(maxError,Math.abs(output[i]-expected));
   }
   graph.dispose();return{rate,kind:'retarget',changes:times.length,maxError};
  },rate);
  results.push(row);console.log(JSON.stringify(row));assert.ok(row.maxError<1e-7,'rapid gain changes departed from the continuous exponential');
 }
}finally{await browser.close();await writeFile(join(directory,'native-kernel-results.json'),JSON.stringify(results,null,2))}
