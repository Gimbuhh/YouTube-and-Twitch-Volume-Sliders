import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumePersistence } from '../../src/shared/volume.js';

test('volume persistence owns custom-step snapping, debounce cancellation, and saved parsing', () => {
  const values=new Map([['volume','35']]); let pending=null; let cleared=0;
  const window={setTimeout:fn=>{pending=fn;return 1;},clearTimeout:()=>{cleared++;pending=null;}};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let step=5;
  const persistence=createVolumePersistence({window,storage,storageKey:'volume',debounceMs:150,getVolumeStep:()=>step});
  assert.equal(persistence.getSavedVolume(),35);
  for (const [raw, expected] of [['125px', 100], ['-8', 0], ['nope', null]]) {
    values.set('volume', raw);
    assert.equal(persistence.getSavedVolume(), expected);
  }
  values.delete('volume');
  assert.equal(persistence.getSavedVolume(), null);
  const slider={value:'47'}; assert.equal(persistence.readSteppedSliderValue(slider),45); assert.equal(slider.value,'45');
  step=2; slider.value='47'; assert.equal(persistence.readSteppedSliderValue(slider),48); assert.equal(slider.value,'48');
  persistence.scheduleSaveVolume(60); persistence.scheduleSaveVolume(65); assert.equal(cleared,1); pending();
  assert.equal(values.get('volume'),'65');
});
