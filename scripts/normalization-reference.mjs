import { createLufsMeter } from '../src/shared/lufs-meter.js';
import { createProgrammeState, NORMALIZATION_PROFILE } from '../src/shared/normalization-gain.js';
export { NORMALIZATION_PROFILE };

export function programmeCommands(input,rate=48000,selected=.3,energyHeadroomLu=3){
 const block=Math.round(rate/200),commands=new Float32Array(Math.ceil(input.length/2/block));
 const meter=createLufsMeter(rate),state=createProgrammeState(selected,energyHeadroomLu);
 const energyCeiling=10**((NORMALIZATION_PROFILE.targetLufs+.691+energyHeadroomLu)/10);
 // The offline reference has no native energy graph, so cap its commands here.
 let shortCap=Infinity;
 const short=power=>{shortCap=power>0?Math.sqrt(energyCeiling/power):Infinity;state.short(power);};
 const left=new Float32Array(block),right=new Float32Array(block);
 for(let offset=0,k=0;offset<input.length/2;offset+=block,k++){
  const count=Math.min(block,input.length/2-offset);commands[k]=Math.min(state.getProgrammeGain(),shortCap)*selected;
  for(let i=0;i<count;i++){left[i]=input[(offset+i)*2];right[i]=input[(offset+i)*2+1];}
  meter.process([left.subarray(0,count),right.subarray(0,count)],state.frame,short);
 }
 return {commands,block};
}

// A bounded-memory, stereo-linked gain stage. Output is delayed by lookahead.
// The monotone deque finds the lowest permitted gain in that delay window.
// Both programme and peak constraints share one envelope rather than multiply.
export function createLookaheadGain({rate=48000,lookaheadMs=NORMALIZATION_PROFILE.lookaheadMs,attackMs=NORMALIZATION_PROFILE.attackMs,releaseMs=NORMALIZATION_PROFILE.releaseMs,holdMs=NORMALIZATION_PROFILE.holdMs,riseDbPerSecond=NORMALIZATION_PROFILE.riseDbPerSecond,ceiling=.3*10**(NORMALIZATION_PROFILE.peakDb/20)}={}){
 if(!Number.isFinite(ceiling)||ceiling<0)throw new RangeError('Invalid peak ceiling');
 const delay=Math.max(1,Math.round(rate*lookaheadMs/1000)),size=delay+2;
 const audioL=new Float32Array(size),audioR=new Float32Array(size);
 const indices=new Float64Array(size),values=new Float64Array(size);
 const attack=Math.exp(-1/(rate*attackMs/1000)),release=Math.exp(-1/(rate*releaseMs/1000));
 const holdSamples=Math.round(rate*holdMs/1000),rise=riseDbPerSecond/rate;
 const pair=new Float64Array(2),fadeSamples=Math.round(rate*.005);
 let head=0,tail=0,count=0,index=0,gainDb=-160,holdUntil=-1,muted=true,fade=0,currentGain=0;
 const stats={delaySamples:delay,emergencyCuts:0,maxEmergencyCutDb:0,maxSamplePeak:0,gainTravelDb:0,maxRiseDb:0};
 return {delay,stats,
  get gain(){return currentGain;},
  setCeiling(value){if(!Number.isFinite(value)||value<0)throw new RangeError('Invalid peak ceiling');ceiling=value;},
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
   currentGain=gain*fadeGain;
   const outputL=l*gain*fadeGain,outputR=r*gain*fadeGain;stats.maxSamplePeak=Math.max(stats.maxSamplePeak,Math.abs(outputL),Math.abs(outputR));
   pair[0]=outputL;pair[1]=outputR;index++;return pair;
  }
 };
}

export function renderRefined(input,commands,{rate=48000,selected=.3,programmeOffsetDb=0,...profile}={}){
 const began=performance.now();
 const {peakDb=NORMALIZATION_PROFILE.peakDb,...envelope}=profile;
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
