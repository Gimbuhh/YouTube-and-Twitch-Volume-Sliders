import assert from 'node:assert/strict';

// Exercise ordinary playback through the retained source, with normalization
// disabled. No normalizer watchdog can repair a missed asynchronous transition.
export async function checkIdleResumeRace(page, contextsKey) {
  await page.evaluate(() => document.querySelector('video').pause());
  await page.waitForFunction(key => window[key][0].state === 'suspended', contextsKey);
  await page.evaluate(key => {
    const context = window[key][0], resume = context.resume.bind(context);
    const race = window.__resumeRace = { pending: 0, resume };
    context.resume = async () => {
      race.pending++;
      try {
        await new Promise(resolve => setTimeout(resolve, 150));
        return await resume();
      } finally { race.pending--; }
    };
    document.querySelector('video').play().catch(error => { race.playError = error.name; });
  }, contextsKey);
  await page.waitForFunction(() => window.__resumeRace.pending > 0);
  await page.evaluate(() => document.querySelector('video').pause());
  await page.waitForFunction(key => window.__resumeRace.pending === 0 && window[key][0].state === 'suspended', contextsKey);
  const error = await page.evaluate(key => {
    const race = window.__resumeRace;
    window[key][0].resume = race.resume;
    delete window.__resumeRace;
    return race.playError;
  }, contextsKey);
  assert.ok(!error || error === 'AbortError', `unexpected play error: ${error}`);
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForFunction(key => window[key][0].state === 'running' && window.__peak() > .001, contextsKey);
}
