import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { getOptionsPopupFocusable } from '../../src/shared/options.js';

test('focusable options exclude hidden ancestors and roving radio stops',()=>{
  const dom=new JSDOM('<div id="popup"><button id="first">First</button><div style="display:none"><button id="hidden">Hidden</button></div><div role="radiogroup"><button id="selected" role="radio" tabindex="0">Selected</button><button id="other" role="radio" tabindex="-1">Other</button></div></div>');
  const popup=dom.window.document.getElementById('popup');
  assert.deepEqual(getOptionsPopupFocusable(popup).map(element=>element.id),['first','selected']);
  dom.window.close();
});
