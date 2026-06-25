// ==UserScript==
// @name         YouTube Volume Slider 2.4.7
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      2.4.7
// @description  Compact in-bar volume indicator that expands into a wide YouTube volume slider.
// @author       Gimbuhh (Made using AI)
// @icon         https://www.youtube.com/favicon.ico
// @match        https://www.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

import { startYouTubeVolumeSlider } from '../platforms/youtube.js';

startYouTubeVolumeSlider();
