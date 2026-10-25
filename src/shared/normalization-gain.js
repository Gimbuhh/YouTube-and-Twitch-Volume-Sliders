// Programme matching and settings shared by the production renderer and reference tests.


export const NORMALIZATION_PROFILE=Object.freeze({targetLufs:-18,energyHeadroomLu:3,lookaheadMs:20,attackMs:1,releaseMs:180,holdMs:20,riseDbPerSecond:24,peakDb:-10});

// Programme matching is shared by the native renderer and offline comparisons.
export function createProgrammeState(selected=.3,energyHeadroomLu=NORMALIZATION_PROFILE.energyHeadroomLu){
 const history=[];
 const targetPower=10**((NORMALIZATION_PROFILE.targetLufs+.691)/10),energyCeiling=targetPower*10**(energyHeadroomLu/10);
 let gain=0,waiting=true,programmeGain=1,shortCap=Infinity,time=0,referenceHold=0;
 return {
  setSelected(value){selected=Math.max(0,Math.min(1,value));},
  getGain(){return (waiting?gain:Math.min(programmeGain,shortCap,selected>0?1/selected:0))*selected;},
  getProgrammeGain(){return selected>0?Math.min(waiting?gain:programmeGain,1/selected):0;},
  frame(frame){
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
  },
  short(power){
   shortCap=power>0?Math.sqrt(energyCeiling/power):Infinity;
   // Lookahead already protects samples before playback, so opening can use
   // measured safe gain rather than recovering for seconds from an arbitrary
   // minimum. Until a meaningful short measurement, commands remain zero.
   if(waiting&&power>=1e-9)gain=Math.min(1,shortCap);
  }
 };
}
