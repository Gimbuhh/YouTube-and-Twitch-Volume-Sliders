// ==UserScript==
// @name         YouTube Volume Slider 2.4.4
// @namespace    http://tampermonkey.net/
// @version      2.4.4
// @description  Compact in-bar volume indicator that expands into a wide YouTube volume slider.
// @author       isagie (Made using AI)
// @icon         https://www.youtube.com/favicon.ico
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

import { startYouTubeVolumeSlider } from '../platforms/youtube.js';

startYouTubeVolumeSlider();
