import { chromium, firefox } from 'playwright-core';

// Each launch uses an isolated temporary profile. Missing prerequisites are errors.
export function launchChrome(args = []) {
  const executablePath = process.env.VOLUME_SLIDER_CHROME || process.env.CHROME_PATH;
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }), args });
}

export function launchFirefox() {
  return firefox.launch({ headless: true, firefoxUserPrefs: { 'media.autoplay.default': 0 } });
}
