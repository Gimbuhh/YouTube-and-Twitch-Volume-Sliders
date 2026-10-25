// ==UserScript==
// @name         YouTube Volume Slider
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      2.9
// @description  Compact YouTube volume controls with optional automatic volume normalization.
// @author       Gimbuhh (Made using AI)
// @icon         https://www.youtube.com/favicon.ico
// @match        https://www.youtube.com/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/youtube-volume-slider.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

import { startYouTubeVolumeSlider } from '../platforms/youtube.js';

startYouTubeVolumeSlider();
