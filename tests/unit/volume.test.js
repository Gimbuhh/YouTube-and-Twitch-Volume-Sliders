import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolumePersistence, restoreSavedVolume, setVolumeFromUser } from '../../src/shared/volume.js';

test('restore and user intent use separate platform contracts', () => {
  const calls=[]; const platform={restoreVolume:(_,v)=>calls.push(['restore',v]),setVolumeFromUser:(_,v)=>calls.push(['user',v]),setMuted:()=>{}};
  const settings={savedVolume:35,savedMute:null,saveVolume:v=>calls.push(['save',v])};
  restoreSavedVolume(platform,{},settings); setVolumeFromUser(platform,{},settings,40);
  assert.deepEqual(calls,[['restore',35],['user',40],['save',40]]);
});

test('volume persistence owns debounce cancellation and saved parsing', () => {
  const values=new Map([['volume','35']]); let pending=null; let cleared=0;
  const window={setTimeout:fn=>{pending=fn;return 1;},clearTimeout:()=>{cleared++;pending=null;}};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const persistence=createVolumePersistence({window,storage,storageKey:'volume',debounceMs:150,isSnapEnabled:()=>true});
  assert.equal(persistence.getSavedVolume(),35);
  const slider={value:'47'}; assert.equal(persistence.readSnappedSliderValue(slider),45); assert.equal(slider.value,'45');
  persistence.scheduleSaveVolume(60); persistence.scheduleSaveVolume(65); assert.equal(cleared,1); pending();
  assert.equal(values.get('volume'),'65');
});
