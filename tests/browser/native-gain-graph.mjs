import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const directory=process.argv[2]||process.env.VOLUME_SLIDER_NORMALIZATION_RESULTS||join(tmpdir(),'volume-slider-native-checks');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.VOLUME_SLIDER_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--mute-audio']}),results=[];
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Native gain kernel checks</title>'}));await page.goto('http://native-kernel.test/');const code=(await build({stdin:{contents:"import {createNativeGainGraph} from './src/shared/normalization-graph.js';window.createNativeGraph=createNativeGainGraph;",resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'iife'})).outputFiles[0].text;await page.addScriptTag({content:code});
 for(const rate of [44100,48000,96000])for(const kind of ['impulses','tone','stereo','silence','zero','recovery']){
  const info=await page.evaluate(async({rate,kind})=>{
   const phases=kind==='impulses'?[0,1,31,63,127,128,239]:[0],rows=[];
   for(const phase of phases){
    const seconds=kind==='recovery'?3:1,count=Math.round(rate*seconds),context=new OfflineAudioContext(2,count+Math.ceil(rate*.1),rate),source=context.createBufferSource(),buffer=context.createBuffer(2,count,rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1),selected=kind==='zero'?0:.3,graph=window.createNativeGraph(context,{selected});
    if(kind==='impulses')left[Math.round(rate*.1)+phase]=right[Math.round(rate*.1)+phase]=1;
    else if(kind!=='silence')for(let i=0;i<count;i++){const t=i/rate,level=kind==='tone'?.03:kind==='recovery'?(t>=.5&&t<.8?.95:.05):.8,value=level*Math.sin(2*Math.PI*997*t);left[i]=value;right[i]=kind==='stereo'?-value:value;}
    graph.setGain(1,0);source.buffer=buffer;source.connect(graph.input);graph.output.connect(context.destination);source.start();const rendered=await context.startRendering(),l=rendered.getChannelData(0),r=rendered.getChannelData(1),delay=Math.round(graph.lookaheadMs*rate/1000);
    let peak=0,nonfinite=0,error=0,phaseError=0,baselineEnergy=0,recoveryEnergy=0,baselineCount=0,recoveryCount=0;
    for(let i=0;i<l.length;i++){for(const x of [l[i],r[i]]){if(!Number.isFinite(x))nonfinite++;else peak=Math.max(peak,Math.abs(x))}if(kind==='stereo')phaseError=Math.max(phaseError,Math.abs(l[i]+r[i]));}
    for(let i=Math.round(rate*.2);i<Math.round(rate*.8);i++)error=Math.max(error,Math.abs(l[i+delay]-left[i]*selected),Math.abs(r[i+delay]-right[i]*selected));
    for(let i=Math.round(rate*.3);i<Math.round(rate*.4);i++){baselineEnergy+=l[i+delay]**2;baselineCount++;}
    if(kind==='recovery')for(let i=Math.round(rate*1.8);i<Math.round(rate*2);i++){recoveryEnergy+=l[i+delay]**2;recoveryCount++;}
    rows.push({phase,peak,nonfinite,error,phaseError,recoveryDb:kind==='recovery'?10*Math.log10((recoveryEnergy/recoveryCount)/(baselineEnergy/baselineCount)):null,lookaheadMs:graph.lookaheadMs,nodeCount:graph.nodeCount});graph.dispose();
   }return rows;
  },{rate,kind});
  for(const row of info){results.push({rate,kind,...row});assert.equal(row.nonfinite,0);assert.ok(row.peak<=.3*10**(-10/20)+.00001,'sample ceiling exceeded');if(kind==='impulses')assert.ok(row.peak>.09,'impulse disappeared');if(kind==='tone')assert.ok(row.error<.00001,'quiet tone changed');if(kind==='stereo'){assert.ok(row.peak>.001);assert.ok(row.phaseError<.000001)}if(kind==='silence'||kind==='zero')assert.equal(row.peak,0);if(kind==='recovery')assert.ok(row.recoveryDb>-.35&&row.recoveryDb<.1,'gain failed to recover');}
  console.log(JSON.stringify({rate,kind,results:info}));
 }
}finally{await browser.close();await writeFile(join(directory,'native-kernel-results.json'),JSON.stringify(results,null,2))}
