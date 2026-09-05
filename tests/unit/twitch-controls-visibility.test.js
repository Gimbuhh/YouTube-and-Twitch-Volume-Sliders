import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchControlsVisibilityManager } from '../../src/platforms/twitch-controls-visibility.js';

function element() {
  const classes=new Set();
  const styles=new Map();
  return {
    attrs:new Map(),
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value)},
    style:{
      set opacity(value){styles.set('opacity',value);},
      get opacity(){return styles.get('opacity')||'';},
      set visibility(value){styles.set('visibility',value);},
      get visibility(){return styles.get('visibility')||'';},
      removeProperty:name=>styles.delete(name)
    },
    setAttribute(name,value){this.attrs.set(name,value);}
  };
}

function harness() {
  let nextTimer=1;
  const timers=new Map();
  const observers=[];
  const window={
    setTimeout(fn){const id=nextTimer++;timers.set(id,fn);return id;},
    clearTimeout(id){timers.delete(id);}
  };
  class FakeObserver {
    constructor(callback){this.callback=callback;this.targets=[];this.disconnects=0;observers.push(this);}
    observe(target){this.targets.push(target);}
    disconnect(){this.disconnects+=1;this.targets=[];}
  }
  let targets={root:element(),shell:element(),controls:element()};
  let hidden=false;
  const manager=createTwitchControlsVisibilityManager({window,MutationObserver:FakeObserver,getTargets:()=>targets,areControlsHidden:()=>hidden});
  return {manager,timers,observers,get targets(){return targets;},set targets(value){targets=value;},set hidden(value){hidden=value;}};
}

test('Twitch visibility owners overlap without releasing each other',()=>{
  const current=harness();
  current.manager.hold('options');
  current.manager.hold('keyboard-volume');
  current.manager.release('options');
  assert.equal(current.manager.has('keyboard-volume'),true);
  assert.equal(current.targets.root.style.visibility,'visible');
  current.manager.release('keyboard-volume');
  assert.equal(current.targets.root.style.visibility,'');
  assert.equal(current.targets.shell.classList.contains('tm-volume-options-controls-shell-hold'),false);
});

test('Twitch visibility refresh replaces only its owner deadline',()=>{
  const current=harness();
  current.manager.hold('options');
  current.manager.hold('keyboard-volume',3000);
  const first=[...current.timers.keys()][0];
  current.manager.hold('keyboard-volume',3000);
  assert.equal(current.timers.has(first),false);
  const refreshed=[...current.timers.values()][0];
  refreshed();
  assert.equal(current.manager.has('keyboard-volume'),false);
  assert.equal(current.manager.has('options'),true);
  assert.equal(current.targets.root.style.visibility,'visible');
});

test('Twitch visibility observer reapplies rerendered controls and dispose cleans every target',()=>{
  const current=harness();
  const original=current.targets;
  current.manager.hold('post-close');
  const replacement={root:element(),shell:element(),controls:element()};
  current.targets=replacement;
  current.hidden=true;
  current.manager.reveal();
  current.observers.at(-1).callback();
  assert.equal(replacement.root.style.visibility,'visible');
  current.manager.dispose();
  current.manager.dispose();
  assert.equal(original.root.style.visibility,'');
  assert.equal(replacement.root.style.visibility,'');
  assert.equal(current.manager.size,0);
  assert.equal([...current.timers.keys()].length,0);
});
