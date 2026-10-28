// Measure rendered synthetic audio, independently of the normalizer's gain.
// A quiet signal is valid; a missing stretch of PCM is a discontinuity.
export async function startAudioContinuityMonitor(page, outputsKey) {
  await page.evaluate(async key => {
    const sources = window[key], context = sources[0].context;
    if (!window.__continuityModule) {
      const url = URL.createObjectURL(new Blob([`
      registerProcessor('continuity-probe', class extends AudioWorkletProcessor {
        constructor() { super(); this.stats={samples:0,nonzero:0,maxZeroRun:0,nonfinite:0}; this.run=0;
          this.port.onmessage=()=>{this.port.postMessage(this.stats);this.stopped=true}; }
        process(inputs) {
          if(this.stopped)return false;
          const input=inputs[0]?.[0];
          for(let i=0;i<(input?.length||128);i++) {
            const sample=input?input[i]:0;
            this.stats.samples++;
            if(!Number.isFinite(sample))this.stats.nonfinite++;
            if(Math.abs(sample)>1e-8){this.stats.nonzero++;this.run=0}
            else this.stats.maxZeroRun=Math.max(this.stats.maxZeroRun,++this.run);
          }
          return true;
        }
      });`], {type:'application/javascript'}));
      window.__continuityModule = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    await window.__continuityModule;
    const node = new AudioWorkletNode(context, 'continuity-probe', {numberOfInputs:1,numberOfOutputs:0,
      channelCount:1,channelCountMode:'explicit'});
    for (const source of sources) source.connect(node);
    window.__continuityProbe = {node,sources};
  }, outputsKey);
  return () => page.evaluate(() => new Promise((resolve, reject) => {
    const {node,sources} = window.__continuityProbe;
    const cleanup = () => { for(const source of sources)source.disconnect(node);node.disconnect();node.port.close();delete window.__continuityProbe; };
    const timer = setTimeout(() => {cleanup();reject(Error('Audio continuity monitor did not finish'));}, 2000);
    node.port.onmessage = ({data}) => {clearTimeout(timer);cleanup();resolve(data);};
    node.port.postMessage('finish');
  }));
}
