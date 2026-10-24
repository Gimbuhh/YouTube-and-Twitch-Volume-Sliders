// Development-only audio-processing prototype; never imported by userscript entries.
import {createLufsMeter} from '../src/shared/lufs-meter.js';

export const REFINED_PROFILE=Object.freeze({lookaheadMs:20,attackMs:1,releaseMs:180,holdMs:20,riseDbPerSecond:24,peakDb:-10});

// Offline prototype only. Commands are causal: each 5 ms command becomes
// available after that measurement block, never at its beginning.
export function programmeCommands(input,rate=48000,selected=.3,energyHeadroomLu=3){
 const block=Math.round(rate/200),commands=new Float32Array(Math.ceil(input.length/2/block));
 const meter=createLufsMeter(rate),history=[];
 const left=new Float32Array(block),right=new Float32Array(block);
 const targetPower=10**((-18+.691)/10),energyCeiling=targetPower*10**(energyHeadroomLu/10);
 let gain=0,waiting=true,programmeGain=1,shortCap=Infinity,time=0,referenceHold=0;
 for(let offset=0,k=0;offset<input.length/2;offset+=block,k++){
  const count=Math.min(block,input.length/2-offset);commands[k]=waiting?gain*selected:Math.min(programmeGain,shortCap)*selected;
  for(let i=0;i<count;i++){left[i]=input[(offset+i)*2];right[i]=input[(offset+i)*2+1];}
  meter.process([left.subarray(0,count),right.subarray(0,count)],frame=>{
   // Decoded AAC noise at -123 dBFS is not a meaningful first measurement.
   if(waiting&&(frame.rawPower<1e-9||frame.power<1e-9))return;
   waiting=false;time+=frame.duration;
   while(history.length&&history[0].time<=time-3)history.shift();
   if(frame.rawPower<.0001||frame.power<=0)return;
   history.push({time,power:frame.power,duration:frame.duration});
   const ordered=history.slice().sort((a,b)=>a.power-b.power),duration=history.reduce((sum,item)=>sum+item.duration,0);
   let cumulative=0,reference=0;for(const item of ordered){cumulative+=item.duration;if(cumulative>=duration*.65){reference=item.power;break;}}
   referenceHold*=10**(-.5*frame.duration/10);if(duration>=1)referenceHold=Math.max(referenceHold,reference);
   reference=Math.max(reference,referenceHold);
   let desired=Math.min(1/selected,10**(6/20),Math.max(.1,Math.sqrt(targetPower/reference)));
   if(!referenceHold)desired=Math.min(1,desired);
   if(desired<programmeGain)programmeGain=desired;
   else programmeGain=Math.exp(Math.log(programmeGain)+(Math.log(desired)-Math.log(programmeGain))*(1-Math.exp(-frame.duration/(time<3?.9:3))));
  },power=>{
   shortCap=power>0?Math.sqrt(energyCeiling/power):Infinity;
   // Lookahead already protects samples before playback, so opening can use
   // measured safe gain rather than recovering for seconds from an arbitrary
   // minimum. Until a meaningful short measurement, commands remain zero.
   if(waiting&&power>=1e-9)gain=Math.min(1,shortCap);
  });
 }
 return {commands,block};
}

// A bounded-memory, stereo-linked gain stage. Output is delayed by lookahead.
// The monotone deque finds the lowest permitted gain in that delay window.
// Both programme and peak constraints share one envelope rather than multiply.
export function createLookaheadGain({rate=48000,lookaheadMs=REFINED_PROFILE.lookaheadMs,attackMs=REFINED_PROFILE.attackMs,releaseMs=REFINED_PROFILE.releaseMs,holdMs=REFINED_PROFILE.holdMs,riseDbPerSecond=REFINED_PROFILE.riseDbPerSecond,ceiling=.3*10**(REFINED_PROFILE.peakDb/20)}={}){
 if(!Number.isFinite(ceiling)||ceiling<0)throw new RangeError('Invalid peak ceiling');
 const delay=Math.max(1,Math.round(rate*lookaheadMs/1000)),size=delay+2;
 const audioL=new Float32Array(size),audioR=new Float32Array(size);
 const indices=new Float64Array(size),values=new Float64Array(size);
 const attack=Math.exp(-1/(rate*attackMs/1000)),release=Math.exp(-1/(rate*releaseMs/1000));
 const holdSamples=Math.round(rate*holdMs/1000),rise=riseDbPerSecond/rate;
 const pair=new Float64Array(2),fadeSamples=Math.round(rate*.005);
 let head=0,tail=0,count=0,index=0,gainDb=-160,holdUntil=-1,muted=true,fade=0;
 const stats={delaySamples:delay,emergencyCuts:0,maxEmergencyCutDb:0,maxSamplePeak:0,gainTravelDb:0,maxRiseDb:0};
 return {delay,stats,
  push(left,right,programmeGain){
   const slot=index%size;audioL[slot]=left;audioR[slot]=right;
   const peak=Math.max(Math.abs(left),Math.abs(right));
   const permitted=Math.min(Math.max(0,programmeGain),peak>0?ceiling/peak:Infinity);
   const db=20*Math.log10(Math.max(1e-8,permitted));
   while(count&&indices[head]<index-delay){head=(head+1)%size;count--;}
   while(count&&values[(tail-1+size)%size]>=db){tail=(tail-1+size)%size;count--;}
   indices[tail]=index;values[tail]=db;tail=(tail+1)%size;count++;
   const target=values[head],previous=gainDb,wasMuted=muted;
   if(target<=-159){gainDb=-160;muted=true;fade=0;holdUntil=-1;}
   else if(muted){gainDb=target;muted=false;fade=0;holdUntil=index+holdSamples;}
   else if(target<gainDb){gainDb=target+(gainDb-target)*attack;holdUntil=index+holdSamples;}
   else if(index>=holdUntil)gainDb=Math.min(gainDb+rise,target+(gainDb-target)*release);
   if(index<delay){index++;return null;}
   const outputSlot=(index-delay)%size,l=audioL[outputSlot],r=audioR[outputSlot];
   let gain=10**(gainDb/20);const delayedPeak=Math.max(Math.abs(l),Math.abs(r));
   if(ceiling>0&&delayedPeak*gain>ceiling){const cut=20*Math.log10(delayedPeak*gain/ceiling);stats.maxEmergencyCutDb=Math.max(stats.maxEmergencyCutDb,cut);if(cut>.01)stats.emergencyCuts++;gain=ceiling/delayedPeak;gainDb=20*Math.log10(gain);}
   if(!wasMuted){stats.gainTravelDb+=Math.abs(gainDb-previous);stats.maxRiseDb=Math.max(stats.maxRiseDb,gainDb-previous);}
   const fadeGain=muted?0:Math.min(1,++fade/fadeSamples);
   const outputL=l*gain*fadeGain,outputR=r*gain*fadeGain;stats.maxSamplePeak=Math.max(stats.maxSamplePeak,Math.abs(outputL),Math.abs(outputR));
   pair[0]=outputL;pair[1]=outputR;index++;return pair;
  }
 };
}

export function renderRefined(input,commands,{rate=48000,selected=.3,programmeOffsetDb=0,...profile}={}){
 const began=performance.now();
 const {peakDb=REFINED_PROFILE.peakDb,...envelope}=profile;
 const gainStage=createLookaheadGain({rate,...envelope,ceiling:selected*10**(peakDb/20)});
 const output=new Float32Array(input.length),frames=input.length/2,block=Math.round(rate/200),offset=10**(programmeOffsetDb/20);
 let out=0;
 for(let i=0;i<frames+gainStage.delay;i++){
  const l=i<frames?input[i*2]:0,r=i<frames?input[i*2+1]:0;
  const command=commands[Math.min(commands.length-1,Math.floor(i/block))]*offset;
  const pair=gainStage.push(l,r,command);
  if(pair&&out<frames){output[out*2]=pair[0];output[out*2+1]=pair[1];out++;}
 }
 gainStage.stats.processingMilliseconds=performance.now()-began;
 return {output,stats:gainStage.stats};
}
