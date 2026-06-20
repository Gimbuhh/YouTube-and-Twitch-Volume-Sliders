import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../helpers/runtime.js';
import { twitchFixture, youtubeFixture } from '../helpers/fixtures.js';

for (const platform of ['youtube','twitch']) test(`${platform} artifact metadata and security boundary`, async () => {
  const source=await readFile(new URL(`../../dist/${platform}-volume-slider.user.js`,import.meta.url),'utf8');
  assert.match(source,/\/\/ @version\s+2\.4/); assert.match(source,/\/\/ @grant\s+none/); assert.doesNotMatch(source,/@require|sourceMappingURL|\bfetch\s*\(|XMLHttpRequest/);
  assert.ok(Buffer.byteLength(source) > (platform === 'youtube' ? 80000 : 95000), 'artifact retains full behavior');
});

for (const config of [
  { platform:'youtube', url:'https://www.youtube.com/watch?v=test', fixture:youtubeFixture },
  { platform:'twitch', url:'https://www.twitch.tv/test', fixture:twitchFixture }
]) test(`${config.platform} built artifact starts as a standalone userscript`, async () => {
  const runtime=createRuntime(config.url,{runScripts:'outside-only'});
  config.fixture(runtime.document);
  const source=await readFile(new URL(`../../dist/${config.platform}-volume-slider.user.js`,import.meta.url),'utf8');
  runtime.window.eval(source);
  assert.ok(runtime.document.getElementById('tm-volume-slider-overlay'));
  assert.ok(runtime.document.getElementById('tm-volume-options-button'));
  await new Promise(resolve=>runtime.window.setTimeout(resolve,0));
  runtime.close();
});
